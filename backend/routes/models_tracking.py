"""
BusTrack
Tracking Models
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Integer,
    Float,
    String,
    DateTime,
    ForeignKey,
)

from sqlalchemy.orm import (
    Mapped,
    mapped_column,
)

from backend.database import Base


# ==========================================================
# LIVE TRIP
# ==========================================================

class LiveTrip(Base):

    __tablename__ = "live_trips"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    driver_id: Mapped[int] = mapped_column(
        ForeignKey("drivers.id"),
        nullable=False,
        index=True,
    )

    bus_id: Mapped[int] = mapped_column(
        ForeignKey("buses.id"),
        nullable=False,
        index=True,
    )

    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id"),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="Running",
    )

    # ======================================================
    # CURRENT LIVE POSITION
    # ======================================================

    current_latitude: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    current_longitude: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    current_speed: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    current_accuracy: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    last_location_update: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    # ======================================================
    # ROUTE STOP PROGRESSION
    # ======================================================

    current_route_stop_id: Mapped[int | None] = mapped_column(
        ForeignKey("route_stops.id"),
        nullable=True,
        index=True,
    )

    current_stop_status: Mapped[str] = mapped_column(
        String(20),
        default="Approaching",
    )

    current_stop_arrived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    current_stop_departed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # ======================================================
    # TRIP TIMESTAMPS
    # ======================================================

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


# ==========================================================
# LIVE LOCATION
# ==========================================================

class LiveLocation(Base):

    __tablename__ = "live_locations"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    trip_id: Mapped[int] = mapped_column(
        ForeignKey("live_trips.id"),
        nullable=False,
        index=True,
    )

    latitude: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    longitude: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    speed: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    accuracy: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )