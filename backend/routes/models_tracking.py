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
    Index,
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
    __table_args__ = (
        # The student/admin portals select the newest running trip for a bus.
        # This composite index keeps that lookup fast as GPS history grows.
        Index(
            "ix_live_trips_bus_status_ended_location",
            "bus_id",
            "status",
            "ended_at",
            "last_location_update",
        ),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    # A hardware-owned tracking session belongs to the bus and route even
    # when no driver has been assigned yet. Phone-owned sessions still set
    # this field and retain their existing authorization checks.
    driver_id: Mapped[int | None] = mapped_column(
        ForeignKey("drivers.id"),
        nullable=True,
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

    # The route definition stays in its normal morning order.  A return trip
    # uses ``reverse`` so every consumer can present the same travel order.
    route_direction: Mapped[str] = mapped_column(
        String(16),
        default="forward",
        nullable=False,
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

    # The most recent end-of-line arrival is retained long enough for every
    # portal to announce it and redraw the trip in the return direction.
    terminal_reached_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    terminal_stop_id: Mapped[int | None] = mapped_column(
        Integer,
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
    __table_args__ = (
        Index("ix_live_locations_trip_recorded", "trip_id", "recorded_at"),
    )

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


class TripStopEvent(Base):
    """Immutable arrival/departure record for a stop served during a trip.

    This is the long-term trip audit.  It deliberately stores the stop label
    and route order but no coordinate history, which keeps completed trips
    useful after their live telemetry has expired.
    """

    __tablename__ = "trip_stop_events"
    __table_args__ = (
        Index("ix_trip_stop_events_trip_occurred", "trip_id", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("live_trips.id"), index=True, nullable=False)
    route_stop_id: Mapped[int] = mapped_column(ForeignKey("route_stops.id"), index=True, nullable=False)
    stop_id: Mapped[int] = mapped_column(ForeignKey("stops.id"), index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    stop_code_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    stop_name_snapshot: Mapped[str | None] = mapped_column(String(150), nullable=True)
    route_sequence_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Kept nullable for compatibility with older databases. New events leave
    # these blank; retention clears legacy values when a trip completes.
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    radius_meters: Mapped[float | None] = mapped_column(Float, nullable=True)


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
    __table_args__ = (
        # Vehicle GPS status reads always need the newest device fix for one
        # bus; keep both device and receipt times available for ordering.
        Index(
            "ix_provider_gps_positions_bus_fix_received",
            "bus_id",
            "fix_time",
            "received_at",
        ),
    )

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


class GPSProviderHealthState(Base):
    """Latest provider-contact result for one bus.

    ``BusGPSState`` answers "what is the newest coordinate?" while this table
    answers "is BusTrack successfully reaching the provider right now?".  The
    two clocks must stay separate because a successful poll can still return a
    delayed device fix.
    """

    __tablename__ = "gps_provider_health_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bus_id: Mapped[int] = mapped_column(ForeignKey("buses.id"), unique=True, nullable=False, index=True)
    protocol: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    consecutive_errors: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_source_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


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
