from datetime import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Float, ForeignKey, String, Text, UniqueConstraint, false, func
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class CreatedAt:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(CreatedAt, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(24), server_default="researcher")


class SessionToken(Base):
    __tablename__ = "sessions"

    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Dataset(CreatedAt, Base):
    __tablename__ = "datasets"
    __table_args__ = (UniqueConstraint("owner_id", "name", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    version: Mapped[int]
    dimension: Mapped[str] = mapped_column(String(32))
    provenance: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16), server_default="user")
    archived: Mapped[bool] = mapped_column(Boolean, server_default=false())


class DatasetItem(Base):
    __tablename__ = "dataset_items"
    __table_args__ = (UniqueConstraint("dataset_id", "item_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), index=True)
    item_key: Mapped[str] = mapped_column(String(64))
    stimulus: Mapped[dict] = mapped_column(JSON)
    reference: Mapped[dict] = mapped_column(JSON)


class Prompt(CreatedAt, Base):
    __tablename__ = "prompts"
    __table_args__ = (UniqueConstraint("owner_id", "name", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    version: Mapped[int]
    dimension: Mapped[str] = mapped_column(String(32))
    template: Mapped[str] = mapped_column(Text)


class ModelSnapshot(Base):
    __tablename__ = "model_snapshots"
    __table_args__ = (UniqueConstraint("provider", "identifier"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(50))
    identifier: Mapped[str] = mapped_column(String(200))


class Experiment(CreatedAt, Base):
    __tablename__ = "experiments"
    __table_args__ = (CheckConstraint("repetitions >= 1", name="positive_repetitions"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"))
    prompt_id: Mapped[int] = mapped_column(ForeignKey("prompts.id"))
    name: Mapped[str] = mapped_column(String(150))
    state: Mapped[str] = mapped_column(String(24), server_default="draft")
    repetitions: Mapped[int] = mapped_column(server_default="1")
    protocol: Mapped[dict] = mapped_column(JSON)
    kind: Mapped[str] = mapped_column(String(16), server_default="batch")
    cancel_requested: Mapped[bool] = mapped_column(Boolean, server_default=false())


class ModelResponse(CreatedAt, Base):
    __tablename__ = "responses"
    __table_args__ = (
        UniqueConstraint("experiment_id", "item_id", "model_id", "trial"),
        CheckConstraint("trial >= 1", name="positive_trial"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("dataset_items.id"))
    model_id: Mapped[int] = mapped_column(ForeignKey("model_snapshots.id"))
    trial: Mapped[int]
    prompt_rendered: Mapped[str] = mapped_column(Text)
    raw_output: Mapped[str | None] = mapped_column(Text)
    parsed_output: Mapped[dict | None] = mapped_column(JSON)
    execution: Mapped[dict] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16), server_default="completed", index=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claim: Mapped[str | None] = mapped_column(String(36))
    hidden: Mapped[bool] = mapped_column(Boolean, server_default=false())


class Evaluation(CreatedAt, Base):
    __tablename__ = "evaluations"
    __table_args__ = (CheckConstraint("score >= 0 AND score <= 1", name="normalized_score"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    response_id: Mapped[int] = mapped_column(ForeignKey("responses.id"), index=True)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    rubric_version: Mapped[str] = mapped_column(String(64))
    criterion: Mapped[str] = mapped_column(String(64))
    method: Mapped[str] = mapped_column(String(24))
    score: Mapped[float] = mapped_column(Float)
    evidence: Mapped[dict] = mapped_column(JSON)
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("assessment_attempts.id"), index=True)
    assignment_id: Mapped[int | None] = mapped_column(ForeignKey("review_assignments.id"), index=True)


class Report(CreatedAt, Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id"), index=True)
    specification: Mapped[dict] = mapped_column(JSON)


class ModelProvider(Base):
    __tablename__ = "model_providers"

    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(24), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean)
    credential_ciphertext: Mapped[str | None] = mapped_column(Text)
    default_model: Mapped[str | None] = mapped_column(String(200))
    parameters: Mapped[dict] = mapped_column(JSON)


class ProviderDiagnostic(Base):
    __tablename__ = "provider_diagnostics"

    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(24), primary_key=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    latency_ms: Mapped[int]
    status: Mapped[str] = mapped_column(String(16))
    model: Mapped[str | None] = mapped_column(String(200))
    model_count: Mapped[int | None]
    model_listed: Mapped[bool | None]
    error_code: Mapped[str | None] = mapped_column(String(48))
    error_message: Mapped[str | None] = mapped_column(Text)


class AuthenticationQuota(Base):
    __tablename__ = "authentication_quota"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window: Mapped[int] = mapped_column(index=True)
    used: Mapped[int]


class ResearchQuota(Base):
    __tablename__ = "research_quota"

    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    operation: Mapped[str] = mapped_column(String(24), primary_key=True)
    window: Mapped[int]
    used: Mapped[int]
