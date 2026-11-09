"""Finite IST-scheduled GPS workers for Cloud Run Jobs.

The peak worker polls providers frequently only while buses are normally in
service.  The standby worker performs one low-frequency refresh outside those
windows and owns the lightweight maintenance previously kept alive inside a
24-hour Cloud Run service.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, time as wall_time, timedelta, timezone
import logging
import os
import time
from typing import Callable, Iterator

from sqlalchemy import text
from sqlalchemy.orm import Session

import backend.models  # noqa: F401  # Register every mapped relationship.
import backend.models_documents  # noqa: F401
import backend.models_route_studio  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import SessionLocal, engine, validate_database_configuration
from backend.services.bus_documents import run_document_reminders
from backend.services.daily_direction import apply_daily_direction
from backend.services.gps_providers import (
    provider_polling_configured,
    refresh_gps_providers,
)
from backend.services.restore_state import restore_in_progress
from backend.services.telemetry_retention import (
    run_telemetry_retention,
    telemetry_retention_enabled,
)


IST = timezone(timedelta(hours=5, minutes=30), name="IST")
PEAK_WINDOWS = (
    (wall_time(7, 0), wall_time(9, 15)),
    (wall_time(16, 15), wall_time(19, 15)),
)
STANDBY_START = wall_time(9, 0)
# A short grace period lets the 20:00 Scheduler trigger survive normal Cloud
# Run startup delay without allowing the 20:30 slot to perform a refresh.
STANDBY_LAST_START = wall_time(20, 15)
MIDNIGHT_MAINTENANCE_END = wall_time(0, 15)
PROVIDER_REFRESH_LOCK_ID = 4_278_775_220

configured_log_level = os.getenv("LOG_LEVEL", "INFO").strip().upper()
logging.basicConfig(
    level=getattr(logging, configured_log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("bustrack.gps_worker")


def as_ist(now: datetime | None = None) -> datetime:
    """Return an aware timestamp in Indian Standard Time."""

    selected = now or datetime.now(timezone.utc)
    if selected.tzinfo is None:
        selected = selected.replace(tzinfo=timezone.utc)
    return selected.astimezone(IST)


def active_peak_window(now: datetime | None = None) -> tuple[datetime, datetime] | None:
    """Return the active IST peak window, with an exclusive end boundary."""

    local = as_ist(now)
    for start_time, end_time in PEAK_WINDOWS:
        start = datetime.combine(local.date(), start_time, tzinfo=IST)
        end = datetime.combine(local.date(), end_time, tzinfo=IST)
        if start <= local < end:
            return start, end
    return None


def standby_refresh_allowed(now: datetime | None = None) -> bool:
    """Allow a standby poll from 09:00 through the delayed 20:00 trigger."""

    local = as_ist(now)
    return (
        STANDBY_START <= local.time() < STANDBY_LAST_START
        and active_peak_window(local) is None
    )


def midnight_maintenance_due(now: datetime | None = None) -> bool:
    """Identify the 00:01 IST maintenance trigger without depending on UTC."""

    local_time = as_ist(now).time()
    return wall_time(0, 0) <= local_time < MIDNIGHT_MAINTENANCE_END


def peak_poll_interval_seconds() -> int:
    """Use the cost-conscious end of the requested five-to-ten-second range."""

    try:
        configured = int(os.getenv("GPS_PEAK_POLL_INTERVAL_SECONDS", "10"))
    except ValueError:
        configured = 10
    return min(10, max(5, configured))


@contextmanager
def _provider_session() -> Iterator[Session | None]:
    """Serialize provider refreshes across jobs without holding a lock all day."""

    if engine.dialect.name != "postgresql":
        with SessionLocal() as database_session:
            yield database_session
        return

    # A connection-scoped PostgreSQL advisory lock prevents a delayed standby
    # execution or a manual run from duplicating an active provider request.
    with engine.connect() as connection:
        acquired = bool(connection.execute(
            text("SELECT pg_try_advisory_lock(:lock_id)"),
            {"lock_id": PROVIDER_REFRESH_LOCK_ID},
        ).scalar())
        connection.commit()
        if not acquired:
            yield None
            return

        database_session = SessionLocal(bind=connection)
        try:
            yield database_session
        finally:
            database_session.rollback()
            database_session.close()
            connection.execute(
                text("SELECT pg_advisory_unlock(:lock_id)"),
                {"lock_id": PROVIDER_REFRESH_LOCK_ID},
            )
            connection.commit()


def refresh_providers_once(label: str) -> bool:
    """Run one isolated provider refresh and report whether it was attempted."""

    if restore_in_progress():
        logger.info("Skipping %s GPS refresh while a database restore is active.", label)
        return False
    if not provider_polling_configured():
        logger.info("Skipping %s GPS refresh because no pull provider is configured.", label)
        return False

    try:
        with _provider_session() as database_session:
            if database_session is None:
                logger.warning("Skipping %s GPS refresh because another worker owns the lock.", label)
                return False
            result = refresh_gps_providers(database_session)
        live_trip_updates = sum(
            1
            for item in result["updated"]
            if isinstance(item, dict) and item.get("active_trip_id") is not None
        )
        logger.info(
            "GPS providers %s: %s updated, %s live trips updated, %s errors, %s skipped.",
            label,
            len(result["updated"]),
            live_trip_updates,
            len(result["errors"]),
            len(result["skipped"]),
        )
        return True
    except Exception:
        logger.exception("GPS providers %s refresh failed.", label)
        return False


def _run_transaction(label: str, operation: Callable[[Session], object]) -> bool:
    """Keep one maintenance failure from suppressing the other duties."""

    if restore_in_progress():
        logger.info("Skipping %s while a database restore is active.", label)
        return False
    with SessionLocal() as database_session:
        try:
            result = operation(database_session)
            database_session.commit()
            logger.info("%s completed: %s", label, result)
            return True
        except Exception:
            database_session.rollback()
            logger.exception("%s failed.", label)
            return False


def run_direction_recovery() -> bool:
    return _run_transaction("Daily IST direction recovery", apply_daily_direction)


def run_retention() -> bool:
    if not telemetry_retention_enabled():
        return False
    return _run_transaction("Telemetry retention", run_telemetry_retention)


def run_document_expiry_reminders() -> bool:
    return _run_transaction("Document expiry reminders", run_document_reminders)


def run_peak_worker(
    *,
    now_fn: Callable[[], datetime] | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> int:
    """Poll every ten seconds until the current peak window closes."""

    clock = now_fn or (lambda: datetime.now(timezone.utc))
    window = active_peak_window(clock())
    if window is None:
        logger.info("Peak worker started outside an IST peak window; exiting.")
        return 0

    run_direction_recovery()
    interval = peak_poll_interval_seconds()
    logger.info(
        "Peak GPS worker active until %s at a %s-second interval.",
        window[1].isoformat(),
        interval,
    )
    while True:
        current = as_ist(clock())
        if not (window[0] <= current < window[1]):
            break
        started = time.monotonic()
        refresh_providers_once("peak")
        remaining = (window[1] - as_ist(clock())).total_seconds()
        if remaining <= 0:
            break
        sleep_fn(min(remaining, max(0.0, interval - (time.monotonic() - started))))

    logger.info("Peak GPS window ended; the worker is shutting down.")
    return 0


def run_standby_worker(*, now: datetime | None = None) -> int:
    """Perform one scheduled low-frequency refresh and bounded maintenance."""

    current = now or datetime.now(timezone.utc)
    local = as_ist(current)
    is_midnight_run = midnight_maintenance_due(local)
    is_daytime_run = STANDBY_START <= local.time() < STANDBY_LAST_START
    if not (is_midnight_run or is_daytime_run):
        logger.info("Standby worker started outside its IST schedule; exiting.")
        return 0

    run_direction_recovery()
    run_retention()
    if is_midnight_run:
        run_document_expiry_reminders()
    if standby_refresh_allowed(current):
        refresh_providers_once("standby")
    else:
        logger.info("Standby worker has no provider poll at %s; exiting.", as_ist(current).isoformat())
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one BusTrack scheduled GPS worker.")
    parser.add_argument("--mode", choices=("peak", "standby"), required=True)
    arguments = parser.parse_args(argv)

    validate_database_configuration()
    if arguments.mode == "peak":
        return run_peak_worker()
    return run_standby_worker()


if __name__ == "__main__":
    raise SystemExit(main())
