"""Transactional account deletion across every BusTrack user role."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.models import (
    APIRequestLog,
    AuditEvent,
    Bus,
    BusPass,
    Driver,
    FleetNotification,
    PassIdentity,
    Route,
    Student,
    User,
    UserSession,
)
from backend.models_documents import BusDocument
from backend.models_route_studio import TraceSession, TracerAssignment
from backend.routes.models_tracking import (
    GPSProviderTranslationConfig,
    LiveTrip,
)


USER_ACCOUNT_WRITE_LOCK = 0x42555355534552  # Stable PostgreSQL advisory key: "BUSUSER".


def lock_user_account_writes(db: Session) -> None:
    """Serialize destructive/account-role writes across service instances."""

    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": USER_ACCOUNT_WRITE_LOCK},
        )
    elif dialect == "sqlite":
        # A no-op write promotes SQLite's deferred transaction to a writer.
        db.execute(text("UPDATE users SET id = id WHERE id = -1"))


def _changed(query, values: dict) -> int:
    """Bulk-update without loading an unbounded history into application memory."""

    return int(query.update(values, synchronize_session=False) or 0)


def _deleted(query) -> int:
    """Bulk-delete and return the affected row count."""

    return int(query.delete(synchronize_session=False) or 0)


def delete_user_graph(db: Session, user: User) -> dict[str, int]:
    """Stage a complete account deletion in the caller's current transaction.

    Operational history is preserved but detached from the deleted account.
    Role-owned live state is removed in dependency order.  The caller owns the
    commit so the account and every linked change succeed or roll back together.
    """

    user_id = user.id
    counts: dict[str, int] = {}

    # Preserve immutable audit/request history while removing its foreign-key
    # dependency. Explicit updates also support databases created before their
    # ON DELETE SET NULL constraints were introduced.
    counts["audit_events_detached"] = _changed(
        db.query(AuditEvent).filter(AuditEvent.actor_user_id == user_id),
        {AuditEvent.actor_user_id: None},
    )
    counts["request_logs_detached"] = _changed(
        db.query(APIRequestLog).filter(APIRequestLog.actor_user_id == user_id),
        {APIRequestLog.actor_user_id: None},
    )
    counts["documents_detached"] = _changed(
        db.query(BusDocument).filter(BusDocument.updated_by == user_id),
        {BusDocument.updated_by: None},
    )
    counts["notifications_detached"] = _changed(
        db.query(FleetNotification).filter(FleetNotification.acknowledged_by == user_id),
        {FleetNotification.acknowledged_by: None},
    )
    counts["trip_endings_detached"] = _changed(
        db.query(LiveTrip).filter(LiveTrip.ended_by_user_id == user_id),
        {LiveTrip.ended_by_user_id: None},
    )
    counts["gps_settings_detached"] = _changed(
        db.query(GPSProviderTranslationConfig).filter(
            GPSProviderTranslationConfig.updated_by_user_id == user_id
        ),
        {GPSProviderTranslationConfig.updated_by_user_id: None},
    )
    counts["sessions_deleted"] = _deleted(
        db.query(UserSession).filter(UserSession.user_id == user_id)
    )

    # A deleted tracer must no longer be assigned to a bus. Completed traces
    # stay available for route maintenance; unfinished traces are closed so
    # they cannot remain permanently RECORDING under a nonexistent account.
    counts["tracer_assignments_deleted"] = _deleted(
        db.query(TracerAssignment).filter(TracerAssignment.user_id == user_id)
    )
    counts["active_traces_closed"] = _changed(
        db.query(TraceSession).filter(
            TraceSession.user_id == user_id,
            TraceSession.status.in_(["RECORDING", "PAUSED"]),
        ),
        {TraceSession.status: "DISCARDED", TraceSession.ended_at: datetime.now(timezone.utc)},
    )

    driver = db.query(Driver).filter(Driver.user_id == user_id).first()
    if driver is not None:
        driver_id = driver.id
        counts["routes_detached"] = _changed(
            db.query(Route).filter(Route.driver_id == driver_id),
            {Route.driver_id: None},
        )
        counts["buses_detached"] = _changed(
            db.query(Bus).filter(Bus.driver_id == driver_id),
            {Bus.driver_id: None},
        )

        # Trips are fleet history, not account-owned data. Detaching the
        # nullable driver reference is both faster for large telemetry tables
        # and preserves route progress/history after the login is removed.
        counts["live_trips_detached"] = _changed(
            db.query(LiveTrip).filter(LiveTrip.driver_id == driver_id),
            {LiveTrip.driver_id: None},
        )
        counts["driver_notifications_detached"] = _changed(
            db.query(FleetNotification).filter(FleetNotification.driver_id == driver_id),
            {FleetNotification.driver_id: None},
        )
        driver.bus_id = None
        db.flush()
        db.delete(driver)
        counts["driver_profiles_deleted"] = 1

    student = db.query(Student).filter(Student.user_id == user_id).first()
    if student is not None:
        student_id = student.id
        counts["pass_identities_deleted"] = _deleted(
            db.query(PassIdentity).filter(PassIdentity.student_id == student_id)
        )
        counts["bus_passes_deleted"] = _deleted(
            db.query(BusPass).filter(BusPass.student_id == student_id)
        )
        db.delete(student)
        counts["student_profiles_deleted"] = 1

    # Flush role profiles before removing their required users.id parent.
    db.flush()
    db.delete(user)
    db.flush()
    counts["users_deleted"] = 1
    return counts
