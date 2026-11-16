import csv
import io
import json
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from app import auth, catalog_api, semantic
from app.config import get_settings
from app.lab_schemas import DIMENSIONS, DatasetInput
from app.providers import ProviderError
from app.reporting import csv_report
from test_research import data, register, workspace


def test_provider_catalog_diagnostics_are_private_persisted_and_reset(workspace, monkeypatch):
    client, _ = workspace
    settings = get_settings()
    monkeypatch.setattr(settings, "openai_api_key", SecretStr("example-credential-for-testing"))
    monkeypatch.setattr(settings, "allow_shared_provider_keys", True)
    provider = "/api/v1/providers/openai"
    data(client.put(provider, json={"enabled": True, "default_model": "audit-model"}))
    monkeypatch.setattr(catalog_api, "discover", lambda *_: ["audit-model", "other-model"])
    assert data(client.post(provider + "/test")) == ["audit-model", "other-model"]
    check = data(client.get("/api/v1/providers"))[0]["diagnostic"]
    assert check["status"] == "reachable" and check["model"] == "audit-model" and check["model_listed"]
    assert check["model_count"] == 2 and check["checked_at"].endswith("+00:00") and check["latency_ms"] >= 0

    def timeout(*_):
        raise ProviderError("Provider timed out.", code="provider_timeout", status=504)

    monkeypatch.setattr(catalog_api, "discover", timeout)
    assert client.post(provider + "/test").status_code == 504
    response = client.get("/api/v1/providers")
    assert "example-credential-for-testing" not in response.text
    current = data(response)[0]["diagnostic"]
    assert current["status"] == "failed" and current["last_success_at"] == check["last_success_at"]
    assert current["error_code"] == "provider_timeout"
    assert data(client.put(provider, json={"enabled": True, "default_model": "changed-model"}))["diagnostic"] is None
    assert client.post(provider + "/test").status_code == 504
    register(client, "second")
    assert data(client.get("/api/v1/providers"))[0]["diagnostic"] is None
    monkeypatch.setattr(settings, "allow_shared_provider_keys", False)
    assert not data(client.get("/api/v1/providers"))[0]["configured"]
    assert client.post(provider + "/test").status_code == 422
    assert data(client.get("/api/v1/providers"))[0]["diagnostic"]["status"] == "blocked"


def test_authentication_window_and_registration_policy(workspace, monkeypatch):
    client, _ = workspace
    window = 1_800_000_000
    monkeypatch.setattr(auth, "time", lambda: window)
    body = {"email": "first@example.com", "password": "wrong-password-123"}
    for _ in range(10):
        assert client.post("/api/v1/auth/login", json=body).status_code == 401
    blocked = client.post("/api/v1/auth/login", json=body | {"email": "FIRST@example.com"})
    assert blocked.status_code == 429 and blocked.headers["retry-after"] == "60"
    monkeypatch.setattr(auth, "time", lambda: window + 60)
    assert client.post("/api/v1/auth/login", json=body | {"password": "research-password-123"}).status_code == 200
    monkeypatch.setattr(get_settings(), "registration_enabled", False)
    assert client.post("/api/v1/auth/register", json=body | {"email": "blocked@example.com", "name": "Closed"}).status_code == 403


def test_semantic_provider_timeout_is_sanitized_and_closes_client(monkeypatch):
    monkeypatch.setattr(get_settings(), "semantic_model", "mock-embedding")
    closed = []

    class Unavailable:
        def __init__(self, **options):
            assert options["timeout"] == 25 and not options["trust_env"]

        def embed(self, **_options):
            raise httpx.ReadTimeout("sensitive internal error from embedding service")

        def close(self):
            closed.append(True)

    monkeypatch.setattr(semantic, "Client", Unavailable)
    with pytest.raises(ProviderError) as failure:
        semantic.embedded_matrix(["first response", "second response"])
    assert failure.value.code == "provider_timeout" and "sensitive" not in str(failure.value) and closed == [True]


def test_csv_downloads_quote_spreadsheet_like_text_without_changing_json(workspace):
    client, _ = workspace
    sentence = "＝linguistic example"
    saved = data(client.post("/api/v1/datasets", json={"name": "CSV text protection", "dimension": "ambiguity", "items": [
        {"item_key": "safe-example", "stimulus": {"sentence": sentence}},
    ]}), 201)
    export = f"/api/v1/datasets/{saved['id']}/export"
    assert next(csv.DictReader(io.StringIO(client.get(export + "?format=csv").text)))["sentence"] == "'" + sentence
    assert client.get(export + "?format=json").json()["items"][0]["stimulus"]["sentence"] == sentence
    row = {"id": 1, "experiment_id": 1, "dataset": sentence, "dataset_version": 1, "dimension": "ambiguity", "provider": "demo",
           "model": "reference", "trial": 1, "state": "completed", "score": 0, "verdict": "incorrect",
           "latency_ms": None, "input_tokens": None, "output_tokens": None, "errors": []}
    report = {"id": 1, "population": "demo", "method": "deterministic", "rubric": {"version": 1}, "trials": [row]}
    cells = next(csv.DictReader(io.StringIO(csv_report(report))))
    assert cells["dataset"] == "'" + sentence and cells["score"] == "0"


@pytest.mark.parametrize("dimension", DIMENSIONS)
def test_benchmark_pilot_is_importable_balanced_and_honestly_labelled(dimension, workspace):
    client, _ = workspace
    root = Path(__file__).resolve().parents[2] / "datasets" / "benchmark-v1"
    source = (root / f"{dimension}.json").read_bytes()
    dataset = DatasetInput.model_validate_json(source)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    metadata = {row["item_key"]: row for row in manifest["items"] if row["dimension"] == dimension}
    assert manifest["review_status"] == "candidate_unverified"
    assert len(dataset.items) == len(metadata) == 4
    assert sum(row.reference.detected is True for row in dataset.items) == 2
    assert all(metadata[item.item_key]["expected_detection"] == item.reference.detected for item in dataset.items)
    saved = data(client.post("/api/v1/datasets/import", data={"name": dataset.name, "dimension": dimension},
                             files={"file": (f"{dimension}.json", source, "application/json")}), 201)
    assert len(saved["items"]) == 4 and "pending independent review" in saved["provenance"]
