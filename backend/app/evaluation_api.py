from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select

from .auth import CurrentUser, same_origin
from .database import Database
from .evaluation_models import Assessment, AssessmentAttempt, AuditEvent, ResponseError, ReviewAssignment, ReviewDecision, Rubric
from .evaluation_schemas import Adjudication, AssessmentRequest, AssignmentRequest, ErrorResolution, ERRORS, ReviewInput, RubricDraft, RubricView
from .evaluation_service import (
    assessment_summaries, assessment_view, audit, create_rubric, default_rubric, get_assessment, owned_assessments,
    owner_rubric, queue_assessments, retry_assessment, rubric_view,
)
from .models import Dataset, DatasetItem, Experiment, ModelResponse, ModelSnapshot
from .queue import get_response, quota
from .reviews import assign, collect_consensus, ensure_reviewer, get_assignment, owner_agreement, update_review, view_assignment
from .schemas import Dimension, Envelope
from .scoring import response_hash


router = APIRouter()
write = [Depends(same_origin)]


@router.get("/evaluations/rubrics", response_model=Envelope[list[RubricView]], tags=["Evaluation"])
def rubrics(db: Database, user: CurrentUser):
    default_rubric(db, user.id)
    values = db.scalars(select(Rubric).where(Rubric.owner_id == user.id).order_by(Rubric.id.desc()).limit(100))
    results = [rubric_view(row) for row in values]
    db.commit()
    return Envelope(data=results)


@router.post("/evaluations/rubrics", response_model=Envelope[RubricView], status_code=201, dependencies=write, tags=["Evaluation"])
def save_rubric(fields: RubricDraft, db: Database, user: CurrentUser):
    quota(db, user.id, "rubrics", 16)
    view = rubric_view(create_rubric(db, user.id, fields))
    db.commit()
    return Envelope(data=view)


@router.get("/evaluations", response_model=Envelope[dict], tags=["Evaluation"])
def assessments(db: Database, user: CurrentUser, response_id: int | None = None, experiment_id: int | None = None,
                page: int = Query(1, ge=1, le=1000), method: Literal["deterministic", "judge"] | None = None):
    query = owned_assessments(user.id)
    if response_id is not None:
        query = query.where(Assessment.response_id == response_id)
    if experiment_id is not None:
        query = query.where(Experiment.id == experiment_id)
    if method is not None:
        query = query.where(Assessment.method == method)
    count = db.scalar(select(func.count()).select_from(query.subquery()))
    values = db.scalars(query.order_by(Assessment.id.desc()).offset((page - 1) * 20).limit(20))
    return Envelope(data={"items": assessment_summaries(db, values), "total": count, "page": page, "page_size": 20})


@router.post("/evaluations/automated", response_model=Envelope[list[dict]], status_code=202, dependencies=write, tags=["Evaluation"])
def automated(fields: AssessmentRequest, db: Database, user: CurrentUser):
    quota(db, user.id, "assessments", 12)
    rows = queue_assessments(db, user.id, fields)
    values = assessment_summaries(db, rows)
    db.commit()
    return Envelope(data=values)


@router.get("/evaluations/audit", response_model=Envelope[list[dict]], tags=["Evaluation"])
def audit_history(db: Database, user: CurrentUser, page: int = Query(1, ge=1, le=1000)):
    rows = db.scalars(select(AuditEvent).where(AuditEvent.owner_id == user.id).order_by(AuditEvent.id.desc())
                      .offset((page - 1) * 30).limit(30))
    return Envelope(data=[{"id": row.id, "actor_id": row.actor_id, "action": row.action, "target_id": row.target_id,
                           "created_at": row.created_at, "detail": row.detail} for row in rows])


@router.get("/evaluations/{identifier}", response_model=Envelope[dict], tags=["Evaluation"])
def assessment(identifier: int, db: Database, user: CurrentUser):
    return Envelope(data=assessment_view(db, get_assessment(db, user.id, identifier), full=True))


@router.post("/evaluations/{identifier}/retry", response_model=Envelope[dict], status_code=202, dependencies=write, tags=["Evaluation"])
def retry(identifier: int, db: Database, user: CurrentUser):
    quota(db, user.id, "assessments", 12)
    job = get_assessment(db, user.id, identifier)
    retry_assessment(db, user.id, job)
    value = assessment_view(db, job)
    db.commit()
    return Envelope(data=value)


@router.get("/review-assignments", response_model=Envelope[dict], tags=["Human review"])
def assignments(db: Database, user: CurrentUser, scope: Literal["mine", "sent"] = "mine",
                state: Literal["pending", "draft", "submitted"] | None = None, page: int = Query(1, ge=1, le=1000)):
    if scope == "mine":
        ensure_reviewer(user)
    owner = ReviewAssignment.assigned_by if scope == "sent" else ReviewAssignment.reviewer_id
    query = select(ReviewAssignment).where(owner == user.id)
    if state:
        query = query.where(ReviewAssignment.state == state)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    values = db.scalars(query.order_by(ReviewAssignment.id.desc()).offset((page - 1) * 20).limit(20))
    return Envelope(data={"items": [view_assignment(db, value, user) for value in values], "total": total, "page": page, "page_size": 20})


@router.post("/review-assignments", response_model=Envelope[dict], status_code=201, dependencies=write, tags=["Human review"])
def assign_review(fields: AssignmentRequest, db: Database, user: CurrentUser):
    quota(db, user.id, "assignments", 30)
    value = view_assignment(db, assign(db, user.id, fields), user)
    db.commit()
    return Envelope(data=value)


@router.get("/human-reviews/{identifier}", response_model=Envelope[dict], tags=["Human review"])
def review(identifier: int, db: Database, user: CurrentUser):
    return Envelope(data=view_assignment(db, get_assignment(db, user, identifier), user, full=True))


@router.put("/human-reviews/{identifier}", response_model=Envelope[dict], dependencies=write, tags=["Human review"])
def grade(identifier: int, fields: ReviewInput, db: Database, user: CurrentUser):
    record = get_assignment(db, user, identifier)
    update_review(db, user, record, fields)
    value = view_assignment(db, record, user, full=True)
    db.commit()
    return Envelope(data=value)


@router.get("/review-consensus", response_model=Envelope[dict], tags=["Human review"])
def consensus(response_id: int, rubric_id: int, db: Database, user: CurrentUser, assignment_id: int | None = None):
    rubric = db.get(Rubric, rubric_id)
    if not rubric:
        raise HTTPException(404, "Rubric version not found.")
    if assignment_id is not None:
        record = get_assignment(db, user, assignment_id)
        if (record.response_id != response_id or record.rubric_id != rubric_id or record.state != "submitted"):
            raise HTTPException(404, "Consensus is unavailable for this assignment.")
        digest = record.response_hash
    elif rubric.owner_id == user.id:
        row = get_response(db, user.id, response_id)[0]
        digest = response_hash(row.raw_output)
    else:
        ensure_reviewer(user)
        record = db.scalar(select(ReviewAssignment).where(
            ReviewAssignment.response_id == response_id, ReviewAssignment.rubric_id == rubric_id,
            ReviewAssignment.reviewer_id == user.id, ReviewAssignment.state == "submitted",
        ).order_by(ReviewAssignment.id.desc()).limit(1))
        if record is None:
            raise HTTPException(404, "Consensus is unavailable for this assignment.")
        digest = record.input_snapshot["response_hash"]
    return Envelope(data=collect_consensus(db, response_id, rubric_id, digest))


@router.get("/review-consensus/agreement", response_model=Envelope[dict], tags=["Human review"])
def agreement(rubric_id: int, db: Database, user: CurrentUser, population: Literal["live", "demo"] = "live"):
    owner_rubric(db, user.id, rubric_id)
    return Envelope(data=owner_agreement(db, user.id, rubric_id, population) | {"population": population})


@router.get("/review-consensus/disputes", response_model=Envelope[list[dict]], tags=["Human review"])
def disputes(db: Database, user: CurrentUser, page: int = Query(1, ge=1, le=1000)):
    query = select(ReviewAssignment.response_id, ReviewAssignment.rubric_id).where(
        ReviewAssignment.state == "submitted",
    ).group_by(ReviewAssignment.response_id, ReviewAssignment.rubric_id).having(func.count() >= 2)
    if user.role != "admin":
        query = query.where(ReviewAssignment.assigned_by == user.id)
    records = db.execute(query.order_by(ReviewAssignment.response_id.desc(), ReviewAssignment.rubric_id))
    skip = (page - 1) * 40
    values = []
    for response_id, rubric_id in records:
        response = db.get(ModelResponse, response_id)
        if response.hidden:
            continue
        summary = collect_consensus(db, response_id, rubric_id, response_hash(response.raw_output))
        if summary["status"] in ("disputed", "adjudicated"):
            if skip:
                skip -= 1
                continue
            values.append({"response_id": response_id, "rubric_id": rubric_id, "consensus": summary})
            if len(values) == 40:
                break
    return Envelope(data=values)


@router.post("/review-consensus/adjudicate", response_model=Envelope[dict], dependencies=write, tags=["Human review"])
def adjudicate(fields: Adjudication, db: Database, user: CurrentUser):
    if user.role != "admin":
        raise HTTPException(403, "Only an administrator can adjudicate disputed reviews.")
    quota(db, user.id, "adjudication", 20)
    response = db.get(ModelResponse, fields.response_id)
    if response is None or response.hidden:
        raise HTTPException(404, "Response not found.")
    owner = db.get(Experiment, response.experiment_id).owner_id
    owner_rubric(db, owner, fields.rubric_id)
    current = collect_consensus(db, response.id, fields.rubric_id, response_hash(response.raw_output))
    if current["status"] not in ("disputed", "adjudicated"):
        raise HTTPException(409, "Adjudication is available for disputed responses.")
    selected = [row["id"] for row in current["reviews"]]
    if fields.review_ids is not None and set(fields.review_ids) != set(selected):
        raise HTTPException(409, "The current review set has changed. Reload the disagreement before adjudicating.")
    decision = ReviewDecision(response_id=response.id, rubric_id=fields.rubric_id, adjudicator_id=user.id,
                              justification=fields.justification, verdict=fields.verdict,
                              source_reviews=selected)
    db.add(decision)
    db.flush()
    audit(db, owner, user.id, "review_adjudicated", decision.id, response_id=response.id)
    value = collect_consensus(db, response.id, fields.rubric_id, response_hash(response.raw_output))
    db.commit()
    return Envelope(data=value)


@router.get("/errors/categories", response_model=Envelope[dict], tags=["Error analysis"])
def categories(user: CurrentUser):
    return Envelope(data=ERRORS)


def owner_errors(owner):
    return (select(ResponseError, Dataset.dimension, ModelSnapshot.provider, ModelSnapshot.identifier)
            .join(ModelResponse, ModelResponse.id == ResponseError.response_id).join(Experiment)
            .join(DatasetItem, DatasetItem.id == ModelResponse.item_id).join(Dataset)
            .join(ModelSnapshot, ModelSnapshot.id == ModelResponse.model_id)
            .where(Experiment.owner_id == owner, ModelResponse.hidden.is_(False)))


def error_view(row):
    error, dimension, provider, model = row
    return {"id": error.id, "response_id": error.response_id, "category": error.category, "severity": error.severity,
            "state": error.state, "source": error.source, "evidence": error.evidence, "dimension": dimension,
            "provider": provider, "model": model, "created_at": error.created_at}


@router.get("/errors", response_model=Envelope[dict], tags=["Error analysis"])
def errors(db: Database, user: CurrentUser, dimension: Dimension | None = None, category: str | None = Query(None, max_length=64),
           state: Literal["confirmed", "suggested", "dismissed"] | None = None,
           severity: Literal["minor", "major", "critical"] | None = None, page: int = Query(1, ge=1, le=1000)):
    query = owner_errors(user.id)
    for column, value in ((Dataset.dimension, dimension), (ResponseError.category, category), (ResponseError.state, state),
                          (ResponseError.severity, severity)):
        if value:
            query = query.where(column == value)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(query.order_by(ResponseError.id.desc()).offset((page - 1) * 20).limit(20))
    return Envelope(data={"items": [error_view(row) for row in rows], "total": total, "page": page, "page_size": 20})


@router.get("/errors/{identifier}", response_model=Envelope[dict], tags=["Error analysis"])
def error_detail(identifier: int, db: Database, user: CurrentUser):
    row = db.execute(owner_errors(user.id).where(ResponseError.id == identifier)).one_or_none()
    if row is None:
        raise HTTPException(404, "Error annotation not found.")
    error = row[0]
    snapshot = None
    if error.assignment_id:
        snapshot = db.get(ReviewAssignment, error.assignment_id).input_snapshot
    if error.attempt_id:
        snapshot = db.scalar(select(Assessment.input_snapshot).join(AssessmentAttempt)
                             .where(AssessmentAttempt.id == error.attempt_id))
    return Envelope(data=error_view(row) | {"input": {key: value for key, value in snapshot.items()
                                                    if key != "response_hash"} if snapshot else None})


@router.patch("/errors/{identifier}", response_model=Envelope[dict], dependencies=write, tags=["Error analysis"])
def resolve_error(identifier: int, fields: ErrorResolution, db: Database, user: CurrentUser):
    row = db.execute(owner_errors(user.id).where(ResponseError.id == identifier)).one_or_none()
    if row is None:
        raise HTTPException(404, "Error annotation not found.")
    if row[0].source == "human":
        raise HTTPException(409, "Submitted reviewer annotations are part of the immutable review.")
    row[0].state = fields.state
    audit(db, user.id, user.id, "error_classification_changed", identifier, state=fields.state)
    view = error_view(row)
    db.commit()
    return Envelope(data=view)
