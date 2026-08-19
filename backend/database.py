"""SQLAlchemy database configuration for development and production.

TODO: Add Alembic migrations before evolving production database schemas.
"""

from collections.abc import Generator
import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from backend.roles import LEGACY_ROLE_MAPPINGS


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

    # This project currently has no migration framework. Keep existing local
    # deployments compatible with the student route assignment introduced by
    # the central Assignment workspace.
    inspector = inspect(engine)
    if "students" in inspector.get_table_names():
        student_columns = {
            column["name"] for column in inspector.get_columns("students")
        }
        if "route_id" not in student_columns:
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "ALTER TABLE students "
                        "ADD COLUMN route_id INTEGER REFERENCES routes(id)"
                    )
                )

    if "users" in inspector.get_table_names():
        user_columns = {
            column["name"] for column in inspector.get_columns("users")
        }
        with engine.begin() as connection:
            if "failed_login_attempts" not in user_columns:
                connection.execute(text(
                    "ALTER TABLE users "
                    "ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0"
                ))
            if "locked_until" not in user_columns:
                connection.execute(text(
                    "ALTER TABLE users ADD COLUMN locked_until TIMESTAMP NULL"
                ))
            if "auth_version" not in user_columns:
                connection.execute(text(
                    "ALTER TABLE users "
                    "ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1"
                ))

        # Consolidate the historic role names into the three supported roles.
        # This is idempotent and keeps existing Student profile records intact.
        with engine.begin() as connection:
            for legacy_role, canonical in LEGACY_ROLE_MAPPINGS.items():
                connection.execute(
                    text(
                        "UPDATE users SET role = :canonical "
                        "WHERE lower(trim(role)) = :legacy_role"
                    ),
                    {"canonical": canonical, "legacy_role": legacy_role},
                )

    # Lightweight compatibility migrations for the external GPS provider
    # integration. New provider tables are created by metadata.create_all;
    # these two columns are added for existing installations.
    if "live_trips" in inspector.get_table_names():
        trip_columns = {column["name"] for column in inspector.get_columns("live_trips")}
        with engine.begin() as connection:
            if "current_location_source" not in trip_columns:
                connection.execute(text(
                    "ALTER TABLE live_trips ADD COLUMN current_location_source VARCHAR(32)"
                ))
            if "route_direction" not in trip_columns:
                connection.execute(text(
                    "ALTER TABLE live_trips ADD COLUMN route_direction VARCHAR(16) NOT NULL DEFAULT 'forward'"
                ))
            if "ended_by_user_id" not in trip_columns:
                connection.execute(text(
                    "ALTER TABLE live_trips ADD COLUMN ended_by_user_id INTEGER NULL"
                ))
            if "end_reason" not in trip_columns:
                connection.execute(text(
                    "ALTER TABLE live_trips ADD COLUMN end_reason VARCHAR(300) NULL"
                ))

    if "live_locations" in inspector.get_table_names():
        location_columns = {column["name"] for column in inspector.get_columns("live_locations")}
        if "source" not in location_columns:
            with engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE live_locations ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'mobile'"
                ))

    print(
        "Database schema initialized successfully."
    )
