import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import Base, get_db, make_engine
from app.main import app
from app.models import Dataset, Experiment, Prompt, SessionToken, User


ORIGIN = {"Origin": "http://localhost:3000"}
PASSWORD = "a sufficiently long password"


@pytest.fixture
def api(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'test.sqlite3'}")
    Base.metadata.create_all(engine)

    def test_db():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = test_db
    with TestClient(app) as client:
        yield client, engine
    app.dependency_overrides.clear()
    engine.dispose()


def test_health_and_demo(api):
    client, _ = api
    assert client.get("/health/live").json() == {"data": {"status": "alive"}}
    assert client.get("/health/ready").json() == {"data": {"status": "ready"}}
    overview = client.get("/api/v1/demo/overview").json()["data"]
    assert overview["provenance"] == "synthetic"
    for example in overview["examples"]:
        assert client.get(f"/api/v1/demo/examples/{example['dimension']}").json() == {"data": example}
    assert client.get("/api/v1/demo/examples/unknown").json()["error"]["code"] == "invalid_input"


def test_auth_session_lifecycle(api):
    client, engine = api
    assert client.get("/api/v1/workspace/overview").status_code == 401
    payload = {"email": "Researcher@example.com", "name": "  Researcher  ", "password": PASSWORD}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 403
    registration = client.post("/api/v1/auth/register", headers=ORIGIN, json=payload)
    assert registration.status_code == 201
    assert registration.headers["cache-control"] == "no-store"
    assert "HttpOnly" in registration.headers["set-cookie"]
    profile = registration.json()["data"]
    assert profile == {"id": profile["id"], "name": "Researcher", "email": "researcher@example.com", "role": "researcher"}
    cookie = client.cookies.get("lingualens_session")
    with Session(engine) as database:
        assert database.get(SessionToken, cookie) is None
        assert database.scalar(select(User)).password_hash.startswith("$argon2id$")
    assert client.post("/api/v1/auth/register", headers=ORIGIN, json=payload).status_code == 409
    assert client.get("/api/v1/auth/me").json()["data"] == profile
    assert client.post("/api/v1/auth/logout", headers=ORIGIN).status_code == 200
    with TestClient(app) as replay:
        replay.cookies.set("lingualens_session", cookie)
        assert replay.get("/api/v1/auth/me").status_code == 401
    assert client.post("/api/v1/auth/login", headers=ORIGIN, json={**payload, "password": "incorrect"}).status_code == 401
    assert client.post("/api/v1/auth/login", headers=ORIGIN, json=payload).status_code == 200


def test_workspace_is_scoped_to_owner(api):
    client, engine = api
    user_id = client.post("/api/v1/auth/register", headers=ORIGIN, json={
        "email": "owner@example.com", "name": "Owner", "password": PASSWORD,
    }).json()["data"]["id"]
    with Session(engine) as database:
        outsider = User(email="elsewhere@example.com", name="Other", password_hash="unused")
        database.add(outsider)
        database.flush()
        for owner in (user_id, outsider.id):
            dataset = Dataset(owner_id=owner, name="Study", version=1, dimension="recursion", provenance="original")
            prompt = Prompt(owner_id=owner, name="Task", version=1, dimension="recursion", template="Analyze nesting.")
            database.add_all([dataset, prompt])
            database.flush()
            database.add(Experiment(owner_id=owner, dataset_id=dataset.id, prompt_id=prompt.id,
                                    name=f"Experiment for {owner}", protocol={}))
        database.commit()
    overview = client.get("/api/v1/workspace/overview").json()["data"]
    assert overview["datasets"] == overview["experiments"] == 1
    assert overview["evaluations"] == 0
    assert [item["name"] for item in overview["recent"]] == [f"Experiment for {user_id}"]
