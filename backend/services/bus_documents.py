"""Expiry calculations and durable reminders independent of GPS processing."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from backend.models import Bus, FleetNotification
from backend.models_documents import BusDocument, BusDocumentReminder

DOCUMENT_TYPES = {
    "rc": "Registration Certificate / RC",
    "fitness": "Fitness Certificate",
    "insurance": "Motor Insurance",
    "permit": "Vehicle Permit",
    "puc": "Pollution Under Control / PUC",
    "tax": "Motor Vehicle Tax",
    "fire_extinguisher": "Fire Extinguisher Servicing",
    "first_aid": "First Aid Inspection",
}


def compliance_today():
    # Fleet dates are calendar dates in India, independent of server timezone.
    return datetime.now(timezone(timedelta(hours=5, minutes=30))).date()


def document_status(document, today=None):
    if document is None:
        return "NOT_ADDED"
    if document.valid_until is None:
        return "ADDED"
    days = (document.valid_until - (today or compliance_today())).days
    if days < 0:
        return "EXPIRED"
    if days <= 7:
        return "EXPIRING_SOON"
    return "EXPIRING" if days <= 30 else "VALID"


def serialize_document(document, document_type, today=None):
    result = dict(document_type=document_type, label=DOCUMENT_TYPES[document_type],
                  status=document_status(document, today), version=0, has_file=False)
    if document:
        result.update({key: getattr(document, key) for key in (
            "id", "bus_id", "document_number", "issue_date", "valid_from", "valid_until",
            "remarks", "file_name", "version", "updated_at",
        )})
        result["has_file"] = bool(document.file_name)
    return result


def lock_document_writes(db):
    # SQLite has no row locks. An early reserved write lock avoids stale read /
    # upgrade races with renewals. PostgreSQL uses document row locks below.
    if db.bind.dialect.name == "sqlite":
        connection = db.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")


def run_document_reminders(db, today: date | None = None):
    """One transaction, safe to repeat after restart or on multiple workers.

    Catch up within each reminder window; do not send an obsolete 30-day alert
    alongside a 7-day alert. No reminders for missing dates or overdue records.
    The caller commits; failures roll back the reminder and notification together.
    """
    today = today or compliance_today()
    lock_document_writes(db)
    documents = db.scalars(select(BusDocument).where(
        BusDocument.valid_until >= today,
        BusDocument.valid_until <= today + timedelta(days=30),
    ).order_by(BusDocument.id).with_for_update()).all()
    count = 0
    for document in documents:
        days = (document.valid_until - today).days
        stage = "7_DAY" if days <= 7 else "30_DAY"
        existing = db.scalar(select(BusDocumentReminder.id).where(
            BusDocumentReminder.document_id == document.id,
            BusDocumentReminder.expiry_date == document.valid_until,
            BusDocumentReminder.reminder_type == stage,
        ))
        if existing:
            continue
        bus = db.get(Bus, document.bus_id)
        if bus is None:
            continue
        try:
            with db.begin_nested():
                notification = FleetNotification(
                    bus_id=bus.id, feedback_type="document_expiry", status="Open",
                    severity="High" if stage == "7_DAY" else "Medium",
                    title="Document Expiry Reminder",
                    message=f"{bus.bus_number} — {DOCUMENT_TYPES[document.document_type]} "
                            f"expires in {days} days ({document.valid_until.isoformat()}).",
                )
                db.add(notification)
                db.flush()
                db.add(BusDocumentReminder(document_id=document.id, expiry_date=document.valid_until,
                                           reminder_type=stage, notification_id=notification.id))
                db.flush()
            count += 1
        except IntegrityError:
            # Unique database constraint is the final cross-worker dedup guard.
            continue
    return count
