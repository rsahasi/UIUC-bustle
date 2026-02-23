"""
Buildings and schedule tables in app SQLite DB.
"""
import json
import sqlite3
import uuid
from pathlib import Path
from typing import NamedTuple

DEFAULT_USER_ID = "default"

VALID_DAYS = frozenset({"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"})


class BuildingRecord(NamedTuple):
    building_id: str
    name: str
    lat: float
    lng: float


class ClassRecord(NamedTuple):
    class_id: str
    title: str
    days_of_week: list[str]
    start_time_local: str
    building_id: str
    user_id: str
    destination_lat: float | None = None
    destination_lng: float | None = None
    destination_name: str | None = None
    end_time_local: str | None = None


def init_app_db(db_path: str | Path) -> None:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS buildings (
                building_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schedule_classes (
                class_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                days_of_week TEXT NOT NULL,
                start_time_local TEXT NOT NULL,
                building_id TEXT NOT NULL,
                FOREIGN KEY (building_id) REFERENCES buildings(building_id),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_schedule_classes_user ON schedule_classes(user_id)")
        # Ensure default user exists
        conn.execute(
            "INSERT OR IGNORE INTO users (user_id) VALUES (?)",
            (DEFAULT_USER_ID,),
        )
        # Ensure "custom" pseudo-building exists (for address-search destinations)
        conn.execute(
            "INSERT OR IGNORE INTO buildings (building_id, name, lat, lng) VALUES (?, ?, ?, ?)",
            ("custom", "Custom Location", 0.0, 0.0),
        )
        # Optional columns (backward-compatible migration)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(schedule_classes)").fetchall()]
        for col, typ in (
            ("destination_lat", "REAL"),
            ("destination_lng", "REAL"),
            ("destination_name", "TEXT"),
            ("end_time_local", "TEXT"),
        ):
            if col not in cols:
                conn.execute(f"ALTER TABLE schedule_classes ADD COLUMN {col} {typ}")
        conn.commit()


def list_buildings(db_path: str | Path) -> list[BuildingRecord]:
    db_path = Path(db_path)
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute("SELECT building_id, name, lat, lng FROM buildings ORDER BY name")
        return [
            BuildingRecord(
                building_id=r["building_id"],
                name=r["name"],
                lat=r["lat"],
                lng=r["lng"],
            )
            for r in cur.fetchall()
        ]


def search_buildings(db_path: str | Path, query: str, limit: int = 6) -> list[BuildingRecord]:
    """
    Token-aware, case-insensitive search.
    Splits query into words; returns buildings where ALL tokens appear in name.
    Falls back to ANY-token match if no AND results found.
    Scoring: 4=all tokens + starts with first, 3=exact full name, 2=starts with query, 1=contains.
    """
    db_path = Path(db_path)
    if not db_path.exists() or not query.strip():
        return []
    q = query.strip()
    tokens = [t for t in q.lower().split() if t]
    if not tokens:
        return []

    def _fetch(where_clause: str, params: list) -> list[BuildingRecord]:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.execute(
                f"""
                SELECT building_id, name, lat, lng,
                       CASE
                           WHEN lower(name) = ?                   THEN 4
                           WHEN lower(name) LIKE ? || '%'         THEN 3
                           WHEN lower(name) LIKE ? || '%'         THEN 2
                           ELSE 1
                       END AS score
                FROM buildings
                WHERE {where_clause}
                  AND building_id != 'custom'
                ORDER BY score DESC, name ASC
                LIMIT ?
                """,
                [q.lower(), tokens[0], q.lower()] + params + [limit],
            )
            return [
                BuildingRecord(building_id=r["building_id"], name=r["name"], lat=r["lat"], lng=r["lng"])
                for r in cur.fetchall()
            ]

    # Try AND match (all tokens must appear)
    and_clause = " AND ".join(f"lower(name) LIKE '%' || ? || '%'" for _ in tokens)
    results = _fetch(and_clause, list(tokens))
    if results:
        return results

    # Fallback: OR match (any token appears)
    or_clause = " OR ".join(f"lower(name) LIKE '%' || ? || '%'" for _ in tokens)
    return _fetch(or_clause, list(tokens))


def get_building(db_path: str | Path, building_id: str) -> BuildingRecord | None:
    db_path = Path(db_path)
    if not db_path.exists():
        return None
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            "SELECT building_id, name, lat, lng FROM buildings WHERE building_id = ?",
            (building_id,),
        )
        r = cur.fetchone()
        if r is None:
            return None
        return BuildingRecord(
            building_id=r["building_id"],
            name=r["name"],
            lat=r["lat"],
            lng=r["lng"],
        )


def create_class(
    db_path: str | Path,
    *,
    title: str,
    days_of_week: list[str],
    start_time_local: str,
    building_id: str | None = None,
    user_id: str = DEFAULT_USER_ID,
    class_id: str | None = None,
    destination_lat: float | None = None,
    destination_lng: float | None = None,
    destination_name: str | None = None,
    end_time_local: str | None = None,
) -> ClassRecord:
    db_path = Path(db_path)
    if not db_path.exists():
        raise ValueError("Database not initialized. Run seed_buildings.py first.")
    use_custom = destination_lat is not None and destination_lng is not None
    if use_custom:
        bid = "custom"
        if get_building(db_path, bid) is None:
            raise ValueError("Custom address support not initialized. Run init_app_db first.")
    else:
        if not building_id or not building_id.strip():
            raise ValueError("Provide building_id or destination_lat, destination_lng, and destination_name.")
        bid = building_id.strip()
        if get_building(db_path, bid) is None:
            raise ValueError(f"Building '{bid}' not found.")
    cid = class_id or str(uuid.uuid4())
    days_json = json.dumps(days_of_week)
    dest_name = (destination_name or "").strip() if use_custom else None
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO schedule_classes
                (class_id, user_id, title, days_of_week, start_time_local, building_id,
                 destination_lat, destination_lng, destination_name, end_time_local)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cid, user_id, title, days_json, start_time_local, bid,
                destination_lat if use_custom else None,
                destination_lng if use_custom else None,
                dest_name,
                end_time_local,
            ),
        )
        conn.commit()
    return ClassRecord(
        class_id=cid,
        title=title,
        days_of_week=days_of_week,
        start_time_local=start_time_local,
        building_id=bid,
        user_id=user_id,
        destination_lat=destination_lat if use_custom else None,
        destination_lng=destination_lng if use_custom else None,
        destination_name=dest_name,
        end_time_local=end_time_local,
    )


def delete_class(
    db_path: str | Path,
    class_id: str,
    user_id: str = DEFAULT_USER_ID,
) -> bool:
    """Delete a class by class_id for the given user. Returns True if a row was deleted."""
    db_path = Path(db_path)
    if not db_path.exists():
        return False
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute(
            "DELETE FROM schedule_classes WHERE class_id = ? AND user_id = ?",
            (class_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0


def list_classes(
    db_path: str | Path,
    user_id: str = DEFAULT_USER_ID,
) -> list[ClassRecord]:
    db_path = Path(db_path)
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT class_id, title, days_of_week, start_time_local, building_id, user_id,
                   destination_lat, destination_lng, destination_name, end_time_local
            FROM schedule_classes
            WHERE user_id = ?
            ORDER BY start_time_local, title
            """,
            (user_id,),
        )
        out = []
        for r in cur.fetchall():
            days = json.loads(r["days_of_week"])
            if not isinstance(days, list):
                days = []
            out.append(
                ClassRecord(
                    class_id=r["class_id"],
                    title=r["title"],
                    days_of_week=days,
                    start_time_local=r["start_time_local"],
                    building_id=r["building_id"],
                    user_id=r["user_id"],
                    destination_lat=float(r["destination_lat"]) if r["destination_lat"] is not None else None,
                    destination_lng=float(r["destination_lng"]) if r["destination_lng"] is not None else None,
                    destination_name=r["destination_name"],
                    end_time_local=r["end_time_local"],
                )
            )
        return out
