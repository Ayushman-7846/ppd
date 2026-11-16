from datetime import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import CreatedAt


class Rubric(CreatedAt, Base):
    __tablename__ = "rubric_versions"
    __table_args__ = (UniqueConstraint("owner_id", "name", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    version: Mapped[int]
    weights: Mapped[dict] = mapped_column(JSON)
    criteria: Mapped[dict] = mapped_column(JSON)


class Assessment(CreatedAt, Base):
    __tablename__ = "assessment_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    response_id: Mapped[int] = mapped_column(ForeignKey("responses.id"), index=True)
    rubric_id: Mapped[int] = mapped_column(ForeignKey("rubric_versions.id"), index=True)
    method: Mapped[str] = mapped_column(String(16))
    state: Mapped[str] = mapped_column(String(24), index=True)
    judge_id: Mapped[int | None] = mapped_column(ForeignKey("model_snapshots.id"))
    judge_config: Mapped[dict] = mapped_column(JSON)
    input_snapshot: Mapped[dict] = mapped_column(JSON)


class AssessmentAttempt(CreatedAt, Base):
    __tablename__ = "assessment_attempts"
    __table_args__ = (UniqueConstraint("assessment_id", "number"), CheckConstraint("number >= 1", name="positive_number"))

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessment_jobs.id"), index=True)
    number: Mapped[int]
    state: Mapped[str] = mapped_column(String(24), index=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claim: Mapped[str | None] = mapped_column(String(36))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_output: Mapped[str | None] = mapped_column(Text)
    judge_prompt: Mapped[str | None] = mapped_column(Text)
    score: Mapped[float | None] = mapped_column(Float)
    result: Mapped[dict] = mapped_column(JSON)


class ReviewAssignment(CreatedAt, Base):
    __tablename__ = "review_assignments"
    __table_args__ = (UniqueConstraint("response_id", "rubric_id", "reviewer_id", "response_hash"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    response_id: Mapped[int] = mapped_column(ForeignKey("responses.id"), index=True)
    rubric_id: Mapped[int] = mapped_column(ForeignKey("rubric_versions.id"), index=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    assigned_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    blind: Mapped[bool] = mapped_column(Boolean)
    state: Mapped[str] = mapped_column(String(16))
    revision: Mapped[int]
    draft: Mapped[dict] = mapped_column(JSON)
    input_snapshot: Mapped[dict] = mapped_column(JSON)
    response_hash: Mapped[str] = mapped_column(String(64))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    score: Mapped[float | None] = mapped_column(Float)
    verdict: Mapped[str | None] = mapped_column(String(16))


class ReviewDecision(CreatedAt, Base):
    __tablename__ = "review_decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    response_id: Mapped[int] = mapped_column(ForeignKey("responses.id"), index=True)
    rubric_id: Mapped[int] = mapped_column(ForeignKey("rubric_versions.id"))
    adjudicator_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    verdict: Mapped[str] = mapped_column(String(16))
    justification: Mapped[str] = mapped_column(Text)
    source_reviews: Mapped[list] = mapped_column(JSON)


class ResponseError(CreatedAt, Base):
    __tablename__ = "response_errors"

    id: Mapped[int] = mapped_column(primary_key=True)
    response_id: Mapped[int] = mapped_column(ForeignKey("responses.id"), index=True)
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("assessment_attempts.id"), index=True)
    assignment_id: Mapped[int | None] = mapped_column(ForeignKey("review_assignments.id"), index=True)
    category: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(12))
    source: Mapped[str] = mapped_column(String(16))
    state: Mapped[str] = mapped_column(String(12))
    evidence: Mapped[str] = mapped_column(Text)


class ResearchSnapshot(CreatedAt, Base):
    __tablename__ = "research_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    filters: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict] = mapped_column(JSON)


class AuditEvent(CreatedAt, Base):
    __tablename__ = "research_audit"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(40))
    target_id: Mapped[int]
    detail: Mapped[dict] = mapped_column(JSON)
