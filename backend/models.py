"""Database models required by the authentication foundation.

TODO: Add fleet, route, student, and tracking models through versioned migrations.
"""

from datetime import datetime, timezone, time

from sqlalchemy import (
    Boolean,
    DateTime,
    Integer,
    String,
    ForeignKey,
    Text,
    Date,
    Time,
)
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)


from backend.database import Base


class User(Base):
    """An authenticated application user; passwords are never stored directly."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="admin", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


class Bus(Base):
    """
    Stores information about every school bus.

    NOTE:
    driver_id and route are temporary fields for the MVP.
    They will later become foreign-key relationships.
    """

    __tablename__ = "buses"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    bus_number: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        nullable=False,
        index=True,
    )

    registration_number: Mapped[str] = mapped_column(
        String(30),
        unique=True,
        nullable=False,
    )

    capacity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    manufacturer: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    model: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    year: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    fuel_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="Active",
        nullable=False,
    )

    driver_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    route: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    device_id: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
class Driver(Base):
    """
    Stores information about every driver.

    NOTE:
    bus_id links the driver to a bus.
    Future versions will also relate drivers to routes and trips.
    """

    __tablename__ = "drivers"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    driver_code: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        nullable=False,
        index=True,
    )

    full_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    phone: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    email: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    license_number: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
    )

    license_expiry: Mapped[datetime.date] = mapped_column(
        Date,
        nullable=False,
    )

    address: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="Available",
        nullable=False,
    )

    bus_id: Mapped[int | None] = mapped_column(
        ForeignKey("buses.id"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


# ==========================================================
# ROUTE MODEL
# ==========================================================

class Route(Base):
    """
    Master table containing every transport route.

    A Route contains general information only.

    Individual bus stops are stored in the Stop table.
    Live GPS information is stored in the LiveTracking table.
    """

    __tablename__ = "routes"

    # ======================================================
    # PRIMARY KEY
    # ======================================================

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    # ======================================================
    # ROUTE INFORMATION
    # ======================================================

    route_code: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        nullable=False,
        index=True,
    )

    route_name: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
    )

    # ======================================================
    # ASSIGNMENTS
    # ======================================================

    bus_id: Mapped[int | None] = mapped_column(
        ForeignKey("buses.id"),
        nullable=True,
    )

    driver_id: Mapped[int | None] = mapped_column(
        ForeignKey("drivers.id"),
        nullable=True,
    )

    # ======================================================
    # SCHEDULE
    # ======================================================

    departure_time: Mapped[time | None] = mapped_column(
        Time,
        nullable=True,
    )

    arrival_time: Mapped[time | None] = mapped_column(
        Time,
        nullable=True,
    )

    # ======================================================
    # STATUS
    # ======================================================

    status: Mapped[str] = mapped_column(
        String(20),
        default="Active",
        nullable=False,
    )

    total_stops: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    # ======================================================
    # RELATIONSHIPS
    # ======================================================

    route_stops = relationship(
        "RouteStop",
        back_populates="route",
        cascade="all, delete-orphan",
    )
    # ======================================================
    # AUDIT
    # ======================================================

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

# ==========================================================
# STOP MASTER MODEL
# ==========================================================

class Stop(Base):
    """
    Master list of all transport stops.

    A stop exists only once and can be used by multiple routes.
    """

    __tablename__ = "stops"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    stop_code: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        nullable=False,
        index=True,
    )

    stop_name: Mapped[str] = mapped_column(
        String(150),
        unique=True,
        nullable=False,
        index=True,
    )

    latitude: Mapped[float | None] = mapped_column(
        nullable=True,
    )

    longitude: Mapped[float | None] = mapped_column(
        nullable=True,
    )

    radius: Mapped[int] = mapped_column(
        Integer,
        default=50,
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="Active",
        nullable=False,
    )
    # ======================================================
    # RELATIONSHIPS
    # ======================================================

    route_stops = relationship(
        "RouteStop",
        back_populates="stop",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
# ==========================================================
# ROUTE STOP MODEL
# ==========================================================

class RouteStop(Base):
    """
    Connects Routes and Stops.

    This stores the ordered sequence of stops
    for each transport route.
    """

    __tablename__ = "route_stops"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id"),
        nullable=False,
        index=True,
    )

    stop_id: Mapped[int] = mapped_column(
        ForeignKey("stops.id"),
        nullable=False,
        index=True,
    )

    sequence: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    scheduled_time: Mapped[str | None] = mapped_column(
        String(10),
        nullable=True,
    )

    fare: Mapped[float | None] = mapped_column(
        nullable=True,
    )

    distance_from_previous: Mapped[float | None] = mapped_column(
        nullable=True,
    )

    estimated_minutes: Mapped[int | None] = mapped_column(
        nullable=True,
    )
    # ======================================================
    # RELATIONSHIPS
    # ======================================================

    route = relationship(
        "Route",
        back_populates="route_stops",
    )

    stop = relationship(
        "Stop",
        back_populates="route_stops",
)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )