import json
from datetime import timedelta

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app import providers, queue
from app.catalog import builtin
from app.config import get_settings
from app.database import Base, get_db, make_engine
from app.lab_schemas import DIMENSIONS, Parameters
from app.linguistics import validate_answer
from app.main import app
from app.models import ModelProvider, ModelResponse


ORIGIN = {"Origin": "http://localhost:3000"}


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    bind = make_engine(f"sqlite:///{tmp_path / 'research.sqlite3'}")
    Base.metadata.create_all(bind)
    settings = get_settings()
    monkeypatch.setattr(settings, "worker_enabled", False)
    monkeypatch.setattr(settings, "openai_api_key", None)
    monkeypatch.setattr(settings, "credential_key", None)
    monkeypatch.setattr(settings, "web_origin", ORIGIN["Origin"])

    def session():
        with Session(bind) as db:
            yield db

    app.dependency_overrides[get_db] = session
    try:
        with TestClient(app) as client:
            register(client, "first")
            yield client, bind
    finally:
        app.dependency_overrides.pop(get_db, None)
        bind.dispose()


def register(client, alias):
    body = {"email": f"{alias}@example.com", "name": alias, "password": "research-password-123"}
    response = client.post("/api/v1/auth/register", headers=ORIGIN, json=body)
    assert response.status_code == 201, response.text
    client.headers.update(ORIGIN)
    return response.json()["data"]["id"]


def data(response, expected=200):
    assert response.status_code == expected, response.text
    return response.json()["data"]


def drain(bind):
    for _ in range(200):
        if not queue.work_once(bind):
            return
    raise AssertionError("Queue did not drain")


def queue_demo(client, dimension):
    return data(client.post(f"/api/v1/linguistic/{dimension}", json={
        "dataset_id": f"builtin:{dimension}", "item_key": f"{dimension}-01",
    }), 202)


@pytest.mark.parametrize("dimension", DIMENSIONS)
def test_all_teaching_annotations_pass_validation(dimension):
    _, fixtures, answers = builtin(dimension)
    assert len(fixtures.items) == 10
    for item in fixtures.items:
        result, report = validate_answer(dimension, json.dumps(answers[item.item_key]), item.stimulus, item.reference)
        assert result is not None, report
        assert report["schema"] == report["structure"] == "valid"
        assert report["linguistic_correctness"] == "unreviewed"
        assert all(field["matches"] for field in report["reference_checks"])
        if dimension == "phonology":
            assert report["rule_evidence"]["status"] == "verified_on_examples"


@pytest.mark.parametrize("dimension", DIMENSIONS)
def test_each_analyzer_persists_and_exposes_results(workspace, dimension):
    client, bind = workspace
    run = queue_demo(client, dimension)
    identifier = run["response_id"]
    assert data(client.get(f"/api/v1/responses/{identifier}"))["state"] == "pending"
    drain(bind)
    report = data(client.get(f"/api/v1/responses/{identifier}"))
    assert report["state"] == "completed"
    assert report["execution"]["provenance"] == "demo_reference"
    assert report["execution"]["prompt_version"] == report["execution"]["dataset_version"] == 1
    assert report["prompt_rendered"] and report["raw_output"] and report["parsed_output"]
    assert "Output schema:" in report["prompt_rendered"]
    assert data(client.get(f"/api/v1/history?dimension={dimension}"))["total"] == 1
    if dimension == "phonology":
        prediction = data(client.post(f"/api/v1/responses/{identifier}/test-rule", json={"word": "f ə b"}))
        assert prediction["surface"] == "f ə p"
        assert prediction["rule_evidence"] == "verified_on_examples"
    rerun = data(client.post(f"/api/v1/responses/{identifier}/rerun"), 202)
    drain(bind)
    new = data(client.get(f"/api/v1/responses/{rerun['response_id']}"))
    assert new["execution"]["rerun_of"] == identifier
    assert new["prompt_rendered"] == report["prompt_rendered"]
    assert client.delete(f"/api/v1/responses/{identifier}").status_code == 200
    assert client.get(f"/api/v1/responses/{identifier}").status_code == 404


def test_missing_credentials_and_invalid_input(workspace):
    client, bind = workspace
    config = data(client.get("/api/v1/providers"))
    assert not next(provider for provider in config if provider["provider"] == "openai")["configured"]
    failure = client.post("/api/v1/linguistic/ambiguity", json={
        "stimulus": {"sentence": "The guard watched from the gate."},
        "selection": {"provider": "openai", "model": "gpt-4.1-mini"},
    })
    assert failure.status_code == 422
    assert failure.json()["error"]["message"] == providers.MISSING
    assert client.post("/api/v1/linguistic/ambiguity", json={
        "stimulus": {"rows": [{"word_id": "w1", "surface": "a b"}]},
    }).status_code == 422
    assert client.post("/api/v1/linguistic/recursion", json={
        "dataset_id": "builtin:ambiguity", "item_key": "ambiguity-01",
    }).status_code == 422
    custom = data(client.post("/api/v1/linguistic/ambiguity", json={"stimulus": {"sentence": "An unseen test sentence."}}), 202)
    drain(bind)
    result = data(client.get(f"/api/v1/responses/{custom['response_id']}"))
    assert result["state"] == "failed" and "curated examples" in result["error"]


def test_provider_configuration_is_encrypted_and_scoped(workspace, monkeypatch):
    client, bind = workspace
    from pydantic import SecretStr
    monkeypatch.setattr(get_settings(), "credential_key", SecretStr(Fernet.generate_key().decode()))
    secret = "test-key-with-private-content"
    req = client.put("/api/v1/providers/openai", json={
        "enabled": True, "credential": secret, "default_model": "gpt-4.1-mini",
    })
    assert secret not in req.text
    assert data(req)["credential_source"] == "account"
    with Session(bind) as db:
        record = db.get(ModelProvider, (1, "openai"))
        assert secret not in record.credential_ciphertext
        assert providers.credential("openai", record) == secret
    monkeypatch.setattr("app.catalog_api.discover", lambda provider, key: ["gpt-4.1-mini"] if key == secret else [])
    assert data(client.post("/api/v1/providers/openai/test")) == ["gpt-4.1-mini"]
    assert data(client.get("/api/v1/models"))[1]["model"] == "gpt-4.1-mini"
    assert data(client.put("/api/v1/providers/openai", json={"enabled": False, "clear_credential": True}))["credential_source"] == "none"
    assert client.post("/api/v1/providers/openai/test").status_code == 409


def test_real_sdk_contract_normalizes_model_usage(monkeypatch):
    sdk = providers.openai.OpenAI
    seen = []

    def transport(request):
        seen.append(request)
        return httpx.Response(200, json={"id": "response-stub", "status": "completed", "model": "test-text",
                              "output": [{"type": "message", "role": "assistant", "id": "m1", "status": "completed",
                                          "content": [{"type": "output_text", "text": "{}", "annotations": []}]}],
                              "usage": {"input_tokens": 11, "output_tokens": 6, "total_tokens": 17}})

    def module_keyword(**options):
        return sdk(**options, http_client=httpx.Client(transport=httpx.MockTransport(transport)))

    monkeypatch.setattr(providers.openai, "OpenAI", module_keyword)
    response = providers.call_model("openai", "test-key", "test-text", "Analyze the expression.",
                                    Parameters(timeout=3, max_output_tokens=250))
    assert response.generation.text == "{}"
    assert response.generation.input_tokens == 11
    assert response.generation.output_tokens == 6
    assert response.attempts == 1
    assert seen[0].url.path == "/v1/responses"
    assert json.loads(seen[0].content)["max_output_tokens"] == 250


@pytest.mark.parametrize("status", [429, 503, 401, None])
def test_provider_retries_are_bounded_and_sanitized(monkeypatch, status):
    executions = 0
    closed = 0
    request = httpx.Request("POST", "https://provider.example.com/")

    class Adapter:
        def generate(self, *_):
            nonlocal executions
            executions += 1
            if status is None:
                raise httpx.ReadTimeout("provider exposed secret")
            error = RuntimeError("provider exposed secret")
            error.status_code = status
            error.response = httpx.Response(status, request=request, headers={"retry-after": "0.01"})
            raise error

        def close(self):
            nonlocal closed
            closed += 1

    monkeypatch.setattr(providers, "adapter_for", lambda *args: Adapter())
    monkeypatch.setattr(providers, "sleep", lambda _: None)
    with pytest.raises(providers.ProviderError) as failure:
        providers.call_model("openai", "test-key", "model", "prompt", Parameters(timeout=3))
    assert failure.value.code in {"provider_rate_limit", "provider_unavailable", "provider_access", "provider_timeout"}
    assert "secret" not in str(failure.value)
    assert executions == closed == (1 if status == 401 else 3)


def test_dataset_version_import_export_and_permissions(workspace):
    client, _ = workspace
    original = data(client.get("/api/v1/datasets/builtin:ambiguity"))
    single = {"name": "My study", "dimension": "ambiguity", "items": original["items"][:2]}
    duplicate = single | {"items": [single["items"][0], single["items"][0]]}
    assert client.post("/api/v1/datasets", json=duplicate).status_code == 422
    created = data(client.post("/api/v1/datasets", json=single), 201)
    assert client.post("/api/v1/datasets", json=single).status_code == 409
    edit = data(client.put(f"/api/v1/datasets/{created['id']}", json=single | {"items": single["items"][:1]}))
    assert edit["version"] == 2 and edit["id"] != created["id"]
    assert client.get(f"/api/v1/datasets/{created['id']}").status_code == 404
    for extension in ("csv", "json"):
        exported = client.get(f"/api/v1/datasets/{edit['id']}/export?format={extension}")
        assert exported.status_code == 200
        imported = data(client.post("/api/v1/datasets/import", data={"name": f"Reimport {extension}", "dimension": "ambiguity"},
                                    files={"file": (f"data.{extension}", exported.content)}), 201)
        assert imported["items"] == edit["items"]
    phone_csv = client.get("/api/v1/datasets/builtin:phonology/export?format=csv")
    preview = data(client.post("/api/v1/dataset-items/preview-import", data={"dimension": "phonology"},
                               files={"file": ("phones.csv", phone_csv.content)}))
    assert len(preview) == 10 and preview[0]["stimulus"]["rows"][0]["surface"]
    duplicate = data(client.post(f"/api/v1/datasets/{edit['id']}/duplicate?name=New+copy"), 201)
    assert duplicate["items"] == edit["items"]
    assert data(client.get("/api/v1/datasets?search=My+study"))[0]["id"] == edit["id"]
    with TestClient(app) as other:
        register(other, "second")
        assert other.get(f"/api/v1/datasets/{edit['id']}").status_code == 404
        assert other.delete(f"/api/v1/datasets/{edit['id']}").status_code == 404
    assert client.delete(f"/api/v1/datasets/{edit['id']}").status_code == 200


def test_prompt_versions_and_partial_batch_failure_preserve_raw(workspace, monkeypatch):
    client, bind = workspace
    from pydantic import SecretStr
    monkeypatch.setattr(get_settings(), "openai_api_key", SecretStr("mock"))
    standard = data(client.get("/api/v1/prompts?dimension=ambiguity"))[0]
    invalid = {"name": "Research protocol", "dimension": "ambiguity", "template": "$unsupported"}
    assert client.post("/api/v1/prompts", json=invalid).status_code == 422
    first = data(client.post("/api/v1/prompts", json=invalid | {"template": "First version $sentence"}), 201)
    second = data(client.post("/api/v1/prompts", json=invalid | {"template": "Second version $sentence"}), 201)
    assert standard["version"] == first["version"] == 1
    assert second["version"] == 2
    view = data(client.get("/api/v1/datasets/builtin:ambiguity"))
    item = view["items"][0]
    preview = data(client.post(f"/api/v1/prompts/{first['id']}/preview", json={"stimulus": item["stimulus"]}))
    assert "First version" in preview["text"] and preview["schema"]["title"] == "Ambiguity"
    small = data(client.post("/api/v1/datasets", json={"name": "Two models", "dimension": "ambiguity", "items": [item]}), 201)
    run = data(client.post("/api/v1/experiments", json={
        "name": "Repeated comparison", "dataset_ids": [small["id"]],
        "selections": [{"provider": "demo"}, {"provider": "openai", "model": "gpt-4.1-mini", "parameters": {"timeout": 12}}],
        "repetitions": 2, "prompt_ids": {"ambiguity": first["id"]},
    }), 202)["experiment_id"]
    monkeypatch.setattr(queue, "call_model",
                        lambda *args: providers.TimedGeneration(providers.Generation("raw not JSON", 13, 3), 47, 1))
    drain(bind)
    ensemble = data(client.get(f"/api/v1/experiment-runs/{run}"))
    assert ensemble["state"] == "failed"
    assert ensemble["counts"] == {"completed": 2, "failed": 2}
    assert ensemble["protocol"]["datasets"][0]["prompt_version"] == 1
    assert len(ensemble["models"]) == 2
    failed = next(entry for entry in ensemble["responses"]["items"] if entry["state"] == "failed")
    result = data(client.get(f"/api/v1/responses/{failed['id']}"))
    assert result["raw_output"] == "raw not JSON" and result["parsed_output"] is None
    assert result["execution"]["input_tokens"] == 13 and result["execution"]["validation"]["schema"] == "invalid"
    assert "First version" in result["prompt_rendered"]
    with TestClient(app) as other:
        register(other, "unrelated")
        assert other.get(f"/api/v1/responses/{failed['id']}").status_code == 404
        assert other.get(f"/api/v1/experiment-runs/{run}").status_code == 404
        assert data(other.get("/api/v1/history"))["total"] == 0
    payload = json.dumps(builtin("ambiguity")[2][item["item_key"]])
    monkeypatch.setattr(queue, "call_model", lambda *args: providers.TimedGeneration(providers.Generation(payload), 6, 1))
    assert data(client.post(f"/api/v1/experiment-runs/{run}/retry"))["counts"] == {"completed": 2, "pending": 2}
    drain(bind)
    assert data(client.get(f"/api/v1/experiment-runs/{run}"))["counts"] == {"completed": 4}
    retried = data(client.get(f"/api/v1/responses/{failed['id']}"))
    assert retried["execution"]["previous_attempts"][0]["raw_output"] == "raw not JSON"


def test_batch_cancellation_keeps_completed_rows_and_reclaims_lease(workspace):
    client, bind = workspace
    batch = data(client.post("/api/v1/experiments", json={
        "name": "Interrupted run", "dataset_ids": ["builtin:movement", "builtin:phonology"],
        "selections": [{"provider": "demo"}], "repetitions": 1,
    }), 202)["experiment_id"]
    abandoned = queue.claim_response(bind)
    assert abandoned is not None and queue.claim_response(bind)[0] != abandoned[0]
    with Session(bind) as session:
        session.execute(update(ModelResponse).where(ModelResponse.id == abandoned[0])
                        .values(lease_until=queue.now() - timedelta(seconds=1)))
        session.commit()
    assert queue.work_once(bind)
    assert data(client.post(f"/api/v1/experiment-runs/{batch}/cancel"))["counts"] == {
        "cancelled": 18, "completed": 1, "running": 1,
    }
    with Session(bind) as session:
        session.execute(update(ModelResponse).where(ModelResponse.state == "running")
                        .values(lease_until=queue.now() - timedelta(seconds=1)))
        session.commit()
    drain(bind)
    final = data(client.get(f"/api/v1/experiment-runs/{batch}"))
    assert final["state"] == "cancelled"
    assert final["counts"] == {"cancelled": 19, "completed": 1}


def test_structural_and_request_limits(workspace, monkeypatch):
    client, _ = workspace
    _, dataset, outputs = builtin("ambiguity")
    item = dataset.items[0]
    answer = json.loads(json.dumps(outputs[item.item_key]))
    tree = answer["readings"][0]["tree"]
    tree["children"][0]["id"] = tree["id"]
    parsed, report = validate_answer("ambiguity", json.dumps(answer), item.stimulus, item.reference)
    assert parsed is None and report["schema"] == "valid" and report["structure"] == "invalid"
    answer["detected"] = "true"
    parsed, report = validate_answer("ambiguity", json.dumps(answer), item.stimulus, item.reference)
    assert parsed is None and report["schema"] == "invalid"
    assert client.post("/api/v1/datasets/import", content=b"n" * (1_048_576 + 1)).status_code == 413
    window_start = 1_800_000_000
    monkeypatch.setattr(queue, "time", lambda: window_start)
    for _ in range(12):
        queue_demo(client, "ambiguity")
    assert client.post("/api/v1/linguistic/ambiguity", json={
        "dataset_id": "builtin:ambiguity", "item_key": "ambiguity-01",
    }).status_code == 429
    monkeypatch.setattr(queue, "time", lambda: window_start + 60)
    queue_demo(client, "ambiguity")
