"""Portable, compressed BusTrack database backup and recovery archives."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal
from io import BytesIO
import base64
import json
from typing import Any
import uuid
import zipfile

from sqlalchemy import MetaData, select, text
from sqlalchemy.engine import Connection, Engine


BACKUP_FORMAT_VERSION = 2
MANIFEST_MEMBER = "manifest.json"
DATA_MEMBER = "data/application-tables.json"
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024


def _application_metadata() -> MetaData:
    """Load only BusTrack-owned tables, never managed Supabase schemas."""

    from backend.database import Base

    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(metadata)
    return metadata


def _schema(metadata: MetaData) -> list[dict[str, Any]]:
    return [
        {"name": table.name, "columns": [column.name for column in table.columns]}
        for table in metadata.sorted_tables
    ]


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, datetime):
        return {"__backup_type__": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"__backup_type__": "date", "value": value.isoformat()}
    if isinstance(value, time):
        return {"__backup_type__": "time", "value": value.isoformat()}
    if isinstance(value, Decimal):
        return {"__backup_type__": "decimal", "value": str(value)}
    if isinstance(value, uuid.UUID):
        return {"__backup_type__": "uuid", "value": str(value)}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"__backup_type__": "bytes", "value": base64.b64encode(bytes(value)).decode("ascii")}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    raise TypeError(f"Unsupported database value type: {type(value).__name__}")


def _database_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_database_value(item) for item in value]
    if not isinstance(value, dict):
        return value
    marker = value.get("__backup_type__")
    if marker == "datetime":
        return datetime.fromisoformat(value["value"])
    if marker == "date":
        return date.fromisoformat(value["value"])
    if marker == "time":
        return time.fromisoformat(value["value"])
    if marker == "decimal":
        return Decimal(value["value"])
    if marker == "uuid":
        return uuid.UUID(value["value"])
    if marker == "bytes":
        return base64.b64decode(value["value"], validate=True)
    return {key: _database_value(item) for key, item in value.items()}


def create_database_backup_archive(engine: Engine, *, created_at: datetime | None = None) -> bytes:
    """Create a consistent, compressed backup from SQLite or PostgreSQL."""

    timestamp = created_at or datetime.now(timezone.utc)
    timestamp = timestamp.replace(tzinfo=timezone.utc) if timestamp.tzinfo is None else timestamp.astimezone(timezone.utc)
    metadata = _application_metadata()
    schema = _schema(metadata)
    payload: dict[str, list[dict[str, Any]]] = {}

    # PostgreSQL's repeatable-read transaction makes every table in the ZIP
    # come from one point in time even while vehicles continue reporting.
    connection_options = {"isolation_level": "REPEATABLE READ"} if engine.dialect.name == "postgresql" else {}
    with engine.connect().execution_options(**connection_options) as connection:
        transaction = connection.begin()
        try:
            for table in metadata.sorted_tables:
                rows = connection.execute(select(table)).mappings().all()
                payload[table.name] = [
                    {column.name: _json_value(row[column.name]) for column in table.columns}
                    for row in rows
                ]
            transaction.commit()
        except Exception:
            transaction.rollback()
            raise

    manifest = {
        "application": "BusTrack",
        "format": "BusTrack logical database backup",
        "format_version": BACKUP_FORMAT_VERSION,
        "created_at": timestamp.isoformat(),
        "source_database_dialect": engine.dialect.name,
        "schema": schema,
        "row_counts": {name: len(rows) for name, rows in payload.items()},
    }
    archive = BytesIO()
    with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zip_file:
        zip_file.writestr(MANIFEST_MEMBER, json.dumps(manifest, indent=2, sort_keys=True))
        zip_file.writestr(DATA_MEMBER, json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    return archive.getvalue()


def _read_backup_archive(archive: bytes, metadata: MetaData) -> dict[str, list[dict[str, Any]]]:
    """Validate an untrusted ZIP fully before any database data is changed."""

    if not archive or len(archive) > MAX_ARCHIVE_BYTES:
        raise ValueError("The backup file is empty or exceeds the 100 MB limit.")
    try:
        with zipfile.ZipFile(BytesIO(archive)) as zip_file:
            names = set(zip_file.namelist())
            if names != {MANIFEST_MEMBER, DATA_MEMBER}:
                raise ValueError("The backup archive has an unexpected file layout.")
            if sum(item.file_size for item in zip_file.infolist()) > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("The backup archive expands beyond the 500 MB safety limit.")
            manifest = json.loads(zip_file.read(MANIFEST_MEMBER))
            payload = json.loads(zip_file.read(DATA_MEMBER))
    except (OSError, ValueError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        raise ValueError("The uploaded file is not a valid BusTrack backup archive.") from error

    expected_schema = _schema(metadata)
    if (
        manifest.get("application") != "BusTrack"
        or manifest.get("format_version") != BACKUP_FORMAT_VERSION
        or manifest.get("schema") != expected_schema
    ):
        raise ValueError("The backup is not compatible with this version of BusTrack.")
    if not isinstance(payload, dict) or set(payload) != {table.name for table in metadata.sorted_tables}:
        raise ValueError("The backup does not contain the expected BusTrack tables.")

    checked_payload: dict[str, list[dict[str, Any]]] = {}
    for table in metadata.sorted_tables:
        rows = payload.get(table.name)
        columns = {column.name for column in table.columns}
        if not isinstance(rows, list):
            raise ValueError(f"The backup data for {table.name} is invalid.")
        checked_rows = []
        for row in rows:
            if not isinstance(row, dict) or set(row) != columns:
                raise ValueError(f"The backup data for {table.name} does not match the current schema.")
            checked_rows.append({key: _database_value(value) for key, value in row.items()})
        checked_payload[table.name] = checked_rows
    return checked_payload


def _reset_postgresql_sequences(connection: Connection, metadata: MetaData) -> None:
    if connection.dialect.name != "postgresql":
        return
    quote = connection.dialect.identifier_preparer.quote
    for table in metadata.sorted_tables:
        primary_keys = list(table.primary_key.columns)
        if len(primary_keys) != 1:
            continue
        column = primary_keys[0]
        sequence = connection.execute(
            text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
            {"table_name": table.name, "column_name": column.name},
        ).scalar_one_or_none()
        if not sequence:
            continue
        table_name = quote(table.name)
        column_name = quote(column.name)
        connection.execute(text(
            f"SELECT setval(:sequence_name, COALESCE((SELECT MAX({column_name}) FROM {table_name}), 1), "
            f"(SELECT MAX({column_name}) IS NOT NULL FROM {table_name}))"
        ), {"sequence_name": sequence})


def restore_database_backup_archive(engine: Engine, archive: bytes) -> None:
    """Replace BusTrack data with a validated backup in one database transaction."""

    metadata = _application_metadata()
    payload = _read_backup_archive(archive, metadata)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            for table in reversed(metadata.sorted_tables):
                connection.execute(table.delete())
            for table in metadata.sorted_tables:
                rows = payload[table.name]
                for offset in range(0, len(rows), 500):
                    if rows[offset:offset + 500]:
                        connection.execute(table.insert(), rows[offset:offset + 500])
            _reset_postgresql_sequences(connection, metadata)
            transaction.commit()
        except Exception:
            transaction.rollback()
            raise
