from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from hashlib import sha256
from itertools import combinations
import json
import random
from statistics import fmean, median, quantiles, stdev, variance
from typing import Literal

from fastapi import HTTPException
from pydantic import Field, model_validator
from sqlalchemy import func, select

from .evaluation_models import Assessment, AssessmentAttempt, ResponseError, ReviewAssignment, ReviewDecision
from .evaluation_schemas import DEFAULT_WEIGHTS, Id, Method
from .evaluation_service import default_rubric, owner_rubric, rubric_view
from .lab_schemas import DIMENSIONS, InputModel
from .models import Dataset, DatasetItem, Experiment, ModelResponse, ModelSnapshot
from .reviews import agree, consensus_summary
from .schemas import Dimension
from .scoring import response_hash


VERSION = "statistics-v3"
CONSISTENCY_VERSION = "repeat-agreement-v3"
INSUFFICIENT = "Insufficient data for reliable statistical analysis."
MIN_INTERVAL = 8
MAX_OBSERVATIONS = 2000


class StudyFilter(InputModel):
    model_ids: list[Id] = Field(default_factory=list, max_length=12)
    experiment_ids: list[Id] = Field(default_factory=list, max_length=20)
    dataset_ids: list[Id] = Field(default_factory=list, max_length=20)
    dimension: Dimension | None = None
    provider: Literal["openai", "gemini", "anthropic", "openrouter", "ollama", "demo"] | None = None
    rubric_id: Id | None = None
    method: Method = "deterministic"
    date_from: date | None = None
    date_to: date | None = None
    population: Literal["live", "demo"] = "live"
    minimum_items: int = Field(5, ge=3, le=100)
    item_id: Id | None = None
    prompt_id: Id | None = None
    temperature: float | None = Field(None, ge=0, le=2)
    repetitions: int | None = Field(None, ge=2, le=5)
    semantic: bool = False
    save: bool = False

    @model_validator(mode="after")
    def date_order(self):
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("The end date must follow the start date.")
        return self


@dataclass
class Observation:
    response: ModelResponse
    item: DatasetItem
    dataset: Dataset
    model: ModelSnapshot
    run: Experiment
    score: float | None = None
    criteria: dict | None = None
    verdict: str | None = None
    evaluation: dict | None = None
    errors: list | None = None


def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def independent_item(observation):
    return sha256(stable([observation.dataset.dimension, observation.item.stimulus]).encode()).hexdigest()


def protocol(observation):
    row = observation.response
    return (
        observation.dataset.id, observation.dataset.version, observation.item.id,
        row.execution.get("prompt_id", observation.run.prompt_id), row.execution.get("prompt_version"),
        sha256(row.prompt_rendered.encode()).hexdigest(), stable(row.execution.get("parameters", {})),
        int(observation.run.repetitions), row.trial,
        stable((observation.evaluation or {}).get("configuration", {})),
    )


def mean_or_none(values):
    observed = [value for value in values if value is not None]
    return round(fmean(observed), 4) if observed else None


def describe(values, *, interval=True):
    values = sorted(float(value) for value in values if value is not None)
    count = len(values)
    result = {
        "n": count, "mean": mean_or_none(values), "median": median(values) if count else None,
        "sample_variance": variance(values) if count > 1 else None, "sample_sd": stdev(values) if count > 1 else None,
        "confidence_interval": None, "confidence_level": .95 if interval else None,
    }
    if interval and count >= MIN_INTERVAL and min(values) < max(values):
        rng = random.Random(814729)
        distribution = [fmean(rng.choices(values, k=count)) for _ in range(1200)]
        cuts = quantiles(distribution, n=40, method="inclusive")
        result["confidence_interval"] = [round(cuts[0], 4), round(cuts[-1], 4)]
    return result


def bucketed(observations, key):
    groups = defaultdict(list)
    for row in observations:
        groups[key(row)].append(row)
    return groups


def attempt_evidence(db, rows, rubric, method):
    index = {item.response.id: item for item in rows}
    if not index:
        return
    digests = {identifier: response_hash(row.response.raw_output) for identifier, row in index.items()
               if row.response.raw_output is not None and row.response.state in ("completed", "failed")}
    if method in ("deterministic", "judge"):
        records = db.execute(
            select(Assessment, AssessmentAttempt).join(AssessmentAttempt)
            .where(Assessment.response_id.in_(index), Assessment.rubric_id == rubric.id, Assessment.method == method,
                   AssessmentAttempt.state.in_(("completed", "needs_human_review")))
            .order_by(AssessmentAttempt.id.desc())
        )
        for job, attempt in records:
            row = index[job.response_id]
            if row.evaluation or not digests.get(job.response_id) or digests[job.response_id] != job.input_snapshot.get("response_hash"):
                continue
            value = attempt.result
            row.score, row.criteria, row.verdict = attempt.score, value.get("scores"), value.get("verdict")
            row.evaluation = {"id": job.id, "attempt_id": attempt.id, "method": method, "rubric_id": rubric.id,
                              "configuration": {"judge_id": job.judge_id, "parameters": job.judge_config,
                                                "reported_model": value.get("transport", {}).get("reported_model"),
                                                "metric_version": value.get("metric_version")}}
    else:
        reviews = db.scalars(select(ReviewAssignment).where(ReviewAssignment.response_id.in_(index),
                             ReviewAssignment.rubric_id == rubric.id, ReviewAssignment.state == "submitted"))
        grouped = defaultdict(list)
        for review in reviews:
            if digests.get(review.response_id) == review.response_hash:
                grouped[review.response_id].append(review)
        decisions = defaultdict(list)
        for decision in db.scalars(select(ReviewDecision).where(ReviewDecision.response_id.in_(index),
                                  ReviewDecision.rubric_id == rubric.id).order_by(ReviewDecision.id)):
            decisions[decision.response_id].append(decision)
        for identifier, submitted in grouped.items():
            row = index[identifier]
            review_ids = {record.id for record in submitted}
            decision = next((entry for entry in reversed(decisions[identifier]) if set(entry.source_reviews) == review_ids), None)
            summary = consensus_summary(submitted, decision if method == "consensus" else None)
            if method == "human":
                row.score = summary["mean_score"]
                row.verdict = summary["majority"] if summary["status"] != "disputed" else "uncertain"
                if len(submitted) == 1:
                    row.verdict = submitted[0].verdict
                row.criteria = {key: mean_or_none(record.draft.get("scores", {}).get(key) for record in submitted)
                                for key in DEFAULT_WEIGHTS}
            else:
                row.verdict = summary["final_verdict"]
            row.evaluation = {"method": method, "rubric_id": rubric.id,
                              "configuration": {"reviewers": sorted(record.reviewer_id for record in submitted)},
                              "reviews": summary["reviews"], "consensus": summary["status"]}

    for error in db.scalars(select(ResponseError).where(ResponseError.response_id.in_(index),
                             ResponseError.state != "dismissed").order_by(ResponseError.id)):
        row = index[error.response_id]
        if not row.evaluation:
            continue
        if method in ("deterministic", "judge") and error.attempt_id != row.evaluation.get("attempt_id"):
            continue
        if method in ("human", "consensus") and error.assignment_id not in {item["id"] for item in row.evaluation.get("reviews", [])}:
            continue
        if row.errors is None:
            row.errors = []
        row.errors.append({"category": error.category, "state": error.state, "severity": error.severity, "evidence": error.evidence})


def observations(db, owner, filters):
    rubric = owner_rubric(db, owner, filters.rubric_id) if filters.rubric_id else default_rubric(db, owner)
    query = (select(ModelResponse, DatasetItem, Dataset, ModelSnapshot, Experiment)
             .join(Experiment, Experiment.id == ModelResponse.experiment_id)
             .join(DatasetItem, DatasetItem.id == ModelResponse.item_id).join(Dataset)
             .join(ModelSnapshot, ModelSnapshot.id == ModelResponse.model_id)
             .where(Experiment.owner_id == owner, ModelResponse.hidden.is_(False)))
    query = query.where(ModelSnapshot.provider == "demo" if filters.population == "demo" else ModelSnapshot.provider != "demo")
    for column, values in ((ModelSnapshot.id, filters.model_ids), (Experiment.id, filters.experiment_ids),
                           (Dataset.id, filters.dataset_ids)):
        if values:
            query = query.where(column.in_(values))
    for column, value in ((Dataset.dimension, filters.dimension), (ModelSnapshot.provider, filters.provider),
                          (DatasetItem.id, filters.item_id), (Experiment.repetitions, filters.repetitions)):
        if value is not None:
            query = query.where(column == value)
    if filters.date_from:
        query = query.where(ModelResponse.created_at >= datetime.combine(filters.date_from, time.min, timezone.utc))
    if filters.date_to:
        end = datetime.combine(filters.date_to, time.max, timezone.utc)
        query = query.where(ModelResponse.created_at <= end)
    if filters.prompt_id is not None:
        query = query.where(func.coalesce(ModelResponse.execution["prompt_id"].as_integer(), Experiment.prompt_id) == filters.prompt_id)
    if filters.temperature is not None:
        query = query.where(ModelResponse.execution["parameters"]["temperature"].as_float() == filters.temperature)
    rows = [Observation(*row) for row in db.execute(query.order_by(ModelResponse.id).limit(MAX_OBSERVATIONS + 1))]
    if len(rows) > MAX_OBSERVATIONS:
        raise HTTPException(422, "Narrow the research filters to at most 2,000 responses.")
    # Chunks stay below SQLite parameter limits and avoid oversized IN predicates.
    for offset in range(0, len(rows), 300):
        attempt_evidence(db, rows[offset:offset + 300], rubric, filters.method)
    return rows, rubric_view(rubric)


def item_scores(rows):
    return {key: mean_or_none(row.score for row in members)
            for key, members in bucketed(rows, independent_item).items()}


def scoring_metrics(rows):
    scored = [row.score for row in rows if row.score is not None]
    evaluated = [row for row in rows if row.evaluation is not None]
    decisive = [row.verdict for row in rows if row.verdict in ("correct", "incorrect")]
    settled = [row for row in rows if row.response.state in ("completed", "failed")]
    failures = sum(row.response.state == "failed" for row in settled)
    errors = Counter(category for row in rows for category in {item["category"] for item in row.errors or []})
    latency = [row.response.execution.get("latency_ms") for row in settled]
    in_tokens = [row.response.execution.get("input_tokens") for row in settled]
    out_tokens = [row.response.execution.get("output_tokens") for row in settled]
    return {
        "responses": len(rows), "settled": len(settled), "failed": failures, "evaluated": len(evaluated),
        "weighted_scores": len(scored), "score": describe(item_scores(rows).values()),
        "correctness_rate": round(decisive.count("correct") * 100 / len(decisive), 4) if decisive else None,
        "decisive": len(decisive), "missing_scores": len(rows) - len(scored),
        "criteria": {key: mean_or_none((row.criteria or {}).get(key) for row in rows) for key in DEFAULT_WEIGHTS},
        "failure_rate": round(failures * 100 / len(settled), 4) if settled else None,
        "annotated_error_rate": round(sum(bool(row.errors) for row in evaluated) * 100 / len(evaluated), 4) if evaluated else None,
        "latency_ms": mean_or_none(latency), "latency_n": sum(value is not None for value in latency),
        "input_tokens": mean_or_none(in_tokens), "output_tokens": mean_or_none(out_tokens),
        "input_tokens_n": sum(value is not None for value in in_tokens), "output_tokens_n": sum(value is not None for value in out_tokens),
        "errors": dict(errors), "distribution": [sum(start <= value < end for value in scored)
                                                  for start, end in [(0, 20), (20, 40), (40, 60), (60, 80), (80, 101)]],
    }


def tree_signature(root, indexes=None):
    indexes = {} if indexes is None else indexes
    index = root.get("trace_index")
    canonical = indexes.setdefault(index, len(indexes) + 1) if index is not None else None
    return [root.get("label"), root.get("lexical"), canonical, root.get("features") or {},
            [tree_signature(child, indexes) for child in root.get("children", [])]]


def response_signature(row, name):
    output = row.response.parsed_output
    if name == "verdict":
        return row.verdict if row.verdict in ("correct", "incorrect") else None
    if name == "exact":
        return response_hash(row.response.raw_output) if row.response.raw_output is not None else None
    if not output:
        return None
    task = row.dataset.dimension
    if name == "classification":
        return stable([output.get("detected"), output.get("category"), output.get("input_phone"), output.get("output_phone"),
                       output.get("environment")])
    if task == "phonology":
        return stable(output["substitution"]) if output.get("substitution") else None
    if task == "ambiguity":
        return stable(sorted(stable(tree_signature(item["tree"])) for item in output["readings"]))
    trees = [tree_signature(output["tree"])]
    if output.get("expanded_tree"):
        trees.append(tree_signature(output["expanded_tree"]))
    return stable(trees)


def repeat_groups(rows):
    return bucketed(rows, lambda row: (row.run.id, row.model.id, row.item.id, protocol(row)[:8],
                                      row.response.execution.get("reported_model")))


def agreement_for(values):
    pairs = list(combinations([item for item in values if item is not None], 2))
    return {"pairs": len(pairs), "percent": round(fmean(a == b for a, b in pairs) * 100, 4) if pairs else None}


def repeat_metrics(rows, matrix=False):
    names = ("verdict", "classification", "exact", "structure")
    signatures = {name: [response_signature(row, name) for row in rows] for name in names}
    configs = {protocol(row)[-1] for row in rows if row.evaluation is not None}
    if len(configs) > 1:
        signatures["verdict"] = [None] * len(rows)
    result = {name: agreement_for(values) for name, values in signatures.items()}
    result["score"] = describe([row.score for row in rows] if len(configs) <= 1 else [], interval=False)
    if matrix:
        trees = signatures["structure"]
        result["matrix"] = [[int(a == b) if a is not None and b is not None else None for b in trees] for a in trees]
    return result


def consistency_view(rows):
    groups = []
    for members in repeat_groups(rows).values():
        if len(members) < 2:
            continue
        members = sorted(members, key=lambda row: (row.response.trial, row.response.id))
        first = members[0]
        groups.append({
            "experiment_id": first.run.id, "experiment": first.run.name, "model_id": first.model.id,
            "model": first.model.identifier, "provider": first.model.provider, "item_id": first.item.id,
            "item_key": first.item.item_key, "dimension": first.dataset.dimension, "dataset_version": first.dataset.version,
            "prompt_id": first.response.execution.get("prompt_id", first.run.prompt_id),
            "parameters": first.response.execution.get("parameters", {}),
            "metrics": repeat_metrics(members, matrix=True),
            "trials": [{"id": row.response.id, "trial": row.response.trial, "score": row.score, "verdict": row.verdict,
                        "state": row.response.state, "timestamp": row.response.created_at} for row in members],
        })
    summary = {metric: mean_or_none(group["metrics"][metric]["percent"] for group in groups)
               for metric in ("classification", "structure", "verdict", "exact")}
    return {"metric_version": CONSISTENCY_VERSION, "groups": groups, "group_count": len(groups), "summary": summary,
            "message": None if groups else "Select an experiment with at least two matched trials."}


def comparable_scores(groups, minimum, *, pairwise=True):
    if len(groups) < 2:
        return False, "Select at least two models with stored responses.", {}, []
    counts = [Counter(protocol(row) for row in members) for members in groups.values()]
    matches = all(count == counts[0] for count in counts)
    score_maps = {}
    for model, members in groups.items():
        grouped = bucketed([row for row in members if row.score is not None], protocol)
        score_maps[model] = {key: (independent_item(values[0]), [row.score for row in values])
                             for key, values in grouped.items()}
    versions = {model: {row.response.execution.get("reported_model") for row in members if row.response.execution.get("reported_model")}
                for model, members in groups.items()}
    paired = []
    for first, second in combinations(groups, 2) if pairwise else ():
        crossed = defaultdict(list)
        a, b = score_maps[first], score_maps[second]
        mixed = len(versions[first]) > 1 or len(versions[second]) > 1
        if not mixed:
            for key in sorted(a.keys() & b.keys(), key=stable):
                unit, left = a[key]
                _, right = b[key]
                if len(left) == len(right):
                    crossed[unit].extend([fmean(left) - fmean(right)] * len(left))
        record = describe([fmean(values) for values in crossed.values()])
        paired.append({"first": first, "second": second, "difference": record,
                       "message": "The pair contains multiple reported model versions." if mixed else
                       None if record["confidence_interval"] else INSUFFICIENT})
    if not matches:
        return False, "Rankings require identical test items, dataset and prompt versions, trial counts, model settings, and evaluation configuration.", score_maps, paired
    if any(len(values) > 1 for values in versions.values()):
        return False, "Rankings require one reported model version per selected model identifier.", score_maps, paired
    if any(row.score is None for members in groups.values() for row in members):
        return False, "Rankings require a complete weighted score for every matched trial under the selected rubric and method.", score_maps, paired
    if len(item_scores(next(iter(groups.values())))) < minimum:
        return False, f"Rankings require at least {minimum} distinct matched test items.", score_maps, paired
    return True, None, score_maps, paired


def comparison_view(rows, minimum):
    groups = bucketed(rows, lambda row: row.model.id)
    if len(groups) > 12:
        return {"models": [], "comparable": False, "warning": "Narrow the comparison to at most 12 models.",
                "paired": [], "minimum_items": minimum, "explorer": [], "findings": [], "metric_version": VERSION}
    qualified, warning, _, paired = comparable_scores(groups, minimum)
    models = []
    for identifier, members in groups.items():
        model = members[0].model
        by_task = bucketed(members, lambda row: row.dataset.dimension)
        metrics = scoring_metrics(members)
        per_task = {task: scoring_metrics(by_task.get(task, [])) for task in DIMENSIONS}
        repeat = consistency_view(members)
        models.append({"id": identifier, "model": model.identifier, "provider": model.provider, "metrics": metrics,
                       "tasks": per_task, "consistency": repeat["summary"]["structure"],
                       "rank": None})
    if qualified:
        models.sort(key=lambda row: (-(row["metrics"]["score"]["mean"] or 0), row["id"]))
        previous = None
        rank = 0
        for position, row in enumerate(models, 1):
            score = row["metrics"]["score"]["mean"]
            if score != previous:
                rank = position
                previous = score
            row["rank"] = rank
    explorer = []
    for members in bucketed(rows, lambda row: row.item.id).values():
        exemplar = members[0]
        if len({row.model.id for row in members}) >= 2:
            explorer.append({"item_id": exemplar.item.id, "key": exemplar.item.item_key, "dimension": exemplar.dataset.dimension,
                             "responses": [{"id": row.response.id, "model": row.model.identifier, "provider": row.model.provider,
                                            "trial": row.response.trial, "score": row.score, "verdict": row.verdict,
                                            "output_hash": response_hash(row.response.raw_output),
                                            "errors": row.errors or [], "reviews": (row.evaluation or {}).get("reviews", [])}
                                           for row in members]})
    findings = []
    if qualified:
        for task in DIMENSIONS:
            task_rows = [row for row in rows if row.dataset.dimension == task]
            valid, _, _, _ = comparable_scores(bucketed(task_rows, lambda row: row.model.id), minimum, pairwise=False)
            values = [(entry["model"], entry["tasks"][task]["score"]["mean"]) for entry in models]
            values = sorted(((name, value) for name, value in values if value is not None), key=lambda entry: -entry[1])
            if valid and len(values) >= 2 and values[0][1] > values[1][1]:
                findings.append({"task": task, "model": values[0][0], "score": values[0][1],
                                 "label": "Highest observed mean on this matched task"})
    return {"models": models, "comparable": qualified, "warning": warning, "paired": paired,
            "minimum_items": minimum, "explorer": explorer, "findings": findings, "metric_version": VERSION}


def analytics_view(db, rows, filters, rubric):
    response_ids = [row.response.id for row in rows]
    reviews = []
    for offset in range(0, len(response_ids), 300):
        reviews.extend(db.scalars(select(ReviewAssignment).where(ReviewAssignment.rubric_id == rubric["id"],
                                 ReviewAssignment.response_id.in_(response_ids[offset:offset + 300]))))
    grouped = defaultdict(dict)
    latest = {row.response.id: response_hash(row.response.raw_output) for row in rows
              if row.response.raw_output is not None and row.response.state in ("completed", "failed")}
    reviews = [row for row in reviews if latest.get(row.response_id) == row.response_hash]
    for row in reviews:
        if row.state == "submitted":
            grouped[row.response_id][row.reviewer_id] = row.verdict
    consistency = consistency_view(rows)
    compare = comparison_view(rows, filters.minimum_items)
    return {
        "metrics": scoring_metrics(rows), "experiments": len({row.run.id for row in rows}), "model_count": len({row.model.id for row in rows}),
        "review_count": len(reviews), "reviews_submitted": sum(row.state == "submitted" for row in reviews),
        "review_agreement": agree(list(grouped.values())), "repeat_summary": consistency["summary"],
        "repeat_group_count": consistency["group_count"], "comparison": compare,
        "trends": [{"date": day, "correctness": scoring_metrics(group)["correctness_rate"],
                    "mean": mean_or_none(row.score for row in group)} for day, group in sorted(
                        bucketed(rows, lambda row: row.response.created_at.date().isoformat()).items())],
        "consistency_trend": [{"date": day, "structure": mean_or_none(group["metrics"]["structure"]["percent"] for group in groups)}
                              for day, groups in sorted(bucketed(consistency["groups"], lambda group: group["trials"][0]["timestamp"].date().isoformat()).items())],
        "datasets": [{"name": group[0].dataset.name if group[0].dataset.kind == "user" else group[0].dataset.dimension,
                      "id": identifier, "version": group[0].dataset.version, "metrics": scoring_metrics(group)}
                     for identifier, group in bucketed(rows, lambda row: row.dataset.id).items()],
        "definitions": {"score": "Mean rubric score for each independent stimulus, then averaged across stimuli.",
                        "correctness": "Decisive verdicts only. Deterministic verdicts cover recorded reference fields and formal checks.",
                        "errors": "Share of evaluated responses with at least one retained annotation under the selected method and rubric.",
                        "confidence": "95% percentile bootstrap of independent stimulus means. At least 8 varying stimulus values are required.",
                        "missing": "Missing scores and uncertain or absent verdicts are excluded from their respective denominators.",
                        "assumptions": "Stimuli are treated as independent. Repeated trials for the same stimulus are collapsed before inference."},
        "metric_version": VERSION,
    }
