"""SQLAlchemy database configuration for development and production.

TODO: Add Alembic migrations before evolving production database schemas.
"""

from collections.abc import Generator
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


PROJECT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE_URL = (
    f"sqlite:///{(PROJECT_DIR / 'database' / 'bus_tracker.db').as_posix()}"
)

DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_SQLITE_URL)

# Render/PostgreSQL compatibility
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgres://",
        "postgresql://",
        1
    )

engine_options: dict[str, object] = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Base class for all Bus Tracker SQLAlchemy models."""


def get_db() -> Generator[Session, None, None]:
    """Yield one database session per request and always close it afterward."""

    database_session = SessionLocal()
    try:
        yield database_session
    finally:
        database_session.close()


def initialize_database() -> None:
    """
    Create the database schema.

    RESET_DATABASE=true performs a one-time destructive reset.
    Remove the environment variable immediately after the reset.
    """

    reset_database = (
        os.getenv("RESET_DATABASE", "false").lower() == "true"
    )

    # ======================================================
    # TEMPORARY DATABASE RESET
    # ======================================================

    if reset_database:

        print("==================================================")
        print("WARNING: RESET_DATABASE=true")
        print("Dropping existing database tables...")
        print("==================================================")

        Base.metadata.drop_all(
            bind=engine
        )

        print(
            "Existing database tables removed."
        )

    # ======================================================
    # CREATE CURRENT DATABASE SCHEMA
    # ======================================================

    Base.metadata.create_all(
        bind=engine
    )

    print(
        "Database schema initialized successfully."
    )