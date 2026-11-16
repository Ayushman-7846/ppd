"""Scope each review assignment to the evaluated response text."""

from alembic import op
import sqlalchemy as sa


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("review_assignments", sa.Column("response_hash", sa.String(64), nullable=True))
    if op.get_bind().dialect.name == "postgresql":
        op.execute("UPDATE review_assignments SET response_hash = input_snapshot ->> 'response_hash'")
    else:
        op.execute("UPDATE review_assignments SET response_hash = json_extract(input_snapshot, '$.response_hash')")
    with op.batch_alter_table("review_assignments") as batch:
        batch.alter_column("response_hash", existing_type=sa.String(64), nullable=False)
        batch.drop_constraint(op.f("uq_review_assignments_response_id"), type_="unique")
        batch.create_unique_constraint(op.f("uq_review_assignments_response_id"),
                                       ["response_id", "rubric_id", "reviewer_id", "response_hash"])


def downgrade():
    # A downgrade after separate assignments exist for revised outputs would lose data.
    # Reinstating the old constraint will fail atomically in that case.
    with op.batch_alter_table("review_assignments") as batch:
        batch.drop_constraint(op.f("uq_review_assignments_response_id"), type_="unique")
        batch.create_unique_constraint(op.f("uq_review_assignments_response_id"), ["response_id", "rubric_id", "reviewer_id"])
        batch.drop_column("response_hash")
