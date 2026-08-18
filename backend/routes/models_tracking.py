"""
BusTrack
Tracking Models
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Integer,
    Float,
    String,
    DateTime,
    ForeignKey,
    Text,
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

    # "mobile" is supplied by the driver's browser; "vehicle_gps" comes
    # from the fleet GPS provider.  The latter is authoritative while fresh.
    current_location_source: Mapped[str | None] = mapped_column(
        String(32),
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

    # An administrator can safely recover from an accidentally started trip.
    # Keep who ended it and why so the trip history remains explainable.
    ended_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )

    end_reason: Mapped[str | None] = mapped_column(
        String(300),
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

    source: Mapped[str] = mapped_column(
        String(32),
        default="mobile",
        nullable=False,
    )


# ==========================================================
# EXTERNAL GPS PROVIDER INTEGRATION
# ==========================================================

class GPSIngestToken(Base):
    """Long-lived service or bus-scoped credential for GPS vendor webhooks.

    Only a SHA-256 hash is stored. The plaintext token is returned exactly once
    when an administrator creates it, so a database leak does not disclose a
    credential that can submit vehicle positions.
    """

    __tablename__ = "gps_ingest_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    bus_id: Mapped[int | None] = mapped_column(ForeignKey("buses.id"), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GPSDeviceMapping(Base):
    """Explicit translator mapping from a vendor device identity to a bus."""

    __tablename__ = "gps_device_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bus_id: Mapped[int] = mapped_column(ForeignKey("buses.id"), nullable=False, index=True)
    external_device_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)


class ProviderGPSPosition(Base):
    """Immutable provider telemetry history; raw_payload preserves all fields."""

    __tablename__ = "provider_gps_positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bus_id: Mapped[int] = mapped_column(ForeignKey("buses.id"), nullable=False, index=True)
    device_mapping_id: Mapped[int | None] = mapped_column(ForeignKey("gps_device_mappings.id"), nullable=True, index=True)
    external_device_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    course: Mapped[float | None] = mapped_column(Float, nullable=True)
    altitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    fix_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    ignition: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    motion: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    valid: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    protocol: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_payload: Mapped[str] = mapped_column(Text, nullable=False)


class BusGPSState(Base):
    """Latest translated GPS state for each bus, including off/heartbeat data."""

    __tablename__ = "bus_gps_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bus_id: Mapped[int] = mapped_column(ForeignKey("buses.id"), unique=True, nullable=False, index=True)
    provider_position_id: Mapped[int | None] = mapped_column(ForeignKey("provider_gps_positions.id"), nullable=True)
    external_device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    course: Mapped[float | None] = mapped_column(Float, nullable=True)
    altitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    fix_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    ignition: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    motion: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    valid: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    protocol: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_payload: Mapped[str] = mapped_column(Text, nullable=False)


class GPSProviderTranslationConfig(Base):
    """Technician-managed field paths for a vendor's changing JSON layout."""

    __tablename__ = "gps_provider_translation_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    field_paths_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
