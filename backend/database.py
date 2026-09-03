"""SQLAlchemy database configuration for development and production.

TODO: Add Alembic migrations before evolving production database schemas.
"""

from collections.abc import Generator
import os
from pathlib import Path
import re

from sqlalchemy import create_engine, event, inspect, text
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

def _positive_integer_setting(name: str, default: int) -> int:
    """Read a bounded pool setting without making a bad environment value fatal."""

    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if 1 <= value <= 100 else default


engine_options: dict[str, object] = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    # SQLite normally gives up after five seconds when another request is
    # writing.  The portals poll concurrently, so a short default timeout
    # turns a transient write lock into a visible 500 response.
    engine_options["connect_args"] = {
        "check_same_thread": False,
        "timeout": 30,
    }
elif DATABASE_URL.startswith("postgresql"):
    # PostgreSQL is used for the shared deployment, where GPS writes and
    # portal polling happen concurrently.  A small, bounded pool prevents a
    # burst of browser polling from exhausting the database connection limit.
    engine_options.update({
        "pool_size": _positive_integer_setting("DATABASE_POOL_SIZE", 5),
        "max_overflow": _positive_integer_setting("DATABASE_MAX_OVERFLOW", 5),
        "pool_timeout": _positive_integer_setting("DATABASE_POOL_TIMEOUT", 30),
        "pool_recycle": _positive_integer_setting("DATABASE_POOL_RECYCLE", 1800),
        "connect_args": {"connect_timeout": 10},
    })

engine = create_engine(DATABASE_URL, **engine_options)


if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _configure_sqlite_connection(connection, _connection_record) -> None:
        """Make local SQLite connections wait safely for a pending writer."""

        cursor = connection.cursor()
        try:
            cursor.execute("PRAGMA busy_timeout = 30000")
            cursor.execute("PRAGMA foreign_keys = ON")
        finally:
            cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Base class for all Bus Tracker SQLAlchemy models."""


def _make_live_trip_driver_optional(database_engine=engine) -> None:
    """Upgrade existing databases for hardware-owned trips without a driver."""

    database_inspector = inspect(database_engine)
    if "live_trips" not in database_inspector.get_table_names():
        return
    driver_column = next(
        (
            column
            for column in database_inspector.get_columns("live_trips")
            if column["name"] == "driver_id"
        ),
        None,
    )
    if driver_column is None or driver_column.get("nullable", True):
        return

    if database_engine.dialect.name == "postgresql":
        with database_engine.begin() as connection:
            connection.execute(text(
                "ALTER TABLE live_trips ALTER COLUMN driver_id DROP NOT NULL"
            ))
        return

    if database_engine.dialect.name != "sqlite":
        raise RuntimeError(
            "The live_trips.driver_id compatibility migration supports SQLite and PostgreSQL."
        )

    # SQLite cannot drop a NOT NULL constraint in place. Rebuild this one
    # table transactionally while foreign-key enforcement is temporarily off;
    # child tables continue to reference the same final table name.
    temporary_table = "live_trips__driver_optional"
    with database_engine.connect() as connection:
        create_sql = connection.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='live_trips'"
        ).scalar_one()
        optional_sql = re.sub(
            r"(\bdriver_id\b\s+INTEGER)\s+NOT\s+NULL",
            r"\1",
            create_sql,
            count=1,
            flags=re.IGNORECASE,
        )
        optional_sql = re.sub(
            r"^CREATE\s+TABLE\s+(?:\"live_trips\"|live_trips)",
            f"CREATE TABLE {temporary_table}",
            optional_sql,
            count=1,
            flags=re.IGNORECASE,
        )
        if optional_sql == create_sql or "driver_id INTEGER NOT NULL" in optional_sql:
            raise RuntimeError("Unable to make live_trips.driver_id optional.")

        column_names = [
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(live_trips)").all()
        ]
        quoted_columns = ", ".join(f'"{name}"' for name in column_names)
        connection.commit()
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        try:
            with connection.begin():
                connection.exec_driver_sql(f"DROP TABLE IF EXISTS {temporary_table}")
                connection.exec_driver_sql(optional_sql)
                connection.exec_driver_sql(
                    f"INSERT INTO {temporary_table} ({quoted_columns}) "
                    f"SELECT {quoted_columns} FROM live_trips"
                )
                connection.exec_driver_sql("DROP TABLE live_trips")
                connection.exec_driver_sql(
                    f"ALTER TABLE {temporary_table} RENAME TO live_trips"
                )
        finally:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            connection.commit()


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

    # WAL lets read-only portal polling continue while a short write (such as
    # login auditing or a GPS update) is in progress.  It is safe to issue on
    # every startup and is ignored for non-SQLite deployments.
    if DATABASE_URL.startswith("sqlite"):
        with engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA journal_mode=WAL")

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

    _make_live_trip_driver_optional()

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

    # Bus passes were introduced after the initial schema. Fresh databases
    # receive the table through metadata.create_all; existing installations
    # only need this one non-destructive compatibility column.
    if "bus_passes" in inspector.get_table_names():
        pass_columns = {column["name"] for column in inspector.get_columns("bus_passes")}
        if "validity_period" not in pass_columns:
            with engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE bus_passes "
                    "ADD COLUMN validity_period VARCHAR(20) NOT NULL DEFAULT 'One Year'"
                ))

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
            if "terminal_reached_at" not in trip_columns:
                connection.execute(text(
                    "ALTER TABLE live_trips ADD COLUMN terminal_reached_at TIMESTAMP NULL"
                ))
            if "terminal_stop_id" not in trip_columns:
                connection.execute(text(
                    "ALTER TABLE live_trips ADD COLUMN terminal_stop_id INTEGER NULL"
                ))

    if "live_locations" in inspector.get_table_names():
        location_columns = {column["name"] for column in inspector.get_columns("live_locations")}
        if "source" not in location_columns:
            with engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE live_locations ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'mobile'"
                ))

    # Stop events are the compact historical record retained after coordinate
    # telemetry is purged. Store a label/order snapshot so past visits remain
    # readable even if a stop is later renamed or removed from a route.
    if "trip_stop_events" in inspector.get_table_names():
        stop_event_columns = {
            column["name"] for column in inspector.get_columns("trip_stop_events")
        }
        with engine.begin() as connection:
            if "stop_code_snapshot" not in stop_event_columns:
                connection.execute(text(
                    "ALTER TABLE trip_stop_events ADD COLUMN stop_code_snapshot VARCHAR(20)"
                ))
            if "stop_name_snapshot" not in stop_event_columns:
                connection.execute(text(
                    "ALTER TABLE trip_stop_events ADD COLUMN stop_name_snapshot VARCHAR(150)"
                ))
            if "route_sequence_snapshot" not in stop_event_columns:
                connection.execute(text(
                    "ALTER TABLE trip_stop_events ADD COLUMN route_sequence_snapshot INTEGER"
                ))

    # ``create_all`` does not add newly declared indexes to tables that
    # already exist. Ensure upgraded PostgreSQL installations receive the
    # composite live-trip/GPS indexes as well as fresh installations.
    for table in Base.metadata.tables.values():
        for table_index in table.indexes:
            table_index.create(bind=engine, checkfirst=True)

    print(
        "Database schema initialized successfully."
    )
