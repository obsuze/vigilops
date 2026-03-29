"""add match_alert_types to custom_runbooks

Revision ID: 027_runbook_match_types
Revises: 026_reconcile_ops_schema_once
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa


revision = "027_runbook_match_types"
down_revision = "026_reconcile_ops_schema_once"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "custom_runbooks",
        sa.Column("match_alert_types", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("custom_runbooks", "match_alert_types")
