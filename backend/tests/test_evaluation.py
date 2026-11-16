import csv
import io
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import analysis_api, evaluation_service, providers, queue, scientific, semantic
from app.catalog import builtin
from app.config import get_settings
from app.database import Base, get_db, make_engine
from app.evaluation_schemas import DEFAULT_WEIGHTS
from app.main import app
from app.models import Evaluation, ModelResponse, ModelSnapshot, User
from app.reviews import agree, consensus_summary
from app.scientific import describe, repeat_metrics
from app.scoring import deterministic, metric_score
from app.semantic import normalized_embeddings
from test_research import ORIGIN, data, drain, queue_demo, register


@pytest.fixture
def lab(tmp_path, monkeypatch):
    bind = make_engine(f"sqlite:///{tmp_path / 'evaluation.sqlite3'}")
    Base.metadata.create_all(bind)
    monkeypatch.setattr(get_settings(), "worker_enabled", False)
    monkeypatch.setattr(get_settings(), "web_origin", ORIGIN["Origin"])

    def get_test_db():
        with Session(bind) as session:
            yield session

    app.dependency_overrides[get_db] = get_test_db
    try:
        with TestClient(app) as owner, TestClient(app) as first, TestClient(app) as second:
            owner_id = register(owner, "lead")
            first_id = register(first, "reviewer-a")
            second_id = register(second, "reviewer-b")
            with Session(bind) as session:
                session.get(User, owner_id).role = "admin"
                session.get(User, first_id).role = session.get(User, second_id).role = "reviewer"
                session.commit()
            yield owner, first, second, bind
    finally:
        app.dependency_overrides.pop(get_db, None)
        bind.dispose()


def drain_evaluations(bind):
    for _ in range(200):
        if not evaluation_service.work_assessment_once(bind):
            return
    raise AssertionError("Evaluation queue did not drain")


def rubric(client, **arguments):
    rubric = {"name": "Reference checks", "weights": DEFAULT_WEIGHTS | {
        "correctness": 70, "analysis_quality": 0, "explanation_quality": 0, "structural_validity": 20, "completeness": 10,
    }}
    return data(client.post("/api/v1/evaluations/rubrics", json=rubric | arguments), 201)


def evaluate(client, response_ids, rubric_id, **options):
    return data(client.post("/api/v1/evaluations/automated", json={
        "response_ids": response_ids, "rubric_id": rubric_id, "method": "deterministic",
    } | options), 202)


def test_scores_do_not_turn_missing_evidence_into_zero():
    assert metric_score(DEFAULT_WEIGHTS, {"correctness": 90, "structural_validity": 100}) is None
    assert metric_score({"correctness": 70, "structural_validity": 30}, {"correctness": 50, "structural_validity": 90}) == 62
    _, fixture, answers = builtin("ambiguity")
    item = fixture.items[0]
    result = deterministic({"dimension": "ambiguity", "reference": {}, "stimulus": item.stimulus.model_dump(),
                            "raw_output": json.dumps(answers[item.item_key])})
    assert result["verdict"] == "uncertain" and result["scores"]["correctness"] is None
    assert result["scores"]["structural_validity"] == 100
    assert result["scores"]["explanation_quality"] is None


@pytest.mark.parametrize("task,field,wrong", [("ambiguity", "attachments", ["Unrelated attachment"]),
                                              ("recursion", "expansion", "Unrelated expansion"),
                                              ("movement", "origin", "Unrelated source")])
def test_invalid_tree_does_not_discard_failed_reference_checks(task, field, wrong):
    _, fixture, answers = builtin(task)
    item = fixture.items[0]
    answer = json.loads(json.dumps(answers[item.item_key]))
    tree = answer["readings"][0]["tree"] if task == "ambiguity" else answer["tree"]
    tree["children"][0]["id"] = tree["id"]
    reference = item.reference.model_dump() | {field: wrong}
    result = deterministic({"dimension": task, "reference": reference, "stimulus": item.stimulus.model_dump(),
                            "raw_output": json.dumps(answer)})
    assert result["scores"]["structural_validity"] == 0
    assert result["verdict"] == "incorrect"
    assert next(check for check in result["checks"] if check["field"] == field)["matches"] is False


def test_duplicated_ambiguity_topology_cannot_receive_affirmative_verdict():
    _, fixture, answers = builtin("ambiguity")
    item = fixture.items[0]
    answer = json.loads(json.dumps(answers[item.item_key]))
    answer["readings"][1]["tree"] = answer["readings"][0]["tree"]
    result = deterministic({"dimension": "ambiguity", "reference": item.reference.model_dump(),
                            "stimulus": item.stimulus.model_dump(), "raw_output": json.dumps(answer)})
    assert result["verdict"] == "uncertain" and result["scores"]["structural_validity"] == 0
    assert {error["category"] for error in result["errors"]} == {"duplicate_interpretation"}


def test_phonology_checks_unique_unseen_forms_and_discloses_conflicting_references():
    _, fixture, answers = builtin("phonology")
    item = fixture.items[0]
    held_out = [{"word_id": word_id, "underlying": underlying, "surface": surface}
                for word_id, underlying, surface in [("seen", "a b", "a P"), ("good", "i b", "i p"),
                    ("duplicate", "i b", "i p"), ("conflict-a", "e b", "e p"), ("conflict-b", "e b", "e b"),
                    ("mismatch", "o b", "o P")]]
    result = deterministic({"dimension": "phonology", "reference": item.reference.model_dump() | {"held_out": held_out},
                            "stimulus": item.stimulus.model_dump(), "raw_output": json.dumps(answers[item.item_key])})
    outcomes = {row["field"]: row["matches"] for row in result["checks"] if row["field"].startswith("held_out:")}
    assert outcomes == {"held_out:good": True, "held_out:mismatch": False}
    assert result["verdict"] == "incorrect" and result["validation"]["held_out_conflicting_forms"] == 1


def test_rubric_versions_evaluation_retry_and_ownership(lab):
    owner, other, _, bind = lab
    assert owner.post("/api/v1/evaluations/rubrics", json={"name": "Invalid", "weights": {"correctness": 90}}).status_code == 422
    default = data(owner.get("/api/v1/evaluations/rubrics"))[0]
    response = queue_demo(owner, "ambiguity")["response_id"]
    drain(bind)
    first = evaluate(owner, [response], default["id"])[0]
    assert first["state"] == "pending"
    drain_evaluations(bind)
    result = data(owner.get(f"/api/v1/evaluations/{first['id']}"))
    assert result["state"] == "needs_human_review" and result["score"] is None
    assert result["result"]["verdict"] == "correct"
    first_version, second_version = rubric(owner), rubric(owner)
    assert first_version["version"] == 1 and second_version["version"] == 2
    job = evaluate(owner, [response], first_version["id"])[0]
    drain_evaluations(bind)
    assert data(owner.get(f"/api/v1/evaluations/{job['id']}"))["score"] == 100
    data(owner.post(f"/api/v1/evaluations/{job['id']}/retry"), 202)
    drain_evaluations(bind)
    value = data(owner.get(f"/api/v1/evaluations/{job['id']}"))
    assert [trial["number"] for trial in value["attempts"]] == [2, 1]
    assert value["rubric"]["version"] == 1
    assert other.get(f"/api/v1/evaluations/{job['id']}").status_code == 404
    assert data(other.get("/api/v1/evaluations"))["total"] == 0


def test_malformed_judge_output_and_provider_failure_are_distinct(lab, monkeypatch):
    owner, _, _, bind = lab
    monkeypatch.setattr(get_settings(), "openai_api_key", SecretStr("mock-judge"))
    ref = rubric(owner)
    response = queue_demo(owner, "movement")["response_id"]
    drain(bind)
    job = evaluate(owner, [response], ref["id"], method="judge", judge={"provider": "openai", "model": "judge-test"})[0]
    monkeypatch.setattr(evaluation_service, "call_model", lambda *args:
                        providers.TimedGeneration(providers.Generation("not JSON"), 2, 1))
    drain_evaluations(bind)
    failed = data(owner.get(f"/api/v1/evaluations/{job['id']}"))
    assert failed["attempts"][0]["raw_output"] == "not JSON"
    assert failed["result"]["error_code"] == "invalid_evaluation_output"

    def outage(*args):
        raise providers.ProviderError("Provider timed out.", code="provider_timeout")

    monkeypatch.setattr(evaluation_service, "call_model", outage)
    data(owner.post(f"/api/v1/evaluations/{job['id']}/retry"), 202)
    drain_evaluations(bind)
    failed = data(owner.get(f"/api/v1/evaluations/{job['id']}"))
    assert failed["state"] == "failed" and failed["result"]["error_code"] == "provider_timeout"
    assert failed["attempts"][1]["raw_output"] == "not JSON"
    payload = {"criteria": {key: {"score": 75, "evidence": "Observed evidence"} for key in DEFAULT_WEIGHTS},
               "verdict": "correct", "errors": [], "assessment": "Structured assessment",
               "justification": "Brief rationale", "confidence": "medium"}
    monkeypatch.setattr(evaluation_service, "call_model", lambda *args:
                        providers.TimedGeneration(providers.Generation(json.dumps(payload), 210, 70), 22, 1))
    data(owner.post(f"/api/v1/evaluations/{job['id']}/retry"), 202)
    drain_evaluations(bind)
    settled = data(owner.get(f"/api/v1/evaluations/{job['id']}"))
    assert settled["score"] == 75 and settled["judge"]["prompt_version"] == "lingualens-judge-v1"
    assert "Evaluation data" in settled["attempts"][0]["judge_prompt"]
    assert settled["result"]["transport"]["input_tokens"] == 210


def test_blind_review_permissions_conflict_and_adjudication(lab):
    owner, first, second, bind = lab
    response_id = queue_demo(owner, "recursion")["response_id"]
    drain(bind)
    ref = rubric(owner)
    automated = evaluate(owner, [response_id], ref["id"])[0]
    drain_evaluations(bind)
    facts = {"response_id": response_id, "rubric_id": ref["id"], "reviewer": "reviewer-a@example.com", "blind": True}
    a = data(owner.post("/api/v1/review-assignments", json=facts), 201)
    b = data(owner.post("/api/v1/review-assignments", json=facts | {"reviewer": "reviewer-b@example.com"}), 201)
    assert second.get(f"/api/v1/human-reviews/{a['id']}").status_code == 404
    assert first.get(f"/api/v1/review-consensus?response_id={response_id}&rubric_id={ref['id']}").status_code == 404
    view = data(first.get(f"/api/v1/human-reviews/{a['id']}"))
    assert "model" not in view and view["can_edit"]
    assert owner.put(f"/api/v1/human-reviews/{a['id']}", json={"revision": 0}).status_code == 403
    draft = data(first.put(f"/api/v1/human-reviews/{a['id']}", json={"revision": 0, "comment": "Draft"}))
    assert draft["state"] == "draft" and draft["revision"] == 1
    assert first.put(f"/api/v1/human-reviews/{a['id']}", json={"revision": 0}).status_code == 409
    evidence = {"category": "invalid_expansion", "severity": "major", "evidence": "Reviewer questioned the extra layer."}
    for client, record, revision, verdict, score in ((first, a, 1, "correct", 96), (second, b, 0, "incorrect", 48)):
        result = data(client.put(f"/api/v1/human-reviews/{record['id']}", json={
            "revision": revision, "submit": True, "scores": {key: score for key in DEFAULT_WEIGHTS},
            "verdict": verdict, "comment": "Examined the traceable evidence.", "errors": [evidence] if verdict == "incorrect" else [],
        }))
        assert result["score"] == score and result["model"]["provider"] == "demo"
    conflict = data(owner.get(f"/api/v1/review-consensus?response_id={response_id}&rubric_id={ref['id']}"))
    assert conflict["status"] == "disputed" and conflict["mean_score"] == 72
    assert conflict["final_verdict"] is None and conflict["pair_agreement"] == 0
    assert data(owner.get("/api/v1/review-consensus/disputes"))[0]["response_id"] == response_id
    assert second.post("/api/v1/review-consensus/adjudicate", json=facts | {
        "verdict": "correct", "justification": "Uses the intended rubric.",
    }).status_code == 422  # Assignment-only fields are rejected.
    decision = {"response_id": response_id, "rubric_id": ref["id"], "verdict": "correct", "justification": "Reconciled the expansions."}
    assert second.post("/api/v1/review-consensus/adjudicate", json=decision).status_code == 403
    resolved = data(owner.post("/api/v1/review-consensus/adjudicate", json=decision))
    assert resolved["status"] == "adjudicated" and resolved["final_verdict"] == "correct"
    error = data(owner.get("/api/v1/errors"))["items"][0]
    assert error["source"] == "human"
    assert data(owner.get(f"/api/v1/evaluations/{automated['id']}"))["state"] == "reviewed"
    with Session(bind) as db:
        assert db.query(Evaluation).filter_by(method="human").count() == 10
        db.get(ModelResponse, response_id).raw_output = "Replacement trial payload"
        db.commit()
    isolated = data(owner.get(f"/api/v1/review-consensus?response_id={response_id}&rubric_id={ref['id']}"))
    assert isolated["submitted"] == 0 and isolated["decision"] is None
    archive = data(owner.get(f"/api/v1/review-consensus?response_id={response_id}&rubric_id={ref['id']}&assignment_id={a['id']}"))
    assert archive["status"] == "adjudicated" and archive["final_verdict"] == "correct"
    error_url = f"/api/v1/errors/{error['id']}"
    assert data(owner.get(error_url))["input"]["raw_output"] != "Replacement trial payload"
    assert first.get(error_url).status_code == 404
    replacement = data(owner.post("/api/v1/review-assignments", json=facts), 201)
    assert replacement["id"] != a["id"]
    assert owner.post("/api/v1/review-assignments", json=facts).status_code == 409


def test_agreement_checks_common_raters_and_degeneracy():
    assert agree([{1: "correct", 2: "correct"}])["coefficient"] is None
    series = [{1: "correct", 2: "correct"}, {1: "incorrect", 2: "incorrect"}]
    assert agree(series)["coefficient"] == 1
    assert agree([series[0], series[0]])["coefficient"] is None
    mixed = [{1: "correct", 2: "incorrect"}, {3: "incorrect", 4: "correct"}]
    assert agree(mixed)["coefficient"] is None
    triples = [{1: "correct", 2: "correct", 3: "correct"}, {2: "incorrect", 3: "incorrect", 4: "incorrect"}]
    assert agree(triples)["coefficient"] == 1
    assert agree(triples)["method"] == "Fleiss' kappa"
    rows = [SimpleNamespace(state="submitted", verdict="correct", score=95, id=i, reviewer_id=i, draft={}) for i in range(2)]
    assert consensus_summary(rows)["majority"] == "correct"
    decision = SimpleNamespace(id=1, source_reviews=[0, 1], verdict="correct", justification="Reviewed", adjudicator_id=4, created_at=None)
    assert consensus_summary(rows, decision)["status"] == "adjudicated"
    extra = SimpleNamespace(state="submitted", verdict="incorrect", score=45, id=2, reviewer_id=2, draft={})
    assert consensus_summary([*rows, extra], decision)["status"] == "disputed"


def test_agreement_population_and_adjudicated_verdict_are_separate(lab, monkeypatch):
    owner, first, second, bind = lab
    rule = rubric(owner)["id"]
    demo = queue_demo(owner, "ambiguity")["response_id"]
    item_key = "ambiguity-01"
    sample = json.dumps(builtin("ambiguity")[2][item_key])
    monkeypatch.setattr(queue, "call_model", lambda *args: providers.TimedGeneration(providers.Generation(sample), 10, 1))
    live = data(owner.post("/api/v1/linguistic/ambiguity", json={"dataset_id": "builtin:ambiguity", "item_key": item_key,
                "selection": {"provider": "ollama", "model": "mock-release-model"}}), 202)["response_id"]
    drain(bind)
    for response_id, second_verdict in ((demo, "correct"), (live, "incorrect")):
        for reviewer, client, verdict, score in (("reviewer-a", first, "correct", 96), ("reviewer-b", second, second_verdict, 40)):
            assigned = data(owner.post("/api/v1/review-assignments", json={"response_id": response_id, "rubric_id": rule,
                        "reviewer": reviewer + "@example.com", "blind": True}), 201)
            data(client.put(f"/api/v1/human-reviews/{assigned['id']}", json={"revision": 0, "submit": True,
                "verdict": verdict, "scores": dict.fromkeys(DEFAULT_WEIGHTS, score), "comment": "Reviewed the saved stimulus."}))

    endpoint = f"/api/v1/review-consensus/agreement?rubric_id={rule}"
    demo_agreement = data(owner.get(endpoint + "&population=demo"))
    live_agreement = data(owner.get(endpoint))
    assert (demo_agreement["population"], demo_agreement["pairs"], demo_agreement["percent_agreement"]) == ("demo", 1, 100)
    assert (live_agreement["population"], live_agreement["pairs"], live_agreement["percent_agreement"]) == ("live", 1, 0)

    filters = {"population": "demo", "method": "human", "rubric_id": rule}
    prior = data(owner.post("/api/v1/statistics", json=filters))["metrics"]
    assert prior["decisive"] == 0 and prior["score"]["mean"] == 68
    decision = data(owner.post("/api/v1/review-consensus/adjudicate", json={"response_id": demo, "rubric_id": rule,
                    "verdict": "incorrect", "justification": "Resolved the divergent structural scores."}))
    assert decision["majority"] == "correct" and decision["final_verdict"] == "incorrect"
    assert data(owner.post("/api/v1/statistics", json=filters))["metrics"] == prior
    adjudicated = data(owner.post("/api/v1/statistics", json=filters | {"method": "consensus"}))["metrics"]
    assert adjudicated["decisive"] == 1 and adjudicated["correctness_rate"] == 0 and adjudicated["score"]["mean"] is None
    with Session(bind) as db:
        db.get(ModelResponse, demo).raw_output = "Replaced trial output"
        db.commit()
    assert data(owner.get(endpoint + "&population=demo"))["pairs"] == 0
    assert data(owner.get(endpoint))["pairs"] == 1


def test_embedding_normalization_rejects_invalid_vectors():
    assert normalized_embeddings([[3, 4], [1, 0]], 2) == [[.6, .8], [1, 0]]
    for vectors in ([[0, 0]], [[float("nan")]], [[1], [1, 2]]):
        with pytest.raises(ValueError):
            normalized_embeddings(vectors, len(vectors))


def test_embedding_http_contract_and_validation(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "semantic_model", "audit-embedding")
    client = semantic.Client

    def respond(request):
        assert request.url.path == "/api/embed"
        assert json.loads(request.content) == {"model": "audit-embedding", "input": ["alpha", "beta"], "truncate": False}
        return httpx.Response(200, json={"model": "audit-embedding", "embeddings": [[3, 4], [1, 0]]})

    monkeypatch.setattr(semantic, "Client", lambda **options: client(transport=httpx.MockTransport(respond), **options))
    result = semantic.embedded_matrix(["alpha", None, "beta"])
    assert result["n"] == 2 and result["matrix"] == [[1.0, None, 0.6], [None, None, None], [0.6, None, 1.0]]
    assert result["dimensions"] == 2 and result["reported_model"] == "audit-embedding"


def test_comparison_consistency_statistics_and_report_exports(lab):
    owner, guest, _, bind = lab
    ref = rubric(owner)
    run = data(owner.post("/api/v1/experiments", json={
        "name": "Phase 3 labelled demonstration", "dataset_ids": ["builtin:ambiguity"],
        "selections": [{"provider": "demo"}, {"provider": "demo", "model": "lingualens-baseline"}], "repetitions": 2,
    }), 202)
    drain(bind)
    run_id = run["experiment_id"]
    items = []
    for page in (1, 2):
        detail = data(owner.get(f"/api/v1/experiment-runs/{run_id}?page={page}"))
        items.extend(row["id"] for row in detail["responses"]["items"])
    filters = {"population": "demo", "method": "deterministic", "rubric_id": ref["id"], "experiment_ids": [run_id]}
    missing = data(owner.post("/api/v1/model-comparisons", json=filters))
    assert not missing["comparable"] and "complete weighted score" in missing["warning"]
    assert missing["models"][0]["metrics"]["annotated_error_rate"] is None
    evaluate(owner, items, ref["id"])
    drain_evaluations(bind)
    comparison = data(owner.post("/api/v1/model-comparisons", json=filters | {"save": True}))
    assert comparison["comparable"] and len(comparison["paired"]) == 1
    assert [row["rank"] for row in comparison["models"]] == [1, 2]
    assert comparison["models"][0]["metrics"]["score"]["n"] == 10
    assert comparison["models"][0]["model"] == "lingualens-reference"
    assert comparison["models"][1]["metrics"]["criteria"]["correctness"] == 0
    automated_error = data(owner.get("/api/v1/errors"))["items"][0]
    saved_error = data(owner.get(f"/api/v1/errors/{automated_error['id']}"))
    assert saved_error["input"]["raw_output"] and automated_error["source"] == "deterministic"
    first_record = comparison["explorer"][0]["responses"][0]
    response_url = f"/api/v1/responses/{first_record['id']}?expected_output={first_record['output_hash']}"
    assert owner.get(response_url).status_code == 200
    assert not data(owner.post("/api/v1/leaderboard", json=filters | {"minimum_items": 11}))["comparable"]
    assert not data(owner.post("/api/v1/leaderboard", json=filters | {"model_ids": [9999]}))["comparable"]
    assert data(owner.post("/api/v1/analytics", json=filters | {"population": "live"}))["metrics"]["responses"] == 0
    assert data(owner.get("/api/v1/analytics/dashboard"))["evaluated"] == 0
    snapshot_id = comparison["snapshot_id"]
    assert guest.get(f"/api/v1/model-comparisons/{snapshot_id}").status_code == 404
    assert owner.get(f"/api/v1/consistency/{snapshot_id}").status_code == 404
    consistency = data(owner.post("/api/v1/consistency", json=filters | {"save": True}))
    assert consistency["group_count"] == 20
    assert consistency["summary"]["structure"] == 100
    assert consistency["groups"][0]["metrics"]["score"]["sample_sd"] == 0
    assert consistency["groups"][0]["metrics"]["matrix"] == [[1, 1], [1, 1]]
    stats = data(owner.post("/api/v1/statistics", json=filters))
    assert stats["metrics"]["evaluated"] == 40 and stats["metrics"]["score"]["n"] == 10
    assert describe(list(range(10)))["confidence_interval"] is not None
    assert describe(list(range(10))) == describe(reversed(range(10)))
    assert describe([0, 2, 4], interval=False)["sample_variance"] == 4
    assert describe([7])["sample_variance"] is None
    other_run = data(owner.post("/api/v1/experiments", json={
        "name": "Uneven cohort", "dataset_ids": ["builtin:recursion"], "selections": [{"provider": "demo"}], "repetitions": 1,
    }), 202)
    drain(bind)
    varied = data(owner.post("/api/v1/model-comparisons", json=filters | {"experiment_ids": [run_id, other_run["experiment_id"]]}))
    assert not varied["comparable"] and "identical" in varied["warning"]
    report = data(owner.post("/api/v1/reports", json={"title": "Matched evaluation", "type": "comparison", "filters": filters}), 201)
    assert report["analytics"]["metrics"]["responses"] == 40
    assert report["experiments"][0]["name"] == "Phase 3 labelled demonstration"
    for extension, magic in (("pdf", b"%PDF"), ("csv", b"report_id,population"), ("json", b"{")):
        url = f"/api/v1/reports/export/{report['id']}?format={extension}"
        download = owner.get(url)
        assert download.status_code == 200 and download.content.startswith(magic)
        assert download.headers["cache-control"] == "no-store"
        assert guest.get(url).status_code == 404
        if extension == "csv":
            rows = list(csv.DictReader(io.StringIO(download.text)))
            assert len(rows) == 40 and {int(row["response_id"]) for row in rows} == set(items)
            assert {row["population"] for row in rows} == {"demo"}
        if extension == "json":
            assert download.json() == report
    assert owner.post("/api/v1/reports", json={
        "title": "Empty live cohort", "type": "evaluation", "filters": filters | {"population": "live"},
    }).status_code == 422
    no_scores = data(owner.post("/api/v1/reports", json={
        "title": "Unevaluated records", "type": "evaluation", "filters": filters | {"experiment_ids": [other_run["experiment_id"]]},
    }), 201)
    assert no_scores["analytics"]["metrics"]["score"]["mean"] is None

    with Session(bind) as db:
        same_model = list(db.scalars(select(ModelResponse).where(ModelResponse.id.in_(items),
                                                                ModelResponse.model_id == comparison["models"][0]["id"])))
        for index, response in enumerate(same_model):
            response.execution = response.execution | {"reported_model": f"audit-version-{index % 2}"}
        db.commit()
    mixed = data(owner.post("/api/v1/model-comparisons", json=filters))
    assert not mixed["comparable"] and all(row["rank"] is None for row in mixed["models"])
    assert mixed["paired"][0]["difference"]["n"] == 0 and "versions" in mixed["paired"][0]["message"]
    assert data(owner.post("/api/v1/consistency", json=filters))["group_count"] == 10
    with Session(bind) as db:
        db.get(ModelResponse, first_record["id"]).raw_output = "Replaced compared output"
        db.commit()
    assert owner.get(response_url).status_code == 409
    assert owner.get(f"/api/v1/reports/export/{report['id']}?format=json").json() == report


def test_dashboard_retains_counts_when_interactive_limit_is_reached(lab, monkeypatch):
    owner, _, _, bind = lab
    for _ in range(2):
        queue_demo(owner, "ambiguity")
    drain(bind)
    with Session(bind) as db:
        # Exercise the recorded-data routing with locally generated trials.
        db.scalar(select(ModelSnapshot).where(ModelSnapshot.provider == "demo")).provider = "ollama"
        db.commit()
    monkeypatch.setattr(analysis_api, "MAX_OBSERVATIONS", 1)
    monkeypatch.setattr(scientific, "MAX_OBSERVATIONS", 1)
    dashboard = data(owner.get("/api/v1/analytics/dashboard"))
    assert dashboard["experiments"] == 2 and dashboard["model_count"] == 1
    assert dashboard["score"] is None and dashboard["warning"]
    assert owner.post("/api/v1/analytics", json={"temperature": 1.25}).status_code == 200
