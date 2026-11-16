from datetime import datetime, timezone
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import Response
from sqlalchemy import func, select

from .auth import CurrentUser, same_origin
from .config import get_settings
from .database import Database
from .evaluation_models import Assessment, AssessmentAttempt, ResearchSnapshot, ReviewAssignment
from .evaluation_service import audit, default_rubric, owned_assessments, owner_rubric, rubric_view
from .lab_schemas import InputModel, Name
from .models import Dataset, DatasetItem, Experiment, ModelResponse, ModelSnapshot, Report
from .queue import quota
from .reporting import LABELS, csv_report, pdf_report
from .schemas import Envelope
from .scientific import MAX_OBSERVATIONS, StudyFilter, analytics_view, comparison_view, consistency_view, observations, repeat_groups
from .semantic import embedded_matrix


router = APIRouter()
write = [Depends(same_origin)]


class ReportRequest(InputModel):
    title: Name
    type: Literal["experiment", "comparison", "task", "consistency", "evaluation"]
    filters: StudyFilter


def options(db, owner):
    models = db.execute(select(ModelSnapshot.id, ModelSnapshot.identifier, ModelSnapshot.provider)
                        .join(ModelResponse, ModelResponse.model_id == ModelSnapshot.id).join(Experiment)
                        .where(Experiment.owner_id == owner, ModelResponse.hidden.is_(False))
                        .distinct().order_by(ModelSnapshot.identifier).limit(120))
    data = db.execute(select(Dataset.id, Dataset.name, Dataset.version, Dataset.dimension, Dataset.kind)
                      .join(DatasetItem).join(ModelResponse).join(Experiment)
                      .where(Experiment.owner_id == owner, ModelResponse.hidden.is_(False)).distinct().limit(160))
    batches = db.scalars(select(Experiment).where(Experiment.owner_id == owner).order_by(Experiment.id.desc()).limit(160))
    return {"models": [dict(id=i, name=n, provider=p) for i, n, p in models],
            "datasets": [dict(id=i, name=n if k == "user" else ("Teaching " + d if k == "builtin" else "Manual input"),
                              version=v, dimension=d) for i, n, v, d, k in data],
            "experiments": [{"id": row.id, "name": row.name, "state": row.state, "repetitions": row.repetitions}
                            for row in batches], "semantic_model": get_settings().semantic_model or None}


@router.get("/analytics/options", response_model=Envelope[dict], tags=["Research analytics"])
def filter_options(db: Database, user: CurrentUser):
    return Envelope(data=options(db, user.id))


def finalize_comparison(view, filters):
    if filters.model_ids and set(filters.model_ids) != {model["id"] for model in view["models"]}:
        view.update(comparable=False, warning="Some selected models have no responses in this cohort.", findings=[])
        for model in view["models"]:
            model["rank"] = None
    return view


def snapshot_view(snapshot, full=False):
    value = {"id": snapshot.id, "kind": snapshot.kind, "created_at": snapshot.created_at, "filters": snapshot.filters}
    if full:
        value["result"] = snapshot.result
    return value


def save_analysis(db, owner, kind, filters, view):
    record = ResearchSnapshot(owner_id=owner, kind=kind, filters=filters.model_dump(mode="json"), result=jsonable_encoder(view))
    db.add(record)
    db.flush()
    audit(db, owner, owner, "research_snapshot_saved", record.id, kind=kind)
    return record.id


@router.post("/model-comparisons", response_model=Envelope[dict], dependencies=write, tags=["Research analytics"])
def compare(filters: StudyFilter, db: Database, user: CurrentUser):
    if filters.save:
        quota(db, user.id, "research_snapshots", 18)
    rows, rubric = observations(db, user.id, filters)
    view = finalize_comparison(comparison_view(rows, filters.minimum_items), filters)
    view.update(rubric=rubric, method=filters.method, population=filters.population)
    if filters.save:
        view["snapshot_id"] = save_analysis(db, user.id, "comparison", filters, view)
    db.commit()
    return Envelope(data=view)


@router.post("/leaderboard", response_model=Envelope[dict], dependencies=write, tags=["Research analytics"])
def leaderboard(filters: StudyFilter, db: Database, user: CurrentUser):
    rows, rubric = observations(db, user.id, filters)
    view = finalize_comparison(comparison_view(rows, filters.minimum_items), filters)
    view.pop("explorer")
    db.commit()
    return Envelope(data=view | {"rubric": rubric, "method": filters.method, "population": filters.population})


@router.post("/consistency", response_model=Envelope[dict], dependencies=write, tags=["Research analytics"])
def consistency(filters: StudyFilter, db: Database, user: CurrentUser):
    if filters.save:
        quota(db, user.id, "research_snapshots", 18)
    if filters.semantic:
        quota(db, user.id, "semantic", 5)
    rows, rubric = observations(db, user.id, filters)
    view = consistency_view(rows) | {"rubric": rubric, "method": filters.method, "population": filters.population}
    if filters.semantic:
        groups = [sorted(group, key=lambda row: (row.response.trial, row.response.id))
                  for group in repeat_groups(rows).values() if len(group) >= 2]
        if len(groups) != 1:
            raise HTTPException(422, "Select exactly one matched group for semantic similarity.")
        outputs = [row.response.raw_output for row in groups[0]]
        db.commit()
        view["semantic"] = embedded_matrix(outputs)
    if filters.save:
        view["snapshot_id"] = save_analysis(db, user.id, "consistency", filters, view)
    db.commit()
    return Envelope(data=view)


@router.get("/model-comparisons", response_model=Envelope[list[dict]], tags=["Research analytics"])
@router.get("/consistency", response_model=Envelope[list[dict]], tags=["Research analytics"])
def snapshot_list(request: Request, db: Database, user: CurrentUser, kind: Literal["comparison", "consistency"] | None = None,
                  page: int = Query(1, ge=1, le=1000)):
    expected = "consistency" if request.url.path.endswith("/consistency") else "comparison"
    if kind and kind != expected:
        raise HTTPException(422, "Use the route for the requested research snapshot type.")
    query = select(ResearchSnapshot).where(ResearchSnapshot.owner_id == user.id, ResearchSnapshot.kind == expected)
    return Envelope(data=[snapshot_view(row) for row in db.scalars(
        query.order_by(ResearchSnapshot.id.desc()).offset((page - 1) * 20).limit(20))])


@router.get("/model-comparisons/{identifier}", response_model=Envelope[dict], tags=["Research analytics"])
@router.get("/consistency/{identifier}", response_model=Envelope[dict], tags=["Research analytics"])
def snapshot_detail(identifier: int, request: Request, db: Database, user: CurrentUser):
    expected = "consistency" if "/consistency/" in request.url.path else "comparison"
    row = db.scalar(select(ResearchSnapshot).where(ResearchSnapshot.id == identifier, ResearchSnapshot.owner_id == user.id,
                                                   ResearchSnapshot.kind == expected))
    if row is None:
        raise HTTPException(404, "Research snapshot not found.")
    return Envelope(data=snapshot_view(row, True))


@router.post("/analytics", response_model=Envelope[dict], dependencies=write, tags=["Research analytics"])
def analytics(filters: StudyFilter, db: Database, user: CurrentUser):
    rows, rubric = observations(db, user.id, filters)
    view = analytics_view(db, rows, filters, rubric)
    view["comparison"] = finalize_comparison(view["comparison"], filters)
    db.commit()
    return Envelope(data=view | {"rubric": rubric, "method": filters.method, "population": filters.population})


@router.post("/statistics", response_model=Envelope[dict], dependencies=write, tags=["Research analytics"])
def statistics(filters: StudyFilter, db: Database, user: CurrentUser):
    rows, rubric = observations(db, user.id, filters)
    view = analytics_view(db, rows, filters, rubric)
    db.commit()
    return Envelope(data={key: view[key] for key in ("metrics", "definitions", "metric_version", "review_agreement")} |
                    {"paired": view["comparison"]["paired"], "rubric": rubric, "method": filters.method, "population": filters.population})


def owned_report(db, owner, identifier):
    query = select(Report).join(Experiment).where(Report.id == identifier, Experiment.owner_id == owner)
    report = db.scalar(query)
    if report is None or report.specification.get("report_version") != 1:
        raise HTTPException(404, "Research report not found.")
    return report.specification | {"id": report.id}


@router.get("/reports", response_model=Envelope[list[dict]], tags=["Reports"])
def reports(db: Database, user: CurrentUser, page: int = Query(1, ge=1, le=1000)):
    query = (select(Report).join(Experiment).where(Experiment.owner_id == user.id,
               Report.specification["report_version"].as_integer() == 1).order_by(Report.id.desc())
             .offset((page - 1) * 20).limit(20))
    return Envelope(data=[{"id": row.id, **{key: row.specification[key] for key in ("title", "type", "generated_at", "population")}}
                          for row in db.scalars(query)])


@router.post("/reports", response_model=Envelope[dict], status_code=201, dependencies=write, tags=["Reports"])
def generate_report(fields: ReportRequest, db: Database, user: CurrentUser):
    filters = fields.filters
    if not filters.experiment_ids:
        raise HTTPException(422, "Choose at least one settled experiment for the report.")
    quota(db, user.id, "reports", 10)
    runs = list(db.scalars(select(Experiment).where(Experiment.owner_id == user.id, Experiment.id.in_(filters.experiment_ids))
                           .order_by(Experiment.id)))
    if len(runs) != len(set(filters.experiment_ids)):
        raise HTTPException(404, "An experiment was not found.")
    if any(run.state not in ("completed", "failed", "cancelled") for run in runs):
        raise HTTPException(409, "Wait for selected experiments to settle before reporting.")
    if fields.type == "experiment" and len(runs) != 1:
        raise HTTPException(422, "An individual experiment report uses one experiment.")
    if fields.type == "task" and filters.dimension is None:
        raise HTTPException(422, "Choose a linguistic task for this report.")
    rows, rubric = observations(db, user.id, filters)
    if not rows:
        raise HTTPException(422, "No responses match the selected report source and filters.")
    analytic = analytics_view(db, rows, filters, rubric)
    analytic["comparison"] = finalize_comparison(analytic["comparison"], filters)
    analytic["comparison"].pop("explorer")
    result = {
        "report_version": 1, "title": fields.title, "type": fields.type, "researcher": user.name,
        "generated_at": datetime.now(timezone.utc).isoformat(), "population": filters.population,
        "method": filters.method, "rubric": rubric, "filters": filters.model_dump(mode="json"),
        "experiments": [{"id": run.id, "name": run.name, "state": run.state, "protocol": run.protocol,
                         "repetitions": run.repetitions} for run in runs],
        "analytics": analytic, "consistency": consistency_view(rows),
        "trials": [{"id": row.response.id, "experiment_id": row.run.id, "dataset": row.dataset.name if row.dataset.kind == "user" else row.dataset.dimension,
                    "dataset_version": row.dataset.version, "item_key": row.item.item_key, "dimension": row.dataset.dimension,
                    "provider": row.model.provider, "model": row.model.identifier, "trial": row.response.trial, "state": row.response.state,
                    "score": row.score, "verdict": row.verdict, "latency_ms": row.response.execution.get("latency_ms"),
                    "input_tokens": row.response.execution.get("input_tokens"), "output_tokens": row.response.execution.get("output_tokens"),
                    "errors": sorted({item["category"] for item in row.errors or []}), "evaluation": row.evaluation} for row in rows],
    }
    record = Report(experiment_id=runs[0].id, specification=jsonable_encoder(result))
    db.add(record)
    db.flush()
    audit(db, user.id, user.id, "research_report_created", record.id, type=fields.type)
    result = record.specification | {"id": record.id}
    db.commit()
    return Envelope(data=result)


@router.get("/reports/{identifier}", response_model=Envelope[dict], tags=["Reports"])
def view_report(identifier: int, db: Database, user: CurrentUser):
    return Envelope(data=owned_report(db, user.id, identifier))


@router.get("/reports/export/{identifier}", tags=["Reports"])
def export_report(identifier: int, db: Database, user: CurrentUser, format: Literal["pdf", "csv", "json"] = "pdf"):
    record = owned_report(db, user.id, identifier)
    if format == "pdf":
        content, media = pdf_report(record), "application/pdf"
    elif format == "csv":
        content, media = csv_report(record), "text/csv"
    else:
        content, media = json.dumps(record, ensure_ascii=False, indent=2), "application/json"
    return Response(content, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="lingualens-report-{identifier}.{format}"'})


@router.get("/analytics/dashboard", response_model=Envelope[dict], tags=["Research analytics"])
def dashboard(db: Database, user: CurrentUser):
    assessed = (owned_assessments(user.id).join(ModelSnapshot, ModelSnapshot.id == ModelResponse.model_id)
                .where(ModelSnapshot.provider != "demo"))
    latest = db.scalar(assessed.join(AssessmentAttempt).where(AssessmentAttempt.score.is_not(None))
                       .order_by(AssessmentAttempt.id.desc()).limit(1))
    filters = (StudyFilter(method=latest.method, rubric_id=latest.rubric_id) if latest else StudyFilter())
    trial_count, experiments, model_count = db.execute(select(func.count(ModelResponse.id),
        func.count(ModelResponse.experiment_id.distinct()), func.count(ModelResponse.model_id.distinct()))
        .select_from(ModelResponse).join(Experiment).join(ModelSnapshot).where(Experiment.owner_id == user.id, ModelSnapshot.provider != "demo",
                                                    ModelResponse.hidden.is_(False))).one()
    warning = None
    if trial_count > MAX_OBSERVATIONS:
        rubric = rubric_view(owner_rubric(db, user.id, filters.rubric_id) if filters.rubric_id else default_rubric(db, user.id))
        stats = {"metrics": {"score": {"mean": None}, "correctness_rate": None}, "comparison": {"findings": []},
                 "repeat_summary": dict.fromkeys(("classification", "structure", "verdict", "exact"))}
        warning = "This workspace has more than 2,000 live responses. Use cohort filters in Research Analytics to calculate scores and agreement."
    else:
        rows, rubric = observations(db, user.id, filters)
        stats = analytics_view(db, rows, filters, rubric)
    recent = list(db.scalars(assessed.order_by(Assessment.id.desc()).limit(6)))
    live_reviews = (select(ReviewAssignment).join(ModelResponse, ModelResponse.id == ReviewAssignment.response_id)
                    .join(Experiment).join(ModelSnapshot, ModelSnapshot.id == ModelResponse.model_id)
                    .where(Experiment.owner_id == user.id, ModelSnapshot.provider != "demo", ModelResponse.hidden.is_(False)))
    pending = db.scalar(select(func.count()).select_from(live_reviews.where(ReviewAssignment.state != "submitted").subquery()))
    evaluated = (assessed.join(AssessmentAttempt).where(AssessmentAttempt.state.in_(("completed", "needs_human_review")))
                 .with_only_columns(Assessment.response_id)
                 .union(live_reviews.where(ReviewAssignment.state == "submitted").with_only_columns(ReviewAssignment.response_id)))
    evaluated_count = db.scalar(select(func.count()).select_from(evaluated.subquery()))
    snapshots = list(db.scalars(select(ResearchSnapshot).where(ResearchSnapshot.owner_id == user.id)
                           .order_by(ResearchSnapshot.id.desc()).limit(6)))
    files = list(db.scalars(select(Report).join(Experiment).where(Experiment.owner_id == user.id)
                            .where(Report.specification["report_version"].as_integer() == 1)
                            .order_by(Report.id.desc()).limit(6)))
    db.commit()
    return Envelope(data={
        "experiments": experiments, "model_count": model_count, "evaluated": evaluated_count, "warning": warning,
        "pending_reviews": pending, "correctness_rate": stats["metrics"]["correctness_rate"],
        "method": filters.method, "rubric": rubric,
        "score": stats["metrics"]["score"]["mean"], "best": stats["comparison"]["findings"], "repeats": stats["repeat_summary"],
        "recent": [{"id": row.id, "response_id": row.response_id, "method": row.method, "state": row.state} for row in recent],
        "snapshots": [snapshot_view(row) for row in snapshots],
        "reports": [{"id": row.id, "title": row.specification.get("title"), "population": row.specification.get("population")} for row in files],
    })
