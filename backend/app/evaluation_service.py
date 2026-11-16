import logging
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session, load_only

from .catalog import get_or_insert
from .evaluation_models import Assessment, AssessmentAttempt, AuditEvent, ResponseError, ReviewAssignment, Rubric
from .evaluation_schemas import DEFAULT_CRITERIA, DEFAULT_WEIGHTS
from .lab_schemas import Parameters
from .models import Evaluation, Experiment, ModelProvider, ModelResponse, ModelSnapshot
from .providers import ProviderError, call_model, credential
from .queue import LEASE_SECONDS, get_response, now, resolve_selection
from .scoring import deterministic, input_snapshot, judge_prompt, metric_score, parse_judge, JUDGE_VERSION


log = logging.getLogger(__name__)
BUSY = ("pending", "processing")


def audit(db, owner, actor, action, target, **detail):
    db.add(AuditEvent(owner_id=owner, actor_id=actor, action=action, target_id=target, detail=detail))


def default_rubric(db, owner):
    return get_or_insert(db, Rubric, {"owner_id": owner, "name": "@standard", "version": 1},
                         {"weights": DEFAULT_WEIGHTS, "criteria": DEFAULT_CRITERIA})


def owner_rubric(db, owner, identifier):
    record = db.scalar(select(Rubric).where(Rubric.id == identifier, Rubric.owner_id == owner))
    if record is None:
        raise HTTPException(404, "Rubric version not found.")
    return record


def rubric_view(rubric):
    return {"id": rubric.id, "name": "Standard linguistic rubric" if rubric.name == "@standard" else rubric.name,
            "version": rubric.version, "weights": rubric.weights, "criteria": rubric.criteria}


def create_rubric(db, owner, draft):
    if draft.name.startswith("@"):
        raise HTTPException(422, "Rubric names starting with @ are reserved.")
    latest = db.scalar(select(func.max(Rubric.version)).where(Rubric.owner_id == owner, Rubric.name == draft.name))
    rubric = Rubric(owner_id=owner, version=(latest or 0) + 1, **draft.model_dump())
    db.add(rubric)
    db.flush()
    audit(db, owner, owner, "rubric_created", rubric.id, version=rubric.version)
    return rubric


def eligible_response(db, owner, identifier):
    row = get_response(db, owner, identifier)
    if row[0].state in ("pending", "running", "cancelled") or row[0].raw_output is None:
        raise HTTPException(422, "Select a settled response with stored output.")
    return row


def queue_assessments(db, owner, request):
    rubric = owner_rubric(db, owner, request.rubric_id)
    judge, params = resolve_selection(db, owner, request.judge) if request.judge else (None, None)
    rows = [eligible_response(db, owner, identifier) for identifier in request.response_ids]
    if judge and any(row[0].model_id == judge.id for row in rows):
        raise HTTPException(422, "Use a judge model different from each evaluated model.")
    records = []
    for row in rows:
        job = Assessment(response_id=row[0].id, rubric_id=rubric.id, method=request.method, state="pending",
                         judge_id=judge.id if judge else None,
                         judge_config=params.model_dump(exclude_none=True) if params else {},
                         input_snapshot=input_snapshot(row))
        db.add(job)
        db.flush()
        db.add(AssessmentAttempt(assessment_id=job.id, number=1, state="pending", result={}))
        audit(db, owner, owner, "assessment_queued", job.id, response_id=job.response_id, rubric_id=rubric.id, method=job.method)
        records.append(job)
    return records


def owned_assessments(owner):
    return (select(Assessment).join(ModelResponse, ModelResponse.id == Assessment.response_id)
            .join(Experiment).where(Experiment.owner_id == owner, ModelResponse.hidden.is_(False)))


def get_assessment(db, owner, identifier):
    job = db.scalar(owned_assessments(owner).where(Assessment.id == identifier))
    if job is None:
        raise HTTPException(404, "Evaluation not found.")
    return job


def assessment_view(db, job, full=False):
    rubric = db.get(Rubric, job.rubric_id)
    previous = list(db.scalars(select(AssessmentAttempt).where(AssessmentAttempt.assessment_id == job.id)
                              .order_by(AssessmentAttempt.number.desc()).limit(4)))
    attempt = previous[0]
    reviewed = bool(db.scalar(select(ReviewAssignment.id).where(
        ReviewAssignment.response_id == job.response_id, ReviewAssignment.rubric_id == job.rubric_id,
        ReviewAssignment.response_hash == job.input_snapshot["response_hash"],
        ReviewAssignment.state == "submitted").limit(1)))
    judge = db.get(ModelSnapshot, job.judge_id) if job.judge_id else None
    result = render_assessment(job, rubric, attempt, reviewed, judge)
    if full:
        result["input"] = job.input_snapshot
        result["attempts"] = [{"id": entry.id, "number": entry.number, "state": entry.state,
                               "finished_at": entry.finished_at, "score": entry.score, "result": entry.result,
                               "raw_output": entry.raw_output, "judge_prompt": entry.judge_prompt} for entry in previous]
    return result


def render_assessment(job, rubric, attempt, reviewed, judge):
    return {
        "id": job.id, "response_id": job.response_id, "rubric": rubric_view(rubric), "method": job.method,
        "state": "reviewed" if reviewed and job.state in ("needs_human_review", "completed") else job.state,
        "attempt": attempt.number, "score": attempt.score, "result": attempt.result, "created_at": job.created_at,
        "judge": {"provider": judge.provider, "model": judge.identifier, "parameters": job.judge_config,
                  "prompt_version": JUDGE_VERSION} if judge else None,
    }


def assessment_summaries(db, jobs):
    jobs = list(jobs)
    if not jobs:
        return []
    latest = (select(AssessmentAttempt.assessment_id, func.max(AssessmentAttempt.number).label("number"))
              .where(AssessmentAttempt.assessment_id.in_([job.id for job in jobs]))
              .group_by(AssessmentAttempt.assessment_id).subquery())
    records = db.scalars(select(AssessmentAttempt).join(latest, and_(AssessmentAttempt.assessment_id == latest.c.assessment_id,
              AssessmentAttempt.number == latest.c.number)).options(load_only(AssessmentAttempt.assessment_id,
                  AssessmentAttempt.number, AssessmentAttempt.score, AssessmentAttempt.result)))
    attempts = {row.assessment_id: row for row in records}
    rubric_ids = {job.rubric_id for job in jobs}
    rubrics = {row.id: row for row in db.scalars(select(Rubric).where(Rubric.id.in_(rubric_ids)))}
    judge_ids = {job.judge_id for job in jobs if job.judge_id is not None}
    judges = {row.id: row for row in db.scalars(select(ModelSnapshot).where(ModelSnapshot.id.in_(judge_ids)))} if judge_ids else {}
    reviews = set(db.execute(select(ReviewAssignment.response_id, ReviewAssignment.rubric_id, ReviewAssignment.response_hash)
        .where(ReviewAssignment.response_id.in_({job.response_id for job in jobs}),
               ReviewAssignment.rubric_id.in_(rubric_ids), ReviewAssignment.state == "submitted")))
    return [render_assessment(job, rubrics[job.rubric_id], attempts[job.id],
             (job.response_id, job.rubric_id, job.input_snapshot["response_hash"]) in reviews, judges.get(job.judge_id)) for job in jobs]


def retry_assessment(db, owner, job):
    db.execute(update(Assessment).where(Assessment.id == job.id).values(state=Assessment.state),
               execution_options={"synchronize_session": False})
    db.refresh(job)
    if job.state in BUSY:
        raise HTTPException(409, "This evaluation is still active.")
    number = db.scalar(select(func.max(AssessmentAttempt.number)).where(AssessmentAttempt.assessment_id == job.id))
    if number >= 4:
        raise HTTPException(409, "This evaluation has reached its retry limit.")
    if job.judge_id:
        judge = db.get(ModelSnapshot, job.judge_id)
        credential(judge.provider, db.get(ModelProvider, (owner, judge.provider)))
    job.state = "pending"
    db.add(AssessmentAttempt(assessment_id=job.id, number=number + 1, state="pending", result={}))
    audit(db, owner, owner, "assessment_retried", job.id, attempt=number + 1)
    db.flush()


def write_scores(db, response_id, rubric_id, method, scores, evidence, *, attempt_id=None, assignment_id=None, reviewer_id=None):
    db.add_all([
        Evaluation(response_id=response_id, rubric_version=f"rubric/{rubric_id}", criterion=criterion,
                   method=method, score=score / 100, evidence=evidence.get(criterion, {}),
                   attempt_id=attempt_id, assignment_id=assignment_id, reviewer_id=reviewer_id)
        for criterion, score in scores.items() if score is not None
    ])


def write_errors(db, errors, response_id, method, *, attempt_id=None, assignment_id=None):
    db.add_all([
        ResponseError(response_id=response_id, attempt_id=attempt_id, assignment_id=assignment_id,
                      source=method, state="confirmed" if method == "human" else "suggested", **entry)
        for entry in errors
    ])


def due(timestamp):
    return or_(AssessmentAttempt.state == "pending",
               and_(AssessmentAttempt.state == "processing", AssessmentAttempt.lease_until <= timestamp))


def work_assessment_once(bind):
    timestamp = now()
    with Session(bind) as db:
        record = db.execute(select(AssessmentAttempt.id, AssessmentAttempt.assessment_id).where(due(timestamp))
                            .order_by(AssessmentAttempt.id).limit(1)).first()
        if record is None:
            return False
        identifier, job_id = record
        token = str(uuid4())
        updated = db.execute(update(AssessmentAttempt).where(AssessmentAttempt.id == identifier, due(timestamp))
                             .values(state="processing", lease_until=timestamp + timedelta(seconds=LEASE_SECONDS), claim=token))
        if updated.rowcount != 1:
            return False
        job = db.get(Assessment, job_id)
        job.state = "processing"
        db.commit()
    execute(bind, identifier, job_id, token)
    return True


def execute(bind, identifier, job_id, claim):
    raw = rendered = None
    state = "failed"
    score = None
    with Session(bind) as db:
        job = db.get(Assessment, job_id)
        rubric = db.get(Rubric, job.rubric_id)
        method, params, snapshot = job.method, job.judge_config, job.input_snapshot
        judge = db.get(ModelSnapshot, job.judge_id) if job.judge_id else None
        setting = db.get(ModelProvider, (rubric.owner_id, judge.provider)) if judge else None
        db.expunge_all()
    try:
        if method == "deterministic":
            result = deterministic(snapshot)
        else:
            rendered = judge_prompt(snapshot, rubric)
            generation = call_model(judge.provider, credential(judge.provider, setting), judge.identifier,
                                    rendered, Parameters.model_validate(params))
            raw = generation.generation.text
            result = parse_judge(raw, snapshot["dimension"])
            result["transport"] = {"latency_ms": generation.latency_ms, "attempts": generation.attempts,
                                   "input_tokens": generation.generation.input_tokens, "output_tokens": generation.generation.output_tokens,
                                   "reported_model": generation.generation.reported_model}
        score = metric_score(rubric.weights, result["scores"])
        state = "completed" if score is not None and result["verdict"] != "uncertain" else "needs_human_review"
    except ProviderError as error:
        result = {"error": str(error), "error_code": error.code}
    except ValueError:
        result = {"error": "The evaluation output could not be validated. Inspect the stored raw output when available.",
                  "error_code": "invalid_evaluation_output"}
    except Exception:
        log.error("Unexpected evaluation failure on attempt %s", identifier)
        result = {"error": "The evaluation could not complete.", "error_code": "evaluation_error"}
    with Session(bind) as db:
        updated = db.execute(update(AssessmentAttempt).where(AssessmentAttempt.id == identifier, AssessmentAttempt.claim == claim)
                             .values(state=state, claim=None, lease_until=None, finished_at=now(), raw_output=raw,
                                     judge_prompt=rendered, score=score, result=result))
        if updated.rowcount != 1:
            return
        db.get(Assessment, job_id).state = state
        write_scores(db, job.response_id, rubric.id, method, result.get("scores", {}), result.get("criteria", {}), attempt_id=identifier)
        write_errors(db, result.get("errors", []), job.response_id, method, attempt_id=identifier)
        audit(db, rubric.owner_id, rubric.owner_id, "assessment_settled", job_id, attempt_id=identifier, state=state)
        db.commit()
