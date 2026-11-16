from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update

from .auth import CurrentUser, same_origin
from .catalog import dataset_record, items_for, prompt_for
from .database import Database
from .lab_schemas import (
    AnalysisInput, ExperimentDetail, ExperimentInfo, ExperimentInput, HistoryPage, Queued, ResponseDetail, RulePrediction, RuleTest,
)
from .linguistics import Substitution, apply_rule
from .models import Dataset, Experiment, ModelResponse, ModelSnapshot
from .queue import (
    ACTIVE, cancel_run, create_experiment, create_manual_dataset, get_response, lock_run, model_counts, open_run,
    quota, rerun_response, response_page, response_query, response_view, retry_run, run_counts,
)
from .schemas import Dimension, Envelope
from .scoring import response_hash


router = APIRouter()
write = [Depends(same_origin)]


@router.post("/linguistic/{dimension}", response_model=Envelope[Queued], status_code=202,
             dependencies=write, tags=["Linguistic analyzers"])
def analyze(dimension: Dimension, fields: AnalysisInput, db: Database, user: CurrentUser):
    quota(db, user.id, "runs", 12)
    if fields.stimulus is not None:
        try:
            fields.stimulus.check_task(dimension)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        dataset, items = create_manual_dataset(db, user.id, dimension, fields.stimulus)
    else:
        dataset = dataset_record(db, user.id, fields.dataset_id, materialize=True)
        if dataset.dimension != dimension:
            raise HTTPException(422, "The dataset belongs to a different linguistic task.")
        items = [item for item in items_for(db, dataset.id) if item.item_key == fields.item_key]
        if not items:
            raise HTTPException(404, "Dataset item not found.")
    prompt = prompt_for(db, user.id, dimension, fields.prompt_id)
    run, responses = create_experiment(db, user.id, f"{dimension.title()} analysis", [(dataset, items, prompt)],
                                       [fields.selection], 1, "analysis")
    result = Queued(experiment_id=run.id, response_id=responses[0].id)
    db.commit()
    return Envelope(data=result)


def run_info(db, run):
    return dict(id=run.id, name=run.name, state=run.state, kind=run.kind, repetitions=run.repetitions,
                created_at=run.created_at, counts=run_counts(db, run.id))


@router.get("/experiments", response_model=Envelope[list[ExperimentInfo]], tags=["Experiments"])
def experiments(db: Database, user: CurrentUser, page: int = Query(1, ge=1, le=1000)):
    rows = db.scalars(select(Experiment).where(Experiment.owner_id == user.id, Experiment.kind == "batch")
                      .order_by(Experiment.id.desc()).offset((page - 1) * 20).limit(20))
    return Envelope(data=[ExperimentInfo(**run_info(db, run)) for run in rows])


@router.post("/experiments", response_model=Envelope[Queued], status_code=202, dependencies=write, tags=["Experiments"])
def start_experiment(fields: ExperimentInput, db: Database, user: CurrentUser):
    quota(db, user.id, "runs", 12)
    sources = [dataset_record(db, user.id, identifier, materialize=True) for identifier in fields.dataset_ids]
    if len({source.id for source in sources}) != len(sources):
        raise HTTPException(422, "Add each dataset only once.")
    groups = [(source, items_for(db, source.id), prompt_for(db, user.id, source.dimension, fields.prompt_ids.get(source.dimension)))
              for source in sources]
    run, _ = create_experiment(db, user.id, fields.name, groups, fields.selections, fields.repetitions, "batch")
    result = Queued(experiment_id=run.id)
    db.commit()
    return Envelope(data=result)


@router.get("/experiment-runs/{run_id}", response_model=Envelope[ExperimentDetail], tags=["Experiments"])
def run_detail(run_id: int, db: Database, user: CurrentUser, page: int = Query(1, ge=1, le=1000)):
    run = open_run(db, user.id, run_id)
    statement = response_query(user.id).where(ModelResponse.experiment_id == run.id)
    return Envelope(data=ExperimentDetail(
        **run_info(db, run), protocol=run.protocol,
        responses=response_page(db, statement, page, 25), models=model_counts(db, run.id),
    ))


@router.post("/experiment-runs/{run_id}/cancel", response_model=Envelope[ExperimentInfo], dependencies=write, tags=["Experiments"])
def cancel(run_id: int, db: Database, user: CurrentUser):
    quota(db, user.id, "mutations", 30)
    run = open_run(db, user.id, run_id)
    cancel_run(db, run)
    result = ExperimentInfo(**run_info(db, run))
    db.commit()
    return Envelope(data=result)


@router.post("/experiment-runs/{run_id}/retry", response_model=Envelope[ExperimentInfo], dependencies=write, tags=["Experiments"])
def retry(run_id: int, db: Database, user: CurrentUser):
    quota(db, user.id, "runs", 12)
    run = open_run(db, user.id, run_id)
    retry_run(db, run)
    result = ExperimentInfo(**run_info(db, run))
    db.commit()
    return Envelope(data=result)


@router.get("/history", response_model=Envelope[HistoryPage], tags=["Responses"])
def history(db: Database, user: CurrentUser, dimension: Dimension | None = None,
            state: str | None = Query(None, pattern="^(pending|running|completed|failed|cancelled)$"),
            model: str | None = Query(None, max_length=200), analysis_only: bool = False,
            page: int = Query(1, ge=1, le=1000), page_size: int = Query(12, ge=1, le=30)):
    statement = response_query(user.id)
    if dimension:
        statement = statement.where(Dataset.dimension == dimension)
    if state:
        statement = statement.where(ModelResponse.state == state)
    if model:
        statement = statement.where(ModelSnapshot.identifier == model)
    if analysis_only:
        statement = statement.where(Experiment.kind == "analysis")
    return Envelope(data=response_page(db, statement, page, page_size))


@router.get("/responses/{response_id}", response_model=Envelope[ResponseDetail], tags=["Responses"])
def response(response_id: int, db: Database, user: CurrentUser,
             expected_output: str | None = Query(None, pattern="^[a-f0-9]{64}$")):
    row = get_response(db, user.id, response_id)
    if expected_output and response_hash(row[0].raw_output) != expected_output:
        raise HTTPException(409, "The stored output changed after this comparison was calculated.")
    return Envelope(data=response_view(row, full=True))


@router.post("/responses/{response_id}/rerun", response_model=Envelope[Queued], status_code=202,
             dependencies=write, tags=["Responses"])
def rerun(response_id: int, db: Database, user: CurrentUser):
    quota(db, user.id, "runs", 12)
    run, result = rerun_response(db, user.id, get_response(db, user.id, response_id))
    queued = Queued(experiment_id=run.id, response_id=result.id)
    db.commit()
    return Envelope(data=queued)


@router.delete("/responses/{response_id}", response_model=Envelope[bool], dependencies=write, tags=["Responses"])
def remove_response(response_id: int, db: Database, user: CurrentUser):
    quota(db, user.id, "mutations", 30)
    record = get_response(db, user.id, response_id)[0]
    lock_run(db, record.experiment_id)
    result = db.execute(update(ModelResponse).where(ModelResponse.id == record.id, ModelResponse.state.not_in(ACTIVE))
                        .values(hidden=True))
    if result.rowcount != 1:
        raise HTTPException(409, "Wait for the response to finish before removing it from history.")
    db.commit()
    return Envelope(data=True)


@router.post("/responses/{response_id}/test-rule", response_model=Envelope[RulePrediction], dependencies=write, tags=["Responses"])
def test_rule(response_id: int, fields: RuleTest, db: Database, user: CurrentUser):
    saved, _, dataset, _ = get_response(db, user.id, response_id)
    rule = (saved.parsed_output or {}).get("substitution")
    if dataset.dimension != "phonology" or not rule:
        raise HTTPException(422, "This response has no programmatic substitution. Its predictions are model-generated.")
    phones = fields.word.split()
    if len(phones) > 80 or any(len(value) > 24 or value == "#" for value in phones):
        raise HTTPException(422, "Enter at most 80 space-separated phones without boundary symbols.")
    evidence = saved.execution.get("validation", {}).get("rule_evidence", {}).get("status")
    return Envelope(data=RulePrediction(
        underlying=fields.word, surface=apply_rule(fields.word, Substitution.model_validate(rule)),
        rule_evidence="verified_on_examples" if evidence == "verified_on_examples" else "programmatic_hypothesis",
    ))
