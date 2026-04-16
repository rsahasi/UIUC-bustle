"""Initial schema

Revision ID: 0001
Revises:
Create Date: 2026-03-17
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.execute("""
        CREATE TABLE users (
            user_id TEXT PRIMARY KEY
        )
    """)
    op.execute("INSERT INTO users (user_id) VALUES ('default') ON CONFLICT DO NOTHING")

    op.execute("""
        CREATE TABLE buildings (
            building_id TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            lat         DOUBLE PRECISION NOT NULL,
            lng         DOUBLE PRECISION NOT NULL
        )
    """)
    op.execute("INSERT INTO buildings (building_id, name, lat, lng) VALUES ('custom', 'Custom Location', 0.0, 0.0) ON CONFLICT DO NOTHING")
    op.execute("CREATE INDEX buildings_name_trgm ON buildings USING GIN (name gin_trgm_ops)")

    op.execute("""
        CREATE TABLE schedule_classes (
            class_id             TEXT PRIMARY KEY,
            user_id              TEXT NOT NULL REFERENCES users(user_id),
            title                TEXT NOT NULL,
            days_of_week         TEXT NOT NULL,
            start_time_local     TEXT NOT NULL,
            building_id          TEXT NOT NULL REFERENCES buildings(building_id),
            destination_lat      DOUBLE PRECISION,
            destination_lng      DOUBLE PRECISION,
            destination_name     TEXT,
            end_time_local       TEXT
        )
    """)
    op.execute("CREATE INDEX schedule_classes_user_id ON schedule_classes (user_id)")

    op.execute("""
        CREATE TABLE stops (
            stop_id   TEXT PRIMARY KEY,
            stop_name TEXT NOT NULL,
            lat       DOUBLE PRECISION NOT NULL,
            lng       DOUBLE PRECISION NOT NULL
        )
    """)
    op.execute("CREATE INDEX stops_lat_lng ON stops (lat, lng)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS schedule_classes")
    op.execute("DROP TABLE IF EXISTS buildings")
    op.execute("DROP TABLE IF EXISTS users")
    op.execute("DROP TABLE IF EXISTS stops")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
