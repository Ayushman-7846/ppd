import logging
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Event, Thread

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .analysis_api import router as analysis_router
from .auth import CurrentUser, router as auth_router
from .catalog_api import router as catalog_router
from .config import get_settings
from .database import Database
from .evaluation_api import router as evaluation_router
from .evaluation_models import Rubric
from .models import AuthenticationQuota, Dataset, Evaluation, Experiment, ModelProvider, ModelResponse, ProviderDiagnostic
from .providers import ProviderError
from .queue import run_worker
from .request_limit import ResearchBodyLimit
from .run_api import router as run_router
from .schemas import DemoExample, DemoOverview, Dimension, Envelope, ExperimentSummary, WorkspaceOverview


@asynccontextmanager
async def lifespan(_app):
    stop = Event()
    worker = None
    if get_settings().worker_enabled:
        worker = Thread(target=run_worker, args=(stop,), daemon=True, name="lingualens-research")
        worker.start()
    try:
        yield
    finally:
        if worker:
            stop.set()
            worker.join(timeout=2)


app = FastAPI(title="LinguaLens API", version="0.4.0", lifespan=lifespan)
app.add_middleware(ResearchBodyLimit)
app.include_router(auth_router, prefix="/api/v1")
app.include_router(catalog_router, prefix="/api/v1")
app.include_router(run_router, prefix="/api/v1")
app.include_router(evaluation_router, prefix="/api/v1")
app.include_router(analysis_router, prefix="/api/v1")
logger = logging.getLogger(__name__)
fixture = Path(__file__).resolve().parents[2] / "datasets" / "demo.json"
DEMO = DemoOverview.model_validate_json(fixture.read_text(encoding="utf-8"))


def error_response(status: int, code: str, message: str, headers=None):
    return JSONResponse({"error": {"code": code, "message": message}}, status, headers=headers)


@app.middleware("http")
async def prevent_private_caching(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/v1/"):
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(StarletteHTTPException)
async def handle_http(_request: Request, error: StarletteHTTPException):
    return error_response(error.status_code, f"http_{error.status_code}", str(error.detail), error.headers)


@app.exception_handler(RequestValidationError)
async def handle_validation(_request: Request, error: RequestValidationError):
    field = error.errors()[0]["loc"][-1]
    issue = error.errors()[0]["msg"]
    return error_response(422, "invalid_input", f"Check {field}. {issue}")


@app.exception_handler(ProviderError)
async def handle_provider(_request: Request, error: ProviderError):
    return error_response(error.status, error.code, str(error))


@app.exception_handler(SQLAlchemyError)
async def handle_database(_request: Request, _error: SQLAlchemyError):
    logger.error("Database operation failed")
    return error_response(503, "database_unavailable", "The research database is unavailable.")


@app.get("/health/live", response_model=Envelope[dict], tags=["Health"])
def live():
    return Envelope(data={"status": "alive"})


@app.get("/health/ready", response_model=Envelope[dict], tags=["Health"])
def ready(db: Database):
    # Check the migrated schema as well as database connectivity.
    db.execute(select(Dataset.id).limit(1))
    db.execute(select(ModelProvider.owner_id).limit(1))
    db.execute(select(Rubric.id).limit(1))
    db.execute(select(ProviderDiagnostic.owner_id).limit(1))
    db.execute(select(AuthenticationQuota.key).limit(1))
    return Envelope(data={"status": "ready"})


@app.get("/api/v1/demo/overview", response_model=Envelope[DemoOverview], tags=["Demo"])
def demo_overview():
    return Envelope(data=DEMO)


@app.get("/api/v1/demo/examples/{dimension}", response_model=Envelope[DemoExample], tags=["Demo"])
def demo_example(dimension: Dimension):
    for example in DEMO.examples:
        if example.dimension == dimension:
            return Envelope(data=example)
    raise HTTPException(404, "This example is unavailable.")


@app.get("/api/v1/workspace/overview", response_model=Envelope[WorkspaceOverview], tags=["Workspace"])
def workspace_overview(db: Database, user: CurrentUser):
    owner = Experiment.owner_id == user.id
    recent = db.scalars(select(Experiment).where(owner).order_by(Experiment.id.desc()).limit(8))
    return Envelope(data=WorkspaceOverview(
        datasets=db.scalar(select(func.count(Dataset.id)).where(
            Dataset.owner_id == user.id, Dataset.kind == "user", Dataset.archived.is_(False))),
        experiments=db.scalar(select(func.count(Experiment.id)).where(owner)),
        evaluations=db.scalar(select(func.count(Evaluation.id))
                              .join(ModelResponse).join(Experiment).where(owner)),
        recent=[ExperimentSummary(id=item.id, name=item.name, state=item.state) for item in recent],
    ))
