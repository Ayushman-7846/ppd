import csv
import json
from time import monotonic

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .auth import CurrentUser, same_origin
from .catalog import dataset_record, dataset_view, export_csv, import_csv, list_datasets, prompt_for, save_dataset
from .database import Database
from .lab_schemas import (
    DIMENSIONS, DatasetDetail, DatasetInput, DatasetSummary, ItemInput, ModelOption, Name, PromptInfo, PromptInput,
    PromptPreview, PromptRendered, Provider, ProviderInfo, ProviderUpdate,
)
from .linguistics import ANSWERS, render_prompt, validate_template
from .models import ModelProvider, Prompt, ProviderDiagnostic
from .providers import DEMO_BASELINE, DEMO_MODEL, PROVIDERS, ProviderError, credential, discover, effective_parameters, encrypt, provider_info
from .queue import now, quota
from .schemas import Dimension, Envelope


router = APIRouter()
write = [Depends(same_origin)]


@router.get("/providers", response_model=Envelope[list[ProviderInfo]], tags=["AI providers"])
def providers(db: Database, user: CurrentUser):
    settings = {entry.provider: entry for entry in db.scalars(select(ModelProvider).where(ModelProvider.owner_id == user.id))}
    diagnostics = {entry.provider: entry for entry in db.scalars(select(ProviderDiagnostic).where(ProviderDiagnostic.owner_id == user.id))}
    return Envelope(data=[provider_info(name, settings.get(name), diagnostics.get(name)) for name in PROVIDERS])


def provider_revision(record):
    if record is None:
        return None
    return record.enabled, record.default_model, record.parameters, record.credential_ciphertext


@router.put("/providers/{provider}", response_model=Envelope[ProviderInfo], dependencies=write, tags=["AI providers"])
def configure(provider: Provider, fields: ProviderUpdate, db: Database, user: CurrentUser):
    quota(db, user.id, "configuration", 24)
    record = db.get(ModelProvider, (user.id, provider))
    previous = provider_revision(record)
    if record is None:
        record = ModelProvider(owner_id=user.id, provider=provider)
        db.add(record)
    if fields.credential:
        if provider == "ollama":
            raise HTTPException(422, "Configure the Ollama host on the backend.")
        record.credential_ciphertext = encrypt(fields.credential.get_secret_value())
    if fields.clear_credential:
        record.credential_ciphertext = None
    if fields.default_model:
        effective_parameters(provider, fields.default_model, fields.parameters, fields.parameters)
    record.enabled, record.default_model = fields.enabled, fields.default_model
    record.parameters = fields.parameters.model_dump(exclude_none=True)
    diagnostic = db.get(ProviderDiagnostic, (user.id, provider))
    if diagnostic and previous != provider_revision(record):
        db.delete(diagnostic)
        diagnostic = None
    result = provider_info(provider, record, diagnostic)
    db.commit()
    return Envelope(data=result)


@router.post("/providers/{provider}/test", response_model=Envelope[list[str]], dependencies=write, tags=["AI providers"])
@router.post("/providers/{provider}/models", response_model=Envelope[list[str]], dependencies=write, tags=["AI providers"])
def test_provider(provider: Provider, db: Database, user: CurrentUser):
    owner = user.id
    quota(db, owner, "connections", 10)
    record = db.get(ModelProvider, (owner, provider))
    signature = provider_revision(record)
    model = record.default_model if record else None
    checked = now()
    started = monotonic()
    failure = None
    names = None
    blocked = False
    try:
        key = credential(provider, record)
    except ProviderError as error:
        failure, blocked = error, True
    db.commit()
    if failure is None:
        try:
            names = discover(provider, key)
        except ProviderError as error:
            failure = error
    latest = db.get(ModelProvider, (owner, provider), populate_existing=True)
    if signature == provider_revision(latest):
        insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
        info = insert(ProviderDiagnostic).values(owner_id=owner, provider=provider, checked_at=checked,
            last_success_at=checked if names is not None else None, latency_ms=round((monotonic() - started) * 1000),
            status="reachable" if names is not None else "blocked" if blocked else "failed", model=model,
            model_count=len(names) if names is not None else None, model_listed=(model in names) if model and names is not None else None,
            error_code=failure.code if failure else None, error_message=str(failure) if failure else None)
        newer = info.excluded.checked_at >= ProviderDiagnostic.checked_at
        fields = ("checked_at", "latency_ms", "status", "model", "model_count", "model_listed", "error_code", "error_message")
        updates = {name: case((newer, info.excluded[name]), else_=getattr(ProviderDiagnostic, name)) for name in fields}
        updates["last_success_at"] = case((ProviderDiagnostic.last_success_at.is_(None), info.excluded.last_success_at),
            (info.excluded.last_success_at > ProviderDiagnostic.last_success_at, info.excluded.last_success_at),
            else_=ProviderDiagnostic.last_success_at)
        db.execute(info.on_conflict_do_update(index_elements=["owner_id", "provider"], set_=updates))
        db.commit()
    if failure:
        raise failure
    return Envelope(data=names)


@router.get("/models", response_model=Envelope[list[ModelOption]], tags=["AI providers"])
def models(db: Database, user: CurrentUser):
    options = [ModelOption(provider="demo", model=DEMO_MODEL, label="LinguaLens reference · Demo")]
    for name in PROVIDERS:
        info = provider_info(name, db.get(ModelProvider, (user.id, name)))
        if info.enabled and info.configured:
            if info.default_model:
                options.append(ModelOption(provider=name, model=info.default_model, label=f"{info.default_model} · {name}"))
            options.append(ModelOption(provider=name, model="", label=f"{name} · enter model identifier"))
    options.append(ModelOption(provider="demo", model=DEMO_BASELINE, label="LinguaLens simplified baseline · Demo"))
    return Envelope(data=options)


@router.get("/datasets", response_model=Envelope[list[DatasetSummary]], tags=["Datasets"])
def datasets(db: Database, user: CurrentUser, dimension: Dimension | None = None, search: str = Query("", max_length=150)):
    return Envelope(data=list_datasets(db, user.id, dimension, search.strip()))


@router.get("/datasets/{dataset_id}", response_model=Envelope[DatasetDetail], tags=["Datasets"])
def dataset(dataset_id: str, db: Database, user: CurrentUser):
    return Envelope(data=dataset_view(db, dataset_record(db, user.id, dataset_id)))


@router.get("/dataset-items", response_model=Envelope[list[ItemInput]], tags=["Datasets"])
def dataset_items(dataset_id: str, db: Database, user: CurrentUser,
                  offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=120)):
    items = dataset_view(db, dataset_record(db, user.id, dataset_id)).items
    return Envelope(data=items[offset:offset + limit])


@router.post("/datasets", response_model=Envelope[DatasetDetail], status_code=201, dependencies=write, tags=["Datasets"])
def create_dataset(fields: DatasetInput, db: Database, user: CurrentUser):
    quota(db, user.id, "catalog", 30)
    row = save_dataset(db, user.id, fields)
    result = dataset_view(db, row)
    db.commit()
    return Envelope(data=result)


@router.put("/datasets/{dataset_id}", response_model=Envelope[DatasetDetail], dependencies=write, tags=["Datasets"])
def edit_dataset(dataset_id: int, fields: DatasetInput, db: Database, user: CurrentUser):
    quota(db, user.id, "catalog", 30)
    previous = dataset_record(db, user.id, dataset_id)
    result = dataset_view(db, save_dataset(db, user.id, fields, previous))
    db.commit()
    return Envelope(data=result)


@router.post("/datasets/{dataset_id}/duplicate", response_model=Envelope[DatasetDetail],
             status_code=201, dependencies=write, tags=["Datasets"])
def duplicate_dataset(dataset_id: str, name: Name, db: Database, user: CurrentUser):
    quota(db, user.id, "catalog", 30)
    source = dataset_view(db, dataset_record(db, user.id, dataset_id))
    fields = DatasetInput(name=name, dimension=source.dimension, provenance=source.provenance, items=source.items)
    result = dataset_view(db, save_dataset(db, user.id, fields))
    db.commit()
    return Envelope(data=result)


@router.delete("/datasets/{dataset_id}", response_model=Envelope[bool], dependencies=write, tags=["Datasets"])
def archive_dataset(dataset_id: int, db: Database, user: CurrentUser):
    quota(db, user.id, "catalog", 30)
    dataset_record(db, user.id, dataset_id).archived = True
    db.commit()
    return Envelope(data=True)


@router.get("/datasets/{dataset_id}/export", tags=["Datasets"])
def download_dataset(dataset_id: str, db: Database, user: CurrentUser, format: str = Query("json", pattern="^(json|csv)$")):
    summary = dataset_view(db, dataset_record(db, user.id, dataset_id))
    if format == "csv":
        body, media = export_csv(summary), "text/csv; charset=utf-8"
    else:
        body = summary.model_dump_json(include={"name", "dimension", "provenance", "items"})
        media = "application/json"
    return Response(body, media_type=media, headers={
        "Content-Disposition": f'attachment; filename="lingualens-{summary.dimension}-v{summary.version}.{format}"'
    })


def parse_import(name, dimension, file):
    contents = file.file.read(750_001)
    if len(contents) > 750_000:
        raise HTTPException(413, "Upload limit is 750 KB.")
    try:
        text = contents.decode("utf-8-sig")
        filename = (file.filename or "").casefold()
        provenance = "Researcher-imported dataset"
        if filename.endswith(".csv"):
            items = import_csv(text, dimension)
        elif filename.endswith(".json"):
            data = json.loads(text)
            if isinstance(data, dict):
                if data.get("dimension", dimension) != dimension:
                    raise ValueError("The file belongs to a different linguistic task.")
                provenance = data.get("provenance", provenance)
                data = data.get("items")
            if not isinstance(data, list):
                raise ValueError("JSON must contain an item array or a dataset object with an item array.")
            items = data
        else:
            raise ValueError("Choose a CSV or JSON file.")
        return DatasetInput(name=name, dimension=dimension, provenance=provenance, items=items)
    except ValidationError as error:
        first = error.errors(include_input=False)[0]
        raise HTTPException(422, "Invalid data at " + ".".join(map(str, first["loc"])) + f". {first['msg']}") from None
    except (csv.Error, ValueError, RecursionError) as error:
        raise HTTPException(422, f"Dataset import failed. {error}") from None


@router.post("/datasets/import", response_model=Envelope[DatasetDetail], status_code=201, dependencies=write, tags=["Datasets"])
def import_dataset(db: Database, user: CurrentUser, name: Name = Form(), dimension: Dimension = Form(),
                   file: UploadFile = File()):
    quota(db, user.id, "catalog", 30)
    fields = parse_import(name, dimension, file)
    result = dataset_view(db, save_dataset(db, user.id, fields))
    db.commit()
    return Envelope(data=result)


@router.post("/dataset-items/preview-import", response_model=Envelope[list[ItemInput]], dependencies=write, tags=["Datasets"])
def preview_import(db: Database, user: CurrentUser, dimension: Dimension = Form(), file: UploadFile = File()):
    quota(db, user.id, "catalog", 30)
    fields = parse_import("Import preview", dimension, file)
    db.commit()
    return Envelope(data=fields.items)


@router.get("/prompts", response_model=Envelope[list[PromptInfo]], tags=["Prompt templates"])
def templates(db: Database, user: CurrentUser, dimension: Dimension | None = None):
    for task in DIMENSIONS if dimension is None else (dimension,):
        prompt_for(db, user.id, task)
    query = select(Prompt).where(Prompt.owner_id == user.id).order_by(Prompt.id.desc())
    if dimension is not None:
        query = query.where(Prompt.dimension == dimension)
    results = [PromptInfo.model_validate(prompt) for prompt in db.scalars(query.limit(120))]
    db.commit()
    return Envelope(data=results)


@router.post("/prompts", response_model=Envelope[PromptInfo], status_code=201, dependencies=write, tags=["Prompt templates"])
def add_template(fields: PromptInput, db: Database, user: CurrentUser):
    quota(db, user.id, "catalog", 30)
    try:
        validate_template(fields.template)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    previous = db.scalar(select(Prompt).where(Prompt.owner_id == user.id, Prompt.name == fields.name)
                         .order_by(Prompt.version.desc()).limit(1))
    if fields.name.startswith("@") and (not previous or fields.name != f"@default:{fields.dimension}"):
        raise HTTPException(422, "Use a name without the reserved @ prefix.")
    if previous and previous.dimension != fields.dimension:
        raise HTTPException(422, "Versions must use the same task as the original template.")
    row = Prompt(owner_id=user.id, version=previous.version + 1 if previous else 1, **fields.model_dump())
    db.add(row)
    db.flush()
    result = PromptInfo.model_validate(row)
    db.commit()
    return Envelope(data=result)


@router.post("/prompts/{prompt_id}/preview", response_model=Envelope[PromptRendered], dependencies=write, tags=["Prompt templates"])
def preview_template(prompt_id: int, fields: PromptPreview, db: Database, user: CurrentUser):
    prompt = db.scalar(select(Prompt).where(Prompt.id == prompt_id, Prompt.owner_id == user.id))
    if not prompt:
        raise HTTPException(404, "Prompt version not found.")
    try:
        text = render_prompt(prompt.dimension, fields.stimulus, fields.template if fields.template is not None else prompt.template)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    return Envelope(data=PromptRendered(text=text, schema_=ANSWERS[prompt.dimension].model_json_schema()))
