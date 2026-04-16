"""Remove default user seed

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove orphaned schedule_classes first (FK constraint)
    op.execute("DELETE FROM schedule_classes WHERE user_id = 'default'")
    op.execute("DELETE FROM users WHERE user_id = 'default'")


def downgrade() -> None:
    op.execute("INSERT INTO users (user_id) VALUES ('default') ON CONFLICT DO NOTHING")
