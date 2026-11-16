import json
import logging
from datetime import datetime, timedelta, timezone
from threading import Event
from time import monotonic, time
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .catalog import BUILTIN_NAMES, add_items, demo_answer, demo_baseline, model_snapshot, prompt_for
from .database import engine
from .lab_schemas import ItemInput, ModelProgress, Parameters, Reference, ResponseDetail, ResponseSummary, Stimulus
from .linguistics import render_prompt, validate_answer
from .models import Dataset, DatasetItem, Experiment, ModelProvider, ModelResponse, ModelSnapshot, ResearchQuota
from .providers import DEMO_BASELINE, DEMO_MODEL, ProviderError, call_model, credential, effective_parameters


log = logging.getLogger(__name__)
ACTIVE = ("pending", "running")
MAX_ROWS = 160
LEASE_SECONDS = 360


def now():
    return datetime.now(timezone.utc)


def quota(db, owner, operation, limit):
    window = int(time() // 60)
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    query = insert(ResearchQuota).values(owner_id=owner, operation=operation, window=window, used=1)
    query = query.on_conflict_do_update(
        index_elements=["owner_id", "operation"],
        set_={"window": window, "used": case((ResearchQuota.window == window, ResearchQuota.used + 1), else_=1)},
        where=or_(ResearchQuota.window != window, ResearchQuota.used < limit),
    ).returning(ResearchQuota.used)
    if db.scalar(query) is None:
        raise HTTPException(429, "Workspace request limit reached. Retry in a minute.", headers={"Retry-After": "60"})


def resolve_selection(db, owner, selection):
    if selection.provider == "demo":
        if selection.model not in (None, DEMO_MODEL, DEMO_BASELINE):
            raise HTTPException(422, "Choose a LinguaLens demo profile.")
        return model_snapshot(db, "demo", selection.model or DEMO_MODEL), Parameters()
    setting = db.get(ModelProvider, (owner, selection.provider))
    credential(selection.provider, setting)
    model = selection.model or (setting.default_model if setting else None)
    if model is None:
        raise HTTPException(422, "Select a model or configure a default model.")
    defaults = Parameters.model_validate(setting.parameters) if setting and setting.default_model == model else Parameters()
    params = effective_parameters(selection.provider, model, defaults, selection.parameters)
    return model_snapshot(db, selection.provider, model), params


def create_manual_dataset(db, owner, dimension, stimulus):
    dataset = Dataset(owner_id=owner, name=f"@analysis:{uuid4()}", dimension=dimension, version=1,
                      kind="internal", provenance="Manual analysis input")
    db.add(dataset)
    db.flush()
    records = add_items(db, dataset, [ItemInput(item_key="input", stimulus=stimulus)])
    db.flush()
    return dataset, records


def create_experiment(db, owner, name, groups, selections, repetitions, kind):
    size = sum(len(items) for _, items, _ in groups) * len(selections) * repetitions
    if not 1 <= size <= MAX_ROWS:
        raise HTTPException(422, f"An experiment must contain 1 to {MAX_ROWS} item × model × trial requests.")
    models = [resolve_selection(db, owner, selection) for selection in selections]
    if len({model.id for model, _ in models}) != len(models):
        raise HTTPException(422, "Use one configuration per model within the experiment.")
    protocol = {
        "datasets": [{"id": dataset.id, "name": BUILTIN_NAMES[dataset.dimension] if dataset.kind == "builtin" else
                      "Manual input" if dataset.kind == "internal" else dataset.name,
                      "kind": dataset.kind, "version": dataset.version, "dimension": dataset.dimension, "provenance": dataset.provenance,
                      "item_count": len(items), "prompt_id": prompt.id, "prompt_version": prompt.version}
                     for dataset, items, prompt in groups],
        "models": [{"provider": model.provider, "model": model.identifier, "parameters": params.model_dump(exclude_none=True)}
                   for model, params in models],
        "repetitions": repetitions,
    }
    run = Experiment(owner_id=owner, name=name, kind=kind, dataset_id=groups[0][0].id,
                     prompt_id=groups[0][2].id, state="pending", repetitions=repetitions, protocol=protocol)
    db.add(run)
    db.flush()
    responses = []
    for dataset, items, prompt in groups:
        for item in items:
            stimulus = Stimulus.model_validate(item.stimulus)
            rendered = render_prompt(dataset.dimension, stimulus, prompt.template)
            for model, params in models:
                for repetition in range(1, repetitions + 1):
                    response = ModelResponse(
                        experiment_id=run.id, item_id=item.id, model_id=model.id, trial=repetition,
                        prompt_rendered=rendered, state="pending",
                        execution={"dimension": dataset.dimension, "prompt_id": prompt.id,
                                   "prompt_version": prompt.version, "dataset_version": dataset.version,
                                   "parameters": params.model_dump(exclude_none=True),
                                   "provenance": ("demo_baseline" if model.identifier == DEMO_BASELINE else "demo_reference")
                                   if model.provider == "demo" else "live_provider"},
                    )
                    responses.append(response)
    db.add_all(responses)
    db.flush()
    return run, responses


def response_query(owner):
    return (select(ModelResponse, DatasetItem, Dataset, ModelSnapshot)
            .join(Experiment, Experiment.id == ModelResponse.experiment_id)
            .join(DatasetItem, DatasetItem.id == ModelResponse.item_id)
            .join(Dataset, Dataset.id == DatasetItem.dataset_id)
            .join(ModelSnapshot, ModelSnapshot.id == ModelResponse.model_id)
            .where(Experiment.owner_id == owner, ModelResponse.hidden.is_(False)))


def get_response(db, owner, identifier):
    result = db.execute(response_query(owner).where(ModelResponse.id == identifier)).one_or_none()
    if result is None:
        raise HTTPException(404, "Response not found.")
    return result


def response_view(row, full=False):
    response, item, dataset, model = row
    error = response.execution.get("error")
    common = dict(id=response.id, experiment_id=response.experiment_id, dimension=dataset.dimension,
                  stimulus=Stimulus.model_validate(item.stimulus), item_key=item.item_key,
                  provider=model.provider, model=model.identifier, trial=response.trial,
                  state=response.state, error=error["message"] if error else None,
                  preview=(response.parsed_output or {}).get("explanation", response.raw_output or "")[:220],
                  created_at=response.created_at, finished_at=response.execution.get("finished_at"))
    if not full:
        return ResponseSummary(**common)
    return ResponseDetail(**common, raw_output=response.raw_output, parsed_output=response.parsed_output,
                          prompt_rendered=response.prompt_rendered, reference=item.reference, execution=response.execution)


def response_page(db, statement, page, page_size):
    total = db.scalar(select(func.count()).select_from(statement.subquery()))
    rows = db.execute(statement.order_by(ModelResponse.id.desc()).offset((page - 1) * page_size).limit(page_size))
    return {"items": [response_view(row) for row in rows], "total": total, "page": page, "page_size": page_size}


def run_counts(db, run_id):
    return dict(db.execute(select(ModelResponse.state, func.count(ModelResponse.id))
                           .where(ModelResponse.experiment_id == run_id)
                           .group_by(ModelResponse.state)).all())


def model_counts(db, run_id):
    rows = db.execute(select(ModelSnapshot.provider, ModelSnapshot.identifier, ModelResponse.state,
                             func.count(ModelResponse.id)).join(ModelResponse)
                      .where(ModelResponse.experiment_id == run_id)
                      .group_by(ModelSnapshot.provider, ModelSnapshot.identifier, ModelResponse.state))
    grouped = {}
    for provider, model, state, count in rows:
        grouped.setdefault((provider, model), {})[state] = count
    return [ModelProgress(provider=p, model=m, counts=counts) for (p, m), counts in grouped.items()]


def aggregate_state(counts, cancelled):
    if counts.get("running"):
        return "running"
    if counts.get("pending"):
        return "running" if len(counts) > 1 else "pending"
    if cancelled:
        return "cancelled"
    return "failed" if counts.get("failed") else "completed"


def open_run(db, owner, identifier):
    run = db.scalar(select(Experiment).where(Experiment.id == identifier, Experiment.owner_id == owner))
    if run is None:
        raise HTTPException(404, "Experiment not found.")
    return run


def lock_run(db, identifier):
    db.execute(update(Experiment).where(Experiment.id == identifier).values(state=Experiment.state),
               execution_options={"synchronize_session": False})


def update_run(db, identifier):
    db.flush()
    run = db.get(Experiment, identifier)
    run.state = aggregate_state(run_counts(db, identifier), run.cancel_requested)


def cancel_run(db, run):
    lock_run(db, run.id)
    db.refresh(run)
    if run.state not in ACTIVE:
        raise HTTPException(409, "Only queued or running experiments can be cancelled.")
    run.cancel_requested = True
    db.execute(update(ModelResponse).where(ModelResponse.experiment_id == run.id, ModelResponse.state == "pending")
               .values(state="cancelled"))
    update_run(db, run.id)


def retry_run(db, run):
    lock_run(db, run.id)
    db.refresh(run)
    if run.state in ACTIVE:
        raise HTTPException(409, "Wait for this run to finish before retrying.")
    rows = db.scalars(select(ModelResponse).where(ModelResponse.experiment_id == run.id, ModelResponse.state == "failed"))
    reset = 0
    for row in rows:
        old = row.execution
        past = old.get("previous_attempts", [])
        if len(past) == 3 or row.hidden:
            continue
        fixed_keys = ("dimension", "prompt_id", "prompt_version", "dataset_version", "parameters", "provenance")
        last = {key: value for key, value in old.items() if key not in (*fixed_keys, "previous_attempts")}
        row.execution = {key: old[key] for key in fixed_keys if key in old} | {
            "previous_attempts": [*past, last | {"raw_output": row.raw_output, "parsed_output": row.parsed_output}]
        }
        row.state = "pending"
        row.raw_output = row.parsed_output = None
        reset += 1
    if reset == 0:
        raise HTTPException(409, "No failed items are eligible for retry.")
    run.cancel_requested = False
    update_run(db, run.id)
    return reset


def rerun_response(db, owner, row):
    previous, item, dataset, model = row
    prompt = prompt_for(db, owner, dataset.dimension, previous.execution.get("prompt_id"))
    if model.provider != "demo":
        credential(model.provider, db.get(ModelProvider, (owner, model.provider)))
    old_run = db.get(Experiment, previous.experiment_id)
    metadata = {key: previous.execution[key] for key in
                ("dimension", "prompt_id", "prompt_version", "dataset_version", "parameters", "provenance")
                if key in previous.execution}
    metadata["rerun_of"] = previous.id
    run = Experiment(owner_id=owner, dataset_id=dataset.id, prompt_id=prompt.id,
                     name="Re-run of " + old_run.name[:136], kind="analysis", state="pending", repetitions=1,
                     protocol={"rerun_of": previous.id, **metadata, "model": model.identifier, "provider": model.provider})
    db.add(run)
    db.flush()
    response = ModelResponse(experiment_id=run.id, item_id=item.id, model_id=model.id, trial=1, state="pending",
                             prompt_rendered=previous.prompt_rendered, execution=metadata)
    db.add(response)
    db.flush()
    return run, response


def due(timestamp):
    return or_(ModelResponse.state == "pending",
               and_(ModelResponse.state == "running", ModelResponse.lease_until <= timestamp))


def claim_response(bind):
    timestamp = now()
    with Session(bind) as db:
        candidate = db.execute(
            select(ModelResponse.id, ModelResponse.experiment_id).join(Experiment)
            .where(due(timestamp)).order_by(ModelResponse.id).limit(1)
        ).first()
        if not candidate:
            return None
        response_id, run_id = candidate
        lock_run(db, run_id)
        run = db.get(Experiment, run_id)
        token = str(uuid4())
        state = "cancelled" if run.cancel_requested else "running"
        transaction = db.execute(update(ModelResponse).where(ModelResponse.id == response_id, due(timestamp))
                                 .values(state=state, claim=token if state == "running" else None,
                                         lease_until=timestamp + timedelta(seconds=LEASE_SECONDS) if state == "running" else None))
        if transaction.rowcount != 1:
            return None
        update_run(db, run_id)
        db.commit()
        return (response_id, run_id, token) if state == "running" else None


def execute_claim(bind, response_id, run_id, token):
    with Session(bind) as db:
        response = db.get(ModelResponse, response_id)
        run = db.get(Experiment, run_id)
        item = db.get(DatasetItem, response.item_id)
        dataset = db.get(Dataset, item.dataset_id)
        model = db.get(ModelSnapshot, response.model_id)
        provider, identifier, owner, dimension = model.provider, model.identifier, run.owner_id, dataset.dimension
        metadata, prompt = response.execution, response.prompt_rendered
        stimulus = Stimulus.model_validate(item.stimulus)
        reference = Reference.model_validate(item.reference)
        setting = db.get(ModelProvider, (owner, provider))
        db.expunge_all()

    def is_cancelled():
        with Session(bind) as db:
            return bool(db.scalar(select(Experiment.cancel_requested).where(Experiment.id == run_id)))

    started = now()
    raw = parsed = None
    state = "failed"
    detail = {}
    try:
        if is_cancelled():
            raise ProviderError("Execution was cancelled.", status=409, code="cancelled")
        if provider == "demo":
            before = monotonic()
            answer = demo_answer(dimension, stimulus)
            if answer is None:
                raise ProviderError("Demo mode supports the curated examples. Select a built-in item or use a live model for this input.",
                                    status=422, code="demo_example_required")
            if identifier == DEMO_BASELINE:
                answer = demo_baseline(dimension, answer)
            raw = json.dumps(answer, ensure_ascii=False)
            detail = {"latency_ms": round((monotonic() - before) * 1000), "attempts": 1}
        else:
            result = call_model(provider, credential(provider, setting), identifier, prompt,
                                Parameters.model_validate(metadata["parameters"]), is_cancelled)
            output = result.generation
            raw = output.text
            detail = {"latency_ms": result.latency_ms, "attempts": result.attempts,
                      "input_tokens": output.input_tokens, "output_tokens": output.output_tokens,
                      "reported_model": output.reported_model, "finish_reason": output.finish_reason}
        parsed, validation = validate_answer(dimension, raw, stimulus, reference)
        detail["validation"] = validation
        if parsed is None:
            detail["error"] = {"code": "invalid_model_output", "message": "The response did not pass the structured checks. The raw output is available."}
        else:
            state = "completed"
    except ProviderError as error:
        if error.code == "cancelled":
            state = "cancelled"
        detail = {"error": {"code": error.code, "message": str(error)},
                  "latency_ms": getattr(error, "latency_ms", None), "attempts": getattr(error, "attempts", 0)}
        log.info("Research response %s ended with %s", response_id, error.code)
    except Exception:
        # Unexpected SDK or data errors are never returned with credential-bearing exception text.
        detail["error"] = {"code": "execution_error", "message": "Execution could not complete. Retry this research item."}
        log.error("Unexpected error processing research response %s", response_id)
    with Session(bind) as db:
        lock_run(db, run_id)
        completed = db.execute(update(ModelResponse).where(ModelResponse.id == response_id, ModelResponse.claim == token)
                               .values(state=state, claim=None, lease_until=None, raw_output=raw, parsed_output=parsed,
                                       execution=metadata | detail | {"started_at": started.isoformat(), "finished_at": now().isoformat()}))
        if completed.rowcount == 1:
            update_run(db, run_id)
        db.commit()


def work_once(bind=engine):
    claimed = claim_response(bind)
    if not claimed:
        return False
    execute_claim(bind, *claimed)
    return True


def run_worker(stop: Event):
    from .evaluation_service import work_assessment_once

    while not stop.is_set():
        try:
            ran_response = work_once()
            ran_assessment = work_assessment_once(engine)
            if ran_response or ran_assessment:
                continue
        except SQLAlchemyError:
            log.warning("Research queue is temporarily unavailable")
        stop.wait(0.5)
