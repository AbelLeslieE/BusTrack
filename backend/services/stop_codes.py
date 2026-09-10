"""Concurrency-safe stop-code allocation shared by manual and import flows."""

from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.models import Stop


STOP_CODE_PATTERN = re.compile(r"^ST(\d+)$", re.IGNORECASE)
STOP_CODE_LOCK_KEY = 0x425553545241434B  # Stable PostgreSQL advisory lock: "BUSTRACK".


def lock_stop_code_writes(db: Session) -> None:
    """Serialize code allocation for SQLite and PostgreSQL transactions."""

    dialect = db.bind.dialect.name
    if dialect == "sqlite":
        connection = db.connection()
        driver_connection = connection.connection.driver_connection
        if not driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
    elif dialect == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": STOP_CODE_LOCK_KEY},
        )


def generated_stop_number(stop_code: str | None) -> int | None:
    """Return the numeric part of an ST code, or None for custom codes."""

    match = STOP_CODE_PATTERN.fullmatch((stop_code or "").strip())
    return int(match.group(1)) if match else None


def highest_generated_stop_number(db: Session) -> int:
    """Find the largest numeric ST code without relying on row count or IDs."""

    highest = 0
    for (stop_code,) in db.query(Stop.stop_code).all():
        number = generated_stop_number(stop_code)
        if number is not None:
            highest = max(highest, number)
    return highest


def format_stop_code(number: int) -> str:
    """Use ST plus at least three digits (for example ST030)."""

    return f"ST{number:03d}"


def next_stop_code(db: Session) -> str:
    """Preview or allocate the next code after the current numeric maximum."""

    return format_stop_code(highest_generated_stop_number(db) + 1)
