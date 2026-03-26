"""add verify_steps to custom_runbooks

Revision ID: 028_runbook_verify_steps
Revises: 027_runbook_match_types
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa


revision = "028_runbook_verify_steps"
down_revision = "027_runbook_match_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "custom_runbooks",
        sa.Column("verify_steps", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("custom_runbooks", "verify_steps")
