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
    """
    Master user account for BusTrack.

    Every person who logs into BusTrack must first exist here.

    Role-specific information (Driver, Student, etc.) is stored
    in separate profile tables.
    """

    __tablename__ = "users"

    # ======================================================
    # PRIMARY KEY
    # ======================================================

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    # ======================================================
    # ACCOUNT INFORMATION
    # ======================================================

    username: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=False,
    )

    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    # ======================================================
    # PERSONAL INFORMATION
    # ======================================================

    full_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    email: Mapped[str | None] = mapped_column(
        String(100),
        unique=True,
        nullable=True,
    )

    phone: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )

    # ======================================================
    # ROLE
    # ======================================================

    role: Mapped[str] = mapped_column(
        String(32),
        default="Admin",
        nullable=False,
    )

    # ======================================================
    # ACCOUNT STATUS
    # ======================================================

    status: Mapped[str] = mapped_column(
        String(20),
        default="Active",
        nullable=False,
    )

    failed_login_attempts: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Incrementing this value invalidates every previously issued access token
    # for the account (for example, after a password change).
    auth_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    # ======================================================
    # AUDIT
    # ======================================================

    last_login: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
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
    driver = relationship(
        "Driver",
        back_populates="user",
        uselist=False,
    )

    student = relationship(
        "Student",
        back_populates="user",
        uselist=False,
    )

    sessions = relationship(
        "UserSession",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class UserSession(Base):
    """A browser/device login session that can be revoked by an Admin."""

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    client_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)

    user = relationship("User", back_populates="sessions")

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
    driver = relationship(
        "Driver",
        back_populates="bus",
        uselist=False,
    )

class Driver(Base):
    """
    Driver profile.

    Login credentials and personal information are stored in the
    Users table. This table stores only driver-specific information.
    """

    __tablename__ = "drivers"

    # ======================================================
    # PRIMARY KEY
    # ======================================================

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    # ======================================================
    # LINKED USER ACCOUNT
    # ======================================================

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        unique=True,
        nullable=False,
        index=True,
    )

    # ======================================================
    # DRIVER INFORMATION
    # ======================================================

    driver_code: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        nullable=False,
        index=True,
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

    # ======================================================
    # ASSIGNMENTS
    # ======================================================

    bus_id: Mapped[int | None] = mapped_column(
        ForeignKey("buses.id"),
        nullable=True,
    )

    # ======================================================
    # RELATIONSHIPS
    # ======================================================

    user = relationship(
        "User",
        back_populates="driver",
        lazy="joined",
    )
    bus = relationship(
        "Bus",
        back_populates="driver",
        lazy="joined",
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
# STUDENT MODEL
# ==========================================================

class Student(Base):
    """
    Student profile.

    Login credentials and general personal information are
    stored in the Users table.

    This table stores student-specific transport information.
    """

    __tablename__ = "students"

    # ======================================================
    # PRIMARY KEY
    # ======================================================

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    # ======================================================
    # LINKED USER ACCOUNT
    # ======================================================

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        unique=True,
        nullable=False,
        index=True,
    )

    # ======================================================
    # STUDENT INFORMATION
    # ======================================================

    student_code: Mapped[str] = mapped_column(
        String(30),
        unique=True,
        nullable=False,
        index=True,
    )

    # ======================================================
    # TRANSPORT ASSIGNMENT
    # ======================================================

    # A student's chosen route is the authoritative assignment.
    # bus_id is a denormalized mirror that lets student-facing endpoints load
    # their bus efficiently and is refreshed by the Assignment workspace.
    route_id: Mapped[int | None] = mapped_column(
        ForeignKey("routes.id"),
        nullable=True,
        index=True,
    )

    bus_id: Mapped[int | None] = mapped_column(
        ForeignKey("buses.id"),
        nullable=True,
    )

    stop_id: Mapped[int | None] = mapped_column(
        ForeignKey("stops.id"),
        nullable=True,
    )

    # ======================================================
    # RELATIONSHIPS
    # ======================================================

    user = relationship(
        "User",
        back_populates="student",
        lazy="joined",
    )

    bus = relationship(
        "Bus",
        lazy="joined",
    )

    route = relationship(
        "Route",
        lazy="joined",
    )

    stop = relationship(
        "Stop",
        lazy="joined",
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


# ==========================================================
# OPERATIONS NOTIFICATION MODEL
# ==========================================================

class FleetNotification(Base):
    """Persistent operational feedback raised by a driver for management."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    feedback_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(20), default="Medium", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Open", nullable=False, index=True)

    driver_id: Mapped[int | None] = mapped_column(
        ForeignKey("drivers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    bus_id: Mapped[int | None] = mapped_column(
        ForeignKey("buses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    route_id: Mapped[int | None] = mapped_column(
        ForeignKey("routes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    trip_id: Mapped[int | None] = mapped_column(
        ForeignKey("live_trips.id", ondelete="SET NULL"), nullable=True, index=True
    )
    acknowledged_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
