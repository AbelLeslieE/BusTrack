"""Sequential system-code allocation for manually created BusTrack records."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.models import Bus, Driver, Route, Student


_SPECS: dict[str, tuple[Any, Any, re.Pattern[str], str]] = {
    "bus": (Bus, Bus.bus_number, re.compile(r"^BUS-(\d+)$", re.IGNORECASE), "BUS-"),
    "route": (Route, Route.route_code, re.compile(r"^RT(\d+)$", re.IGNORECASE), "RT"),
    "driver": (Driver, Driver.driver_code, re.compile(r"^DRV(\d+)$", re.IGNORECASE), "DRV"),
    "student": (Student, Student.student_code, re.compile(r"^STU(\d+)$", re.IGNORECASE), "STU"),
}

_LOCK_KEYS = {
    "bus": 0x42555301,
    "route": 0x42555302,
    "driver": 0x42555303,
    "student": 0x42555304,
}


def lock_generated_code_writes(db: Session, namespace: str) -> None:
    """Serialize allocation within a code family on SQLite and PostgreSQL."""

    if namespace not in _SPECS:
        raise ValueError(f"Unknown generated-code namespace: {namespace}")
    dialect = db.bind.dialect.name
    if dialect == "sqlite":
        connection = db.connection()
        driver_connection = connection.connection.driver_connection
        if not driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
    elif dialect == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": _LOCK_KEYS[namespace]},
        )


def next_generated_code(db: Session, namespace: str) -> str:
    """Return one more than the highest code matching the existing style."""

    try:
        model, column, pattern, prefix = _SPECS[namespace]
    except KeyError as error:
        raise ValueError(f"Unknown generated-code namespace: {namespace}") from error

    highest = 0
    for (value,) in db.query(column).select_from(model).all():
        match = pattern.fullmatch((value or "").strip())
        if match:
            highest = max(highest, int(match.group(1)))
    return f"{prefix}{highest + 1:03d}"


def next_bus_number(db: Session) -> str:
    """Return the lowest unused generated bus number.

    Bus numbers represent fleet slots, so a number becomes available again
    after its bus is deleted. Other generated identifiers remain monotonic.
    """

    _model, column, pattern, prefix = _SPECS["bus"]
    used_numbers: set[int] = set()
    for (value,) in db.query(column).select_from(Bus).all():
        match = pattern.fullmatch((value or "").strip())
        if match:
            number = int(match.group(1))
            if number > 0:
                used_numbers.add(number)

    available = 1
    while available in used_numbers:
        available += 1
    return f"{prefix}{available:03d}"


def next_route_code(db: Session) -> str:
    return next_generated_code(db, "route")


def next_driver_code(db: Session) -> str:
    return next_generated_code(db, "driver")


def next_student_code(db: Session) -> str:
    return next_generated_code(db, "student")
