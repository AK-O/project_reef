import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import TypeDecorator, DateTime as _SADateTime, create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

logger = logging.getLogger(__name__)


class UTCDateTime(TypeDecorator):
    """DateTime that always comes back UTC-aware from SQLite.

    SQLite stores datetimes as plain strings (no timezone). When SQLAlchemy
    reads them back, the tzinfo is None, which causes Pydantic to serialise
    without a 'Z' suffix.  JavaScript then treats the string as *local* time
    instead of UTC — producing the wrong display time.

    This type re-attaches UTC on every read so the JSON always contains the
    offset and JS parses it correctly.
    """
    impl = _SADateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, datetime) and value.tzinfo is not None:
            # Store as UTC-naive string (SQLite has no tz support)
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, datetime) and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/projectreef.db")

# Ensure the data directory exists for SQLite
if DATABASE_URL.startswith("sqlite"):
    db_path = DATABASE_URL.replace("sqlite:///", "").replace("sqlite://", "")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

# Enable WAL mode for better SQLite concurrency
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_wal(conn, _):
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _column_exists(conn, table: str, column: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(row[1] == column for row in rows)


_MIGRATIONS: list[tuple[str, str, str]] = [
    # (table, column, column_definition)
    ("tasks",    "position",    "INTEGER"),
    ("projects", "color_hue",   "INTEGER"),
    ("projects", "icon_seed",   "INTEGER"),
    ("projects", "sort_order",  "INTEGER DEFAULT 0"),
    ("users",    "is_admin",    "BOOLEAN DEFAULT 0"),
    ("projects", "public_token","TEXT"),
]


def init_db():
    from models import Base  # noqa: F401 — registers all models
    Base.metadata.create_all(bind=engine)
    if DATABASE_URL.startswith("sqlite"):
        from sqlalchemy import text
        with engine.connect() as conn:
            for table, column, definition in _MIGRATIONS:
                if _column_exists(conn, table, column):
                    continue
                try:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))
                    conn.commit()
                    logger.info("Migration: added %s.%s", table, column)
                except Exception as exc:
                    logger.error("Migration failed for %s.%s: %s", table, column, exc)

        # Backfill public_token for existing rows that have NULL
        with engine.connect() as conn:
            rows = conn.execute(text("SELECT id FROM projects WHERE public_token IS NULL")).fetchall()
            for (pid,) in rows:
                conn.execute(
                    text("UPDATE projects SET public_token = :t WHERE id = :id"),
                    {"t": str(uuid.uuid4()), "id": pid},
                )
            conn.commit()
