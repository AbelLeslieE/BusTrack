"""Safely copy a BusTrack SQLite database into an empty PostgreSQL database.

The command defaults to a read-only preflight.  ``--apply`` first creates a
point-in-time SQLite snapshot, then copies that snapshot to PostgreSQL in one
transaction.  The original SQLite database is never changed or removed.

Use this during a short maintenance window so the last GPS updates are present
in the snapshot that becomes the new production source of truth.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime, time, timezone
import getpass
import json
import os
from pathlib import Path
import sqlite3
import sys
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    exists,
    func,
    inspect,
    select,
    text,
)
from sqlalchemy.engine import Connection, Engine, make_url


PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

# Import every ORM model before reading Base.metadata.  Tracking models are
# intentionally in a route module in this project, so importing models.py
# alone is not enough.
import backend.models  # noqa: E402, F401
import backend.routes.models_tracking  # noqa: E402, F401
from backend.database import Base, DEFAULT_SQLITE_URL  # noqa: E402


ARCHIVE_METADATA = MetaData()
MIGRATION_ARCHIVED_RECORDS = Table(
    "migration_archived_records",
    ARCHIVE_METADATA,
    Column("id", Integer, primary_key=True),
    Column("migration_id", String(36), nullable=False, index=True),
    Column("source_table", String(128), nullable=False, index=True),
    Column("source_record_id", String(128), nullable=False, index=True),
    Column("reason", Text, nullable=False),
    Column("record_json", Text, nullable=False),
    Column("archived_at", DateTime(timezone=True), nullable=False),
)
MIGRATION_REPAIRS = Table(
    "migration_repairs",
    ARCHIVE_METADATA,
    Column("id", Integer, primary_key=True),
    Column("migration_id", String(36), nullable=False, index=True),
    Column("source_table", String(128), nullable=False, index=True),
    Column("source_record_id", String(128), nullable=False, index=True),
    Column("column_name", String(128), nullable=False),
    Column("action", String(64), nullable=False),
    Column("details_json", Text, nullable=False),
    Column("repaired_at", DateTime(timezone=True), nullable=False),
)


class MigrationBlocked(RuntimeError):
    """Raised before target writes when source data cannot be safely copied."""


def _safe_url(url: str) -> str:
    return make_url(url).render_as_string(hide_password=True)


def _normalise_postgres_url(url: str) -> str:
    # Some hosts still return the deprecated postgres:// scheme. SQLAlchemy
    # needs the canonical PostgreSQL scheme and will use psycopg2-binary,
    # which is already a project dependency.
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def _sqlite_path(source_url: str) -> Path:
    parsed = make_url(source_url)
    if parsed.get_backend_name() != "sqlite" or not parsed.database:
        raise MigrationBlocked("The source must be a file-backed sqlite:/// database URL.")
    if parsed.database == ":memory:":
        raise MigrationBlocked("An in-memory SQLite database cannot be migrated safely.")
    path = Path(parsed.database)
    if not path.is_absolute():
        path = (PROJECT_DIR / path).resolve()
    if not path.is_file():
        raise MigrationBlocked(f"SQLite source does not exist: {path}")
    return path


def _create_sqlite_snapshot(source_url: str) -> tuple[str, Path]:
    """Create a consistent SQLite backup without changing the live source."""

    source_path = _sqlite_path(source_url)
    backup_directory = PROJECT_DIR / "database" / "backups"
    backup_directory.mkdir(parents=True, exist_ok=True)
    snapshot_path = backup_directory / (
        f"{source_path.stem}-postgres-cutover-"
        f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.db"
    )

    source_connection = sqlite3.connect(
        f"file:{source_path.as_posix()}?mode=ro",
        uri=True,
    )
    snapshot_connection = sqlite3.connect(snapshot_path)
    try:
        source_connection.backup(snapshot_connection)
    finally:
        snapshot_connection.close()
        source_connection.close()

    return f"sqlite:///{snapshot_path.as_posix()}", snapshot_path


def _primary_key_name(table: Table) -> str:
    columns = list(table.primary_key.columns)
    if len(columns) != 1:
        raise MigrationBlocked(
            f"Table '{table.name}' needs a single-column primary key for migration."
        )
    return columns[0].name


def _reflect_source(source_engine: Engine) -> MetaData:
    metadata = MetaData()
    metadata.reflect(bind=source_engine)
    missing = sorted(set(Base.metadata.tables) - set(metadata.tables))
    if missing:
        raise MigrationBlocked(
            "SQLite source is missing required BusTrack tables: " + ", ".join(missing)
        )
    return metadata


def _foreign_key_specs(source_metadata: MetaData) -> Iterable[tuple[str, str, str, str]]:
    """Yield child table/column and the corresponding parent table/column."""

    for target_table in Base.metadata.sorted_tables:
        source_table = source_metadata.tables[target_table.name]
        for foreign_key in target_table.foreign_keys:
            child_column = foreign_key.parent.name
            parent_table = foreign_key.column.table.name
            parent_column = foreign_key.column.name
            if (
                child_column not in source_table.c
                or parent_table not in source_metadata.tables
                or parent_column not in source_metadata.tables[parent_table].c
            ):
                raise MigrationBlocked(
                    f"SQLite schema cannot satisfy foreign key "
                    f"{target_table.name}.{child_column}."
                )
            yield target_table.name, child_column, parent_table, parent_column


def _find_missing_foreign_keys(
    connection: Connection,
    source_metadata: MetaData,
) -> dict[str, dict[Any, dict[str, dict[str, Any]]]]:
    """Return every target-schema FK that points to a missing parent row."""

    invalid: dict[str, dict[Any, dict[str, dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    for child_name, child_column_name, parent_name, parent_column_name in _foreign_key_specs(
        source_metadata
    ):
        child_table = source_metadata.tables[child_name]
        parent_table = source_metadata.tables[parent_name]
        primary_key = _primary_key_name(child_table)
        child_column = child_table.c[child_column_name]
        parent_column = parent_table.c[parent_column_name]
        query = select(child_table.c[primary_key], child_column).where(
            child_column.is_not(None),
            ~exists(select(1).select_from(parent_table).where(parent_column == child_column)),
        )
        for record_id, missing_value in connection.execute(query):
            invalid[child_name][record_id][child_column_name] = {
                "missing_table": parent_name,
                "missing_column": parent_column_name,
                "missing_value": missing_value,
            }
    return invalid


def _build_repair_plan(
    connection: Connection,
    source_metadata: MetaData,
) -> tuple[
    dict[str, dict[Any, dict[str, dict[str, Any]]]],
    dict[str, dict[Any, list[dict[str, Any]]]],
]:
    """Plan nullable repairs and archival cascades without mutating SQLite."""

    repairs: dict[str, dict[Any, dict[str, dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    archived: dict[str, dict[Any, list[dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(list)
    )

    def archive(table_name: str, record_id: Any, reason: dict[str, Any]) -> bool:
        known = archived[table_name][record_id]
        if reason not in known:
            known.append(reason)
        return len(known) == 1

    for table_name, records in _find_missing_foreign_keys(connection, source_metadata).items():
        target_table = Base.metadata.tables[table_name]
        for record_id, broken_columns in records.items():
            for column_name, reason in broken_columns.items():
                if target_table.c[column_name].nullable:
                    repairs[table_name][record_id][column_name] = reason
                else:
                    archive(table_name, record_id, reason)

    # If a record has to be archived, a child that requires it must also be
    # archived. Nullable child links are retained with a recorded SET NULL
    # repair. This preserves all raw historic data without manufacturing fake
    # routes, drivers, buses, or stops.
    changed = True
    while changed:
        changed = False
        for child_name, child_column_name, parent_name, _parent_column_name in _foreign_key_specs(
            source_metadata
        ):
            parent_ids = list(archived.get(parent_name, {}))
            if not parent_ids:
                continue
            child_table = source_metadata.tables[child_name]
            primary_key = _primary_key_name(child_table)
            child_column = child_table.c[child_column_name]
            query = select(child_table.c[primary_key], child_column).where(
                child_column.in_(parent_ids)
            )
            target_column = Base.metadata.tables[child_name].c[child_column_name]
            for record_id, parent_id in connection.execute(query):
                reason = {
                    "missing_table": parent_name,
                    "missing_column": "id",
                    "missing_value": parent_id,
                    "reason": "parent_record_archived",
                }
                if target_column.nullable:
                    if record_id not in archived[child_name] and child_column_name not in repairs[
                        child_name
                    ][record_id]:
                        repairs[child_name][record_id][child_column_name] = reason
                        changed = True
                elif record_id not in archived[child_name]:
                    if archive(child_name, record_id, reason):
                        changed = True

    # A record copied to the archive cannot also have a production-table
    # repair. Its untouched raw JSON is the authoritative retained record.
    for table_name, records in archived.items():
        for record_id in records:
            repairs[table_name].pop(record_id, None)

    return repairs, archived


def _json_default(value: Any) -> str:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return str(value)


def _normalise_value(value: Any) -> Any:
    """Give legacy SQLite timestamps an explicit UTC offset for PostgreSQL."""

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return value


def _table_count(connection: Connection, table: Table) -> int:
    return int(connection.scalar(select(func.count()).select_from(table)) or 0)


def _print_plan(
    source_connection: Connection,
    source_metadata: MetaData,
    repairs: dict[str, dict[Any, dict[str, dict[str, Any]]]],
    archived: dict[str, dict[Any, list[dict[str, Any]]]],
) -> None:
    print("SQLite integrity preflight")
    print("-" * 72)
    for target_table in Base.metadata.sorted_tables:
        source_table = source_metadata.tables[target_table.name]
        total = _table_count(source_connection, source_table)
        repaired_rows = len(repairs.get(target_table.name, {}))
        repair_fields = sum(
            len(columns) for columns in repairs.get(target_table.name, {}).values()
        )
        archived_rows = len(archived.get(target_table.name, {}))
        print(
            f"{target_table.name}: {total} source, {total - archived_rows} to copy, "
            f"{repaired_rows} repaired rows/{repair_fields} fields, "
            f"{archived_rows} archived rows"
        )

    archived_count = sum(len(records) for records in archived.values())
    if archived_count:
        print(
            "\nArchived rows are retained verbatim in PostgreSQL's "
            "migration_archived_records table."
        )
    else:
        print("\nNo archival is required.")


def _ensure_empty_target(target_engine: Engine) -> None:
    inspector = inspect(target_engine)
    existing = set(inspector.get_table_names())
    application_tables = set(Base.metadata.tables)
    occupied: list[str] = []
    with target_engine.connect() as connection:
        for table_name in sorted(existing & application_tables):
            reflected = Table(table_name, MetaData(), autoload_with=target_engine)
            if _table_count(connection, reflected):
                occupied.append(table_name)
    if occupied:
        raise MigrationBlocked(
            "PostgreSQL target contains BusTrack data and will not be overwritten: "
            + ", ".join(occupied)
        )


def _copy_table(
    source_connection: Connection,
    target_connection: Connection,
    source_table: Table,
    target_table: Table,
    repairs: dict[Any, dict[str, dict[str, Any]]],
    archived: dict[Any, list[dict[str, Any]]],
    migration_id: str,
    now: datetime,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    """Copy one table and return core count plus archive/repair audit rows."""

    primary_key = _primary_key_name(source_table)
    copied = 0
    batch: list[dict[str, Any]] = []
    archive_rows: list[dict[str, Any]] = []
    repair_rows: list[dict[str, Any]] = []

    def flush_batch() -> None:
        nonlocal copied
        if batch:
            target_connection.execute(target_table.insert(), batch)
            copied += len(batch)
            batch.clear()

    for source_row in source_connection.execute(select(source_table)).mappings():
        record = dict(source_row)
        record_id = record[primary_key]
        if record_id in archived:
            archive_rows.append({
                "migration_id": migration_id,
                "source_table": target_table.name,
                "source_record_id": str(record_id),
                "reason": json.dumps(archived[record_id], default=_json_default, sort_keys=True),
                "record_json": json.dumps(record, default=_json_default, sort_keys=True),
                "archived_at": now,
            })
            continue

        copy_row = {
            column.name: _normalise_value(record[column.name])
            for column in target_table.columns
            if column.name in record
        }
        for column_name, reason in repairs.get(record_id, {}).items():
            copy_row[column_name] = None
            repair_rows.append({
                "migration_id": migration_id,
                "source_table": target_table.name,
                "source_record_id": str(record_id),
                "column_name": column_name,
                "action": "set_null_for_missing_reference",
                "details_json": json.dumps(
                    {
                        "original_value": record.get(column_name),
                        **reason,
                    },
                    default=_json_default,
                    sort_keys=True,
                ),
                "repaired_at": now,
            })
        batch.append(copy_row)
        if len(batch) >= 500:
            flush_batch()
    flush_batch()
    return copied, archive_rows, repair_rows


def _reset_postgres_sequences(target_connection: Connection) -> None:
    """Advance PostgreSQL identity sequences after retaining SQLite IDs."""

    for table in Base.metadata.sorted_tables:
        primary_keys = list(table.primary_key.columns)
        if len(primary_keys) != 1 or not isinstance(primary_keys[0].type, Integer):
            continue
        primary_key = primary_keys[0]
        sequence_name = target_connection.scalar(
            text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
            {"table_name": table.name, "column_name": primary_key.name},
        )
        if not sequence_name:
            continue
        maximum = target_connection.scalar(select(func.max(primary_key)))
        if maximum is None:
            target_connection.execute(
                text("SELECT setval(CAST(:sequence_name AS regclass), 1, false)"),
                {"sequence_name": sequence_name},
            )
        else:
            target_connection.execute(
                text("SELECT setval(CAST(:sequence_name AS regclass), :value, true)"),
                {"sequence_name": sequence_name, "value": int(maximum)},
            )


def _verify_target(
    source_counts: dict[str, int],
    archived: dict[str, dict[Any, list[dict[str, Any]]]],
    target_connection: Connection,
    target_engine: Engine,
) -> None:
    for table in Base.metadata.sorted_tables:
        expected = source_counts[table.name] - len(archived.get(table.name, {}))
        actual = _table_count(target_connection, table)
        if actual != expected:
            raise MigrationBlocked(
                f"Verification failed for {table.name}: expected {expected}, copied {actual}."
            )

    target_metadata = MetaData()
    target_metadata.reflect(bind=target_engine)
    violations = _find_missing_foreign_keys(target_connection, target_metadata)
    if violations:
        summary = ", ".join(
            f"{table}:{len(rows)}" for table, rows in sorted(violations.items())
        )
        raise MigrationBlocked("PostgreSQL foreign-key verification failed: " + summary)


def _verify_existing_target(
    source_engine: Engine,
    target_url: str,
    repairs: dict[str, dict[Any, dict[str, dict[str, Any]]]],
    archived: dict[str, dict[Any, list[dict[str, Any]]]],
) -> None:
    """Read-only verification for a target populated by an earlier run."""

    target_engine = create_engine(target_url, pool_pre_ping=True)
    try:
        if target_engine.dialect.name != "postgresql":
            raise MigrationBlocked("The target URL must point to PostgreSQL.")
        target_tables = set(inspect(target_engine).get_table_names())
        required_application_tables = set(Base.metadata.tables)
        required_audit_tables = {
            MIGRATION_ARCHIVED_RECORDS.name,
            MIGRATION_REPAIRS.name,
        }
        missing_application_tables = sorted(required_application_tables - target_tables)
        if missing_application_tables:
            raise MigrationBlocked(
                "Existing PostgreSQL target is incomplete; missing tables: "
                + ", ".join(missing_application_tables)
            )
        missing_audit_tables = sorted(required_audit_tables - target_tables)

        source_metadata = _reflect_source(source_engine)
        mismatches: list[str] = []
        with source_engine.connect() as source_connection, target_engine.connect() as target_connection:
            print("\nRead-only PostgreSQL verification")
            print("-" * 72)
            for table_name in missing_audit_tables:
                print(f"{table_name}: missing")
                mismatches.append(f"{table_name} missing")
            for table in Base.metadata.sorted_tables:
                source_count = _table_count(source_connection, source_metadata.tables[table.name])
                expected = source_count - len(archived.get(table.name, {}))
                actual = _table_count(target_connection, table)
                print(f"{table.name}: expected {expected}, found {actual}")
                if actual != expected:
                    mismatches.append(f"{table.name} expected {expected}/found {actual}")

            expected_archives = sum(len(records) for records in archived.values())
            if MIGRATION_ARCHIVED_RECORDS.name in target_tables:
                actual_archives = _table_count(target_connection, MIGRATION_ARCHIVED_RECORDS)
                print(
                    "migration_archived_records: "
                    f"expected {expected_archives}, found {actual_archives}"
                )
                if actual_archives != expected_archives:
                    mismatches.append(
                        "migration_archived_records "
                        f"expected {expected_archives}/found {actual_archives}"
                    )

            expected_repairs = sum(
                len(columns)
                for table_repairs in repairs.values()
                for columns in table_repairs.values()
            )
            if MIGRATION_REPAIRS.name in target_tables:
                actual_repairs = _table_count(target_connection, MIGRATION_REPAIRS)
                print(f"migration_repairs: expected {expected_repairs}, found {actual_repairs}")
                if actual_repairs != expected_repairs:
                    mismatches.append(
                        f"migration_repairs expected {expected_repairs}/found {actual_repairs}"
                    )

            target_metadata = MetaData()
            target_metadata.reflect(bind=target_engine)
            violations = _find_missing_foreign_keys(target_connection, target_metadata)
            if violations:
                mismatches.append(
                    "foreign keys "
                    + ", ".join(
                        f"{table}:{len(rows)}"
                        for table, rows in sorted(violations.items())
                    )
                )

        if mismatches:
            raise MigrationBlocked(
                "Existing PostgreSQL data does not exactly match the migration source: "
                + "; ".join(mismatches)
            )
        print("\nExisting PostgreSQL migration is complete and verified.")
    finally:
        target_engine.dispose()


def _run_copy(
    source_engine: Engine,
    target_url: str,
    repairs: dict[str, dict[Any, dict[str, dict[str, Any]]]],
    archived: dict[str, dict[Any, list[dict[str, Any]]]],
) -> None:
    target_engine = create_engine(target_url, pool_pre_ping=True)
    try:
        if target_engine.dialect.name != "postgresql":
            raise MigrationBlocked("The target URL must point to PostgreSQL.")
        _ensure_empty_target(target_engine)
        Base.metadata.create_all(bind=target_engine)
        ARCHIVE_METADATA.create_all(bind=target_engine)

        migration_id = str(uuid4())
        migration_time = datetime.now(timezone.utc)
        with source_engine.connect() as source_connection, target_engine.begin() as target_connection:
            source_metadata = _reflect_source(source_engine)
            source_counts = {
                table.name: _table_count(source_connection, source_metadata.tables[table.name])
                for table in Base.metadata.sorted_tables
            }
            all_archives: list[dict[str, Any]] = []
            all_repairs: list[dict[str, Any]] = []
            copied_counts: dict[str, int] = {}
            for target_table in Base.metadata.sorted_tables:
                copied, archive_rows, repair_rows = _copy_table(
                    source_connection,
                    target_connection,
                    source_metadata.tables[target_table.name],
                    target_table,
                    repairs.get(target_table.name, {}),
                    archived.get(target_table.name, {}),
                    migration_id,
                    migration_time,
                )
                copied_counts[target_table.name] = copied
                all_archives.extend(archive_rows)
                all_repairs.extend(repair_rows)

            if all_archives:
                target_connection.execute(MIGRATION_ARCHIVED_RECORDS.insert(), all_archives)
            if all_repairs:
                target_connection.execute(MIGRATION_REPAIRS.insert(), all_repairs)

            _reset_postgres_sequences(target_connection)
            _verify_target(source_counts, archived, target_connection, target_engine)

        print("\nPostgreSQL migration completed and verified.")
        print(f"Migration ID: {migration_id}")
        print("Copied rows:")
        for table_name, count in copied_counts.items():
            print(f"  {table_name}: {count}")
        print(f"Archived raw rows: {sum(len(rows) for rows in archived.values())}")
        print(f"Recorded nullable-reference repairs: {sum(len(rows) for rows in repairs.values())}")
    finally:
        target_engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-url",
        default=os.getenv("SQLITE_DATABASE_URL", DEFAULT_SQLITE_URL),
        help="Source sqlite:/// URL (defaults to the local BusTrack database).",
    )
    parser.add_argument(
        "--target-url",
        default=os.getenv("POSTGRES_DATABASE_URL"),
        help="Empty PostgreSQL URL. Prefer POSTGRES_DATABASE_URL in a secret store.",
    )
    parser.add_argument(
        "--prompt-target-url",
        action="store_true",
        help=(
            "Prompt invisibly for the PostgreSQL URL. This overrides "
            "POSTGRES_DATABASE_URL and prevents the credential appearing in "
            "PowerShell history or copied terminal output."
        ),
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create a snapshot and write the verified copy to PostgreSQL.",
    )
    parser.add_argument(
        "--verify-existing-target",
        action="store_true",
        help="Read and verify an already-populated PostgreSQL target without changing it.",
    )
    parser.add_argument(
        "--archive-invalid-history",
        action="store_true",
        help="Retain non-repairable invalid historic rows in the PostgreSQL archive table.",
    )
    arguments = parser.parse_args()

    source_url = arguments.source_url
    source_engine = create_engine(source_url)
    try:
        source_metadata = _reflect_source(source_engine)
        with source_engine.connect() as source_connection:
            repairs, archived = _build_repair_plan(source_connection, source_metadata)
            _print_plan(source_connection, source_metadata, repairs, archived)

        target_url_input = arguments.target_url
        if arguments.prompt_target_url and (
            arguments.apply or arguments.verify_existing_target
        ):
            target_url_input = getpass.getpass(
                "Paste the current Render External Database URL (input hidden): "
            ).strip()

        if (arguments.apply or arguments.verify_existing_target) and not target_url_input:
            raise MigrationBlocked(
                "A PostgreSQL URL is required. Use --prompt-target-url, "
                "POSTGRES_DATABASE_URL, or --target-url."
            )

        target_url = (
            _normalise_postgres_url(target_url_input)
            if target_url_input
            else None
        )
        if arguments.verify_existing_target:
            _verify_existing_target(source_engine, target_url, repairs, archived)
            return

        archived_count = sum(len(records) for records in archived.values())
        if not arguments.apply:
            print("\nDry run only. Re-run with --apply during a maintenance window.")
            if archived_count:
                print("Include --archive-invalid-history to preserve invalid historic rows safely.")
            return
        if archived_count and not arguments.archive_invalid_history:
            raise MigrationBlocked(
                "Source contains non-repairable historic records. Re-run with "
                "--archive-invalid-history to retain their raw data safely."
            )

        # Work from a frozen snapshot, then recompute the plan from that
        # snapshot so validation and the copied data are exactly the same.
        snapshot_url, snapshot_path = _create_sqlite_snapshot(source_url)
        print(f"\nCreated SQLite cutover snapshot: {snapshot_path}")
        source_engine.dispose()
        source_engine = create_engine(snapshot_url)
        source_metadata = _reflect_source(source_engine)
        with source_engine.connect() as source_connection:
            repairs, archived = _build_repair_plan(source_connection, source_metadata)
        print(f"Copying snapshot to: {_safe_url(target_url)}")
        _run_copy(source_engine, target_url, repairs, archived)
    finally:
        source_engine.dispose()


if __name__ == "__main__":
    try:
        main()
    except MigrationBlocked as error:
        print(f"\nMigration stopped safely: {error}", file=sys.stderr)
        raise SystemExit(2) from error
