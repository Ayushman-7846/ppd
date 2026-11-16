from collections import Counter, defaultdict
from itertools import combinations
from statistics import fmean

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from .evaluation_models import ReviewAssignment, ReviewDecision, Rubric
from .evaluation_schemas import ERRORS
from .evaluation_service import audit, eligible_response, owner_rubric, rubric_view, write_errors, write_scores
from .models import Experiment, ModelResponse, ModelSnapshot, User
from .queue import now
from .scoring import input_snapshot, metric_score, response_hash


REVIEW_ROLES = ("reviewer", "admin")


def ensure_reviewer(user):
    if user.role not in REVIEW_ROLES:
        raise HTTPException(403, "A reviewer or administrator role is required.")


def assign(db, owner, request):
    rubric = owner_rubric(db, owner, request.rubric_id)
    row = eligible_response(db, owner, request.response_id)
    selected = db.scalar(select(User).where(User.email == request.reviewer.casefold(), User.role.in_(REVIEW_ROLES)))
    if selected is None:
        raise HTTPException(422, "Choose an existing authorized reviewer.")
    if selected.id == owner and request.blind:
        raise HTTPException(422, "Blind review requires a reviewer other than the experiment owner.")
    snapshot = input_snapshot(row)
    assignment = ReviewAssignment(response_id=row[0].id, rubric_id=rubric.id, reviewer_id=selected.id,
                                  assigned_by=owner, blind=request.blind, state="pending", revision=0,
                                  draft={}, input_snapshot=snapshot, response_hash=snapshot["response_hash"])
    db.add(assignment)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(409, "This reviewer already has this response text and rubric version.") from None
    audit(db, owner, owner, "review_assigned", assignment.id, response_id=row[0].id, blind=request.blind)
    return assignment


def view_assignment(db, record, user, full=False):
    rubric = db.get(Rubric, record.rubric_id)
    reviewer = db.get(User, record.reviewer_id)
    input_data = record.input_snapshot
    masked = record.blind and record.state != "submitted" and user.id == record.reviewer_id
    data = {
        "id": record.id, "response_id": record.response_id, "rubric": rubric_view(rubric),
        "dimension": input_data["dimension"], "item_key": input_data["item_key"],
        "state": record.state, "blind": record.blind, "revision": record.revision, "created_at": record.created_at,
        "submitted_at": record.submitted_at, "score": record.score, "verdict": record.verdict,
        "can_edit": record.reviewer_id == user.id and user.role in REVIEW_ROLES and record.state != "submitted",
        "reviewer": reviewer.name,
    }
    if full:
        if not masked:
            response = db.get(ModelResponse, record.response_id)
            model = db.get(ModelSnapshot, response.model_id)
            data["model"] = {"provider": model.provider, "identifier": model.identifier}
        data["item"] = {key: value for key, value in input_data.items() if key != "response_hash"}
        if user.id == record.reviewer_id or record.state == "submitted":
            data["draft"] = record.draft
    return data


def get_assignment(db, user, identifier):
    record = db.get(ReviewAssignment, identifier)
    if record is None or user.id not in (record.assigned_by, record.reviewer_id):
        raise HTTPException(404, "Review assignment not found.")
    if record.reviewer_id == user.id and record.assigned_by != user.id:
        ensure_reviewer(user)
    return record


def update_review(db, user, record, request):
    ensure_reviewer(user)
    if user.id != record.reviewer_id:
        raise HTTPException(403, "Only the assigned reviewer can grade this response.")
    rubric = db.get(Rubric, record.rubric_id)
    task = record.input_snapshot["dimension"]
    if any(entry.category not in ERRORS["general"] + ERRORS[task] for entry in request.errors):
        raise HTTPException(422, "Use error categories for this task.")
    score = metric_score(rubric.weights, request.scores)
    if request.submit and (request.verdict is None or not request.comment.strip()
                           or (request.verdict != "uncertain" and score is None)):
        raise HTTPException(422, "Submit a verdict and comment. A decisive verdict also requires all weighted criterion scores.")
    data = request.model_dump(exclude={"revision", "submit"})
    final_state = "submitted" if request.submit else "draft"
    revised = db.execute(update(ReviewAssignment).where(
        ReviewAssignment.id == record.id, ReviewAssignment.revision == request.revision,
        ReviewAssignment.state != "submitted",
    ).values(draft=data, revision=request.revision + 1, state=final_state,
             score=score if request.submit else None, verdict=request.verdict if request.submit else None,
             submitted_at=now() if request.submit else None))
    if revised.rowcount != 1:
        raise HTTPException(409, "This review was changed or submitted. Reload the assignment.")
    if request.submit:
        write_scores(db, record.response_id, rubric.id, "human", request.scores, {}, assignment_id=record.id, reviewer_id=user.id)
        write_errors(db, data["errors"], record.response_id, "human", assignment_id=record.id)
    audit(db, record.assigned_by, user.id, "review_submitted" if request.submit else "review_draft_saved", record.id, revision=request.revision + 1)
    db.flush()
    db.refresh(record)


def consensus_summary(rows, decision=None):
    submitted = [row for row in rows if row.state == "submitted"]
    if decision and set(decision.source_reviews) != {row.id for row in submitted}:
        decision = None
    votes = Counter(row.verdict for row in submitted)
    decisive = votes["correct"] + votes["incorrect"]
    majority = next((value for value in ("correct", "incorrect") if votes[value] > decisive / 2), None)
    scores = [row.score for row in submitted if row.score is not None]
    disagreement = max(scores) - min(scores) if len(scores) >= 2 else None
    disputed = (votes["correct"] and votes["incorrect"]) or (disagreement is not None and disagreement >= 20)
    observed = [row.verdict for row in submitted if row.verdict in ("correct", "incorrect")]
    pairs = list(combinations(observed, 2))
    status = "adjudicated" if decision else "disputed" if disputed else "awaiting_reviews" if len(submitted) < 2 else "reviewed"
    return {
        "assigned": len(rows), "submitted": len(submitted), "decisive": decisive, "votes": dict(votes),
        "majority": majority if len(submitted) >= 2 and decisive >= 2 else None,
        "final_verdict": decision.verdict if decision else (majority if status == "reviewed" and decisive >= 2 else None),
        "mean_score": round(fmean(scores), 4) if scores else None, "scored_reviews": len(scores),
        "score_range": round(disagreement, 4) if disagreement is not None else None,
        "pair_agreement": 100 * fmean(a == b for a, b in pairs) if pairs else None,
        "status": status, "reviews": [{"id": row.id, "reviewer_id": row.reviewer_id, "verdict": row.verdict,
                                      "score": row.score, "comment": row.draft.get("comment", "")} for row in submitted],
        "decision": {"id": decision.id, "verdict": decision.verdict, "justification": decision.justification,
                     "review_ids": decision.source_reviews, "adjudicator_id": decision.adjudicator_id,
                     "created_at": decision.created_at} if decision else None,
    }


def collect_consensus(db, response_id, rubric_id, response_hash=None):
    query = select(ReviewAssignment).where(
        ReviewAssignment.response_id == response_id, ReviewAssignment.rubric_id == rubric_id,
    )
    if response_hash is not None:
        query = query.where(ReviewAssignment.response_hash == response_hash)
    rows = list(db.scalars(query.order_by(ReviewAssignment.id)))
    submitted = {row.id for row in rows if row.state == "submitted"}
    decisions = db.scalars(select(ReviewDecision).where(ReviewDecision.response_id == response_id,
                                                       ReviewDecision.rubric_id == rubric_id)
                           .order_by(ReviewDecision.id.desc()))
    decision = next((entry for entry in decisions if set(entry.source_reviews) == submitted), None)
    return consensus_summary(rows, decision)


def agree(groups):
    """Calculate agreement only from complete binary groups with the stated design."""
    complete = [{user: rating for user, rating in row.items() if rating in ("correct", "incorrect")} for row in groups]
    valid = [row for row in complete if len(row) >= 2]
    pairs = [pair for row in valid for pair in combinations(row.values(), 2)]
    observed = fmean(a == b for a, b in pairs) if pairs else None
    response_count = len(valid)
    measure = value = None
    if response_count >= 2 and all(len(row) == 2 and row.keys() == valid[0].keys() for row in valid):
        first, second = sorted(valid[0])
        p1 = fmean(row[first] == "correct" for row in valid)
        p2 = fmean(row[second] == "correct" for row in valid)
        expected = p1 * p2 + (1 - p1) * (1 - p2)
        measure = "Cohen's kappa"
        if expected < 1:
            value = (observed - expected) / (1 - expected)
    elif response_count >= 2 and all(len(row) == len(valid[0]) >= 3 for row in valid):
        frequency = fmean(rating == "correct" for row in valid for rating in row.values())
        expected = frequency ** 2 + (1 - frequency) ** 2
        measure = "Fleiss' kappa"
        if expected < 1:
            value = (observed - expected) / (1 - expected)
    return {"responses": response_count, "excluded_responses": len(groups) - response_count, "pairs": len(pairs),
            "percent_agreement": round(observed * 100, 4) if observed is not None else None,
            "coefficient": value, "method": measure, "message": None if value is not None else
            "Insufficient data for reliable statistical analysis."}


def owner_agreement(db, owner, rubric_id, population):
    source = ModelSnapshot.provider == "demo" if population == "demo" else ModelSnapshot.provider != "demo"
    rows = db.execute(select(ReviewAssignment, ModelResponse.raw_output).join(ModelResponse, ModelResponse.id == ReviewAssignment.response_id)
                     .join(Experiment).join(ModelSnapshot, ModelSnapshot.id == ModelResponse.model_id)
                     .where(Experiment.owner_id == owner, ReviewAssignment.rubric_id == rubric_id,
                            ReviewAssignment.state == "submitted", ModelResponse.hidden.is_(False),
                            ModelResponse.state.in_(("completed", "failed")), ModelResponse.raw_output.is_not(None), source))
    grouped = defaultdict(dict)
    for row, output in rows:
        if row.response_hash == response_hash(output):
            grouped[row.response_id][row.reviewer_id] = row.verdict
    return agree(list(grouped.values()))
