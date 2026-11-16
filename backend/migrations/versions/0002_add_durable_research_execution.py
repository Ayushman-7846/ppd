"""add durable research execution

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'model_providers',
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('provider', sa.String(length=24), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('credential_ciphertext', sa.Text(), nullable=True),
        sa.Column('default_model', sa.String(length=200), nullable=True),
        sa.Column('parameters', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_model_providers_owner_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('owner_id', 'provider', name=op.f('pk_model_providers')),
    )
    op.create_table(
        'research_quota',
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('operation', sa.String(length=24), nullable=False),
        sa.Column('window', sa.Integer(), nullable=False),
        sa.Column('used', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_research_quota_owner_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('owner_id', 'operation', name=op.f('pk_research_quota')),
    )
    op.add_column('datasets', sa.Column('kind', sa.String(length=16), server_default='user', nullable=False))
    op.add_column('datasets', sa.Column('archived', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('experiments', sa.Column('kind', sa.String(length=16), server_default='batch', nullable=False))
    op.add_column('experiments', sa.Column('cancel_requested', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('responses', sa.Column('state', sa.String(length=16), server_default='completed', nullable=False))
    op.add_column('responses', sa.Column('lease_until', sa.DateTime(timezone=True), nullable=True))
    op.add_column('responses', sa.Column('claim', sa.String(length=36), nullable=True))
    op.add_column('responses', sa.Column('hidden', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.create_index(op.f('ix_responses_state'), 'responses', ['state'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_responses_state'), table_name='responses')
    op.drop_column('responses', 'hidden')
    op.drop_column('responses', 'claim')
    op.drop_column('responses', 'lease_until')
    op.drop_column('responses', 'state')
    op.drop_column('experiments', 'cancel_requested')
    op.drop_column('experiments', 'kind')
    op.drop_column('datasets', 'archived')
    op.drop_column('datasets', 'kind')
    op.drop_table('research_quota')
    op.drop_table('model_providers')
