"""Persist provider diagnostics and bound unauthenticated password verification."""

from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("provider_diagnostics",
        sa.Column("owner_id", sa.Integer(), nullable=False), sa.Column("provider", sa.String(24), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False), sa.Column("last_success_at", sa.DateTime(timezone=True)),
        sa.Column("latency_ms", sa.Integer(), nullable=False), sa.Column("status", sa.String(16), nullable=False),
        sa.Column("model", sa.String(200)), sa.Column("model_count", sa.Integer()), sa.Column("model_listed", sa.Boolean()),
        sa.Column("error_code", sa.String(48)), sa.Column("error_message", sa.Text()),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("owner_id", "provider"))
    op.create_table("authentication_quota", sa.Column("key", sa.String(64), nullable=False),
        sa.Column("window", sa.Integer(), nullable=False), sa.Column("used", sa.Integer(), nullable=False), sa.PrimaryKeyConstraint("key"))
    op.create_index("ix_authentication_quota_window", "authentication_quota", ["window"])


def downgrade():
    op.drop_index("ix_authentication_quota_window", table_name="authentication_quota")
    op.drop_table("authentication_quota")
    op.drop_table("provider_diagnostics")
