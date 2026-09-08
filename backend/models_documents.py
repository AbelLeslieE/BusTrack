"""Optional bus administration records; never used by the tracking engine."""
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.database import Base


class BusDocument(Base):
    __tablename__ = "bus_documents"
    __table_args__ = (UniqueConstraint("bus_id", "document_type", name="uq_bus_document_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    bus_id: Mapped[int] = mapped_column(ForeignKey("buses.id", ondelete="CASCADE"), index=True)
    document_type: Mapped[str] = mapped_column(String(32))
    document_number: Mapped[str | None] = mapped_column(String(120))
    issue_date: Mapped[date | None] = mapped_column(Date)
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_until: Mapped[date | None] = mapped_column(Date, index=True)
    remarks: Mapped[str | None] = mapped_column(Text)
    file_name: Mapped[str | None] = mapped_column(String(200))
    file_type: Mapped[str | None] = mapped_column(String(40))
    # Database storage survives ephemeral Render filesystems. Metadata reads
    # never load the bounded blob, and downloads require admin authentication.
    file_content: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class BusDocumentReminder(Base):
    __tablename__ = "bus_document_reminders"
    __table_args__ = (UniqueConstraint("document_id", "expiry_date", "reminder_type", name="uq_document_expiry_reminder"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("bus_documents.id", ondelete="CASCADE"), index=True)
    expiry_date: Mapped[date] = mapped_column(Date)
    reminder_type: Mapped[str] = mapped_column(String(16))
    notification_id: Mapped[int | None] = mapped_column(ForeignKey("notifications.id", ondelete="SET NULL"), index=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
