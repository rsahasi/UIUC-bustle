"""Crowding reports and shared trips (move off ephemeral SQLite onto Postgres)

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-16
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE crowding_reports (
            id                   BIGSERIAL PRIMARY KEY,
            vehicle_id           TEXT NOT NULL,
            route_id             TEXT NOT NULL,
            trip_id              TEXT,
            crowding_level       INTEGER NOT NULL CHECK (crowding_level BETWEEN 1 AND 4),
            anonymous_user_token TEXT,
            reported_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            lat                  DOUBLE PRECISION,
            lon                  DOUBLE PRECISION
        )
    """)
    op.execute("CREATE INDEX idx_crowding_vehicle_reported ON crowding_reports (vehicle_id, reported_at)")
    op.execute("CREATE INDEX idx_crowding_route_reported ON crowding_reports (route_id, reported_at)")
    op.execute("CREATE INDEX idx_crowding_token_vehicle ON crowding_reports (anonymous_user_token, vehicle_id, reported_at DESC)")

    op.execute("""
        CREATE TABLE shared_trips (
            id           TEXT PRIMARY KEY,
            destination  TEXT NOT NULL,
            route_id     TEXT,
            route_name   TEXT,
            stop_name    TEXT,
            phase        TEXT NOT NULL DEFAULT 'walking',
            eta_epoch    BIGINT,
            created_at   BIGINT NOT NULL,
            expires_at   BIGINT NOT NULL
        )
    """)
    op.execute("CREATE INDEX idx_shared_trips_expires ON shared_trips (expires_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared_trips")
    op.execute("DROP TABLE IF EXISTS crowding_reports")
