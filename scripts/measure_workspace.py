"""Measure a copied demo database using the real FastAPI handlers, with no network inference."""

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from statistics import median, quantiles
import sys
from time import perf_counter
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.auth import COOKIE, digest
from app.config import get_settings
from app.database import engine
from app.main import app
from app.models import Experiment, ModelResponse, Report, SessionToken


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, choices=range(5, 101), default=20, metavar="5–100")
    args = parser.parse_args()
    if not engine.url.database or "phase4-perf" not in engine.url.database:
        parser.error("Use a disposable copy of a demo database with phase4-perf in its name.")
    cfg = get_settings()
    cfg.worker_enabled = False
    token = uuid4().hex
    count = 0

    @event.listens_for(engine, "before_cursor_execute")
    def observe(*_args):
        nonlocal count
        count += 1

    with Session(engine) as db:
        report, owner = db.execute(select(Report, Experiment.owner_id).join(Experiment).where(
            Report.specification["population"].as_string() == "demo").order_by(Report.id.desc()).limit(1)).one()
        stored = report.specification
        report_id = report.id
        db.add(SessionToken(digest=digest(token), user_id=owner,
                            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5)))
        db.commit()
    cohort = dict(stored["filters"], save=False, semantic=False)
    total = len(stored["trials"])
    targets = {
        "assessment list": lambda client: client.get("/api/v1/evaluations"),
        "comparison": lambda client: client.post("/api/v1/model-comparisons", json=cohort),
        "analytics": lambda client: client.post("/api/v1/analytics", json=cohort),
        "consistency": lambda client: client.post("/api/v1/consistency", json=cohort),
        "PDF export": lambda client: client.get(f"/api/v1/reports/export/{report_id}?format=pdf"),
    }
    evidence = {"trials": total, "samples_per_endpoint": args.samples, "endpoints": {}}
    with TestClient(app, headers={"Origin": cfg.web_origin}, cookies={COOKIE: token}) as client:
        for label, measure in targets.items():
            measure(client)
            times, queries, sizes = [], [], []
            failures = 0
            for _ in range(args.samples):
                count = 0
                started = perf_counter()
                result = measure(client)
                times.append((perf_counter() - started) * 1000)
                queries.append(count)
                sizes.append(len(result.content))
                failures += result.status_code != 200
            evidence["endpoints"][label] = {"p50_ms": round(median(times), 2), "p95_ms": round(quantiles(
                times, n=20, method="inclusive")[18], 2), "median_sql_statements": median(queries),
                "median_bytes": median(sizes), "failures": failures}
    print(json.dumps(evidence, indent=2))
    return int(any(row["failures"] for row in evidence["endpoints"].values()))


if __name__ == "__main__":
    raise SystemExit(main())
