from datetime import datetime, date, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserResponse(BaseModel):
    """
    Safe user information returned to the frontend.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str

    email: str | None
    phone: str | None

    role: str
    status: str

    last_login: datetime | None

    created_at: datetime
    updated_at: datetime

    # Included for editing role-specific transport information.
    driver_code: str | None = None
    license_number: str | None = None
    license_expiry: date | None = None
    address: str | None = None
    student_code: str | None = None
    route_id: int | None = None
    bus_id: int | None = None
    stop_id: int | None = None


class TokenResponse(BaseModel):
    """
    Returned after successful authentication.
    """

    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserResponse


class AccountProfileUpdate(BaseModel):
    """Editable identity fields for the authenticated administrator only."""

    full_name: str = Field(min_length=2, max_length=100)
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20, pattern=r"^[0-9+() .-]*$")


class PasswordChangeRequest(BaseModel):
    """Current-password-verified update for an active account session."""

    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=12, max_length=72)
# ==========================================================
# USER SCHEMAS
# ==========================================================

class UserCreate(BaseModel):
    """
    Create a new BusTrack user.
    """

    full_name: str = Field(min_length=2, max_length=100)

    username: str = Field(
        min_length=3,
        max_length=64,
        pattern=r"^[A-Za-z0-9_.-]+$",
    )

    password: str = Field(
        min_length=8,
        max_length=72,
    )

    email: str | None = None

    phone: str | None = None

    role: str

    status: str = "Active"

    # --------------------------------------------------
    # Driver-only fields
    # --------------------------------------------------

    driver_code: str | None = None

    license_number: str | None = None

    license_expiry: date | None = None

    address: str | None = None

    # --------------------------------------------------
    # Student-only fields
    # --------------------------------------------------

    student_code: str | None = None

class UserUpdate(BaseModel):
    """
    Update an existing user.
    """

    full_name: str

    email: str | None = None

    phone: str | None = None

    role: str

    status: str

    # --------------------------------------------------
    # Driver-only fields
    # --------------------------------------------------

    driver_code: str | None = None
    license_number: str | None = None
    license_expiry: date | None = None
    address: str | None = None

    # --------------------------------------------------
    # Student-only fields
    # --------------------------------------------------

    student_code: str | None = None


class RouteAssignmentUpdate(BaseModel):
    """The single workflow for connecting a route, bus, and driver."""

    bus_id: int | None = None
    driver_id: int | None = None


class StudentAssignmentUpdate(BaseModel):
    """Route and boarding-stop assignment managed only from Students."""

    route_id: int | None = None
    stop_id: int | None = None


class UserListResponse(BaseModel):

    model_config = ConfigDict(from_attributes=True)

    id: int

    full_name: str

    username: str

    email: str | None

    phone: str | None

    role: str

    status: str

    last_login: datetime | None

    created_at: datetime







class AdminBootstrapInput(BaseModel):
    """Reserved input contract for a future guarded web-based administrator setup."""

    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=12, max_length=72)


# ==========================================================
# BUS SCHEMAS
# Assignment fields are intentionally NOT accepted here.
# Bus ↔ Route ↔ Driver relationships are managed only
# through the Assignment module.
# ==========================================================

class BusCreate(BaseModel):

    bus_number: str = Field(
        min_length=1,
        max_length=20,
    )

    registration_number: str = Field(
        min_length=1,
        max_length=30,
    )

    capacity: int = Field(
        gt=0,
        le=200,
    )

    manufacturer: str = Field(
        min_length=1,
        max_length=50,
    )

    model: str = Field(
        min_length=1,
        max_length=50,
    )

    year: int = Field(
        ge=1990,
        le=2100,
    )

    fuel_type: str = Field(
        min_length=1,
        max_length=20,
    )

    status: str = "Active"

    device_id: str | None = Field(
        default=None,
        max_length=100,
    )
class BusUpdate(BaseModel):

    bus_number: str = Field(
        min_length=1,
        max_length=20,
    )

    registration_number: str = Field(
        min_length=1,
        max_length=30,
    )

    capacity: int = Field(
        gt=0,
        le=200,
    )

    manufacturer: str = Field(
        min_length=1,
        max_length=50,
    )

    model: str = Field(
        min_length=1,
        max_length=50,
    )

    year: int = Field(
        ge=1990,
        le=2100,
    )

    fuel_type: str = Field(
        min_length=1,
        max_length=20,
    )

    status: str

    device_id: str | None = Field(
        default=None,
        max_length=100,
    )
class BusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int

    bus_number: str
    registration_number: str
    capacity: int

    manufacturer: str
    model: str
    year: int

    fuel_type: str
    status: str

    driver_id: int | None
    driver_name: str | None = None

    route: str | None
    device_id: str | None

    created_at: datetime
    updated_at: datetime
# ==========================================================
# DRIVER SCHEMAS
# ==========================================================


class DriverUpdate(BaseModel):
    """
    Request body used when updating a driver profile.

    Bus assignment is intentionally excluded.
    Driver ↔ Bus relationships are managed only
    through the Assignment module.
    """

    driver_code: str

    license_number: str

    license_expiry: date

    address: str | None = None

    status: str
class DriverUserResponse(BaseModel):
    """
    User information associated with a driver.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int

    full_name: str

    phone: str | None

    email: str | None



class DriverResponse(BaseModel):
    """
    Driver profile returned to the frontend.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int

    user: DriverUserResponse

    driver_code: str

    license_number: str

    license_expiry: date

    address: str | None

    status: str

    bus_id: int | None

    created_at: datetime

    updated_at: datetime

# ==========================================================
# ROUTE SCHEMAS
# ==========================================================
class RouteCreate(BaseModel):
    """
    Request body used when creating a route.

    Bus and driver assignment are intentionally excluded.
    Assignments are created only through the Assignment module.
    """

    route_code: str = Field(
        min_length=1,
        max_length=20,
    )

    route_name: str = Field(
        min_length=1,
        max_length=100,
    )

    departure_time: time | None = None

    arrival_time: time | None = None

    status: str = "Active"
class RouteUpdate(BaseModel):
    """
    Request body used when editing route information.

    Bus and driver assignment are intentionally excluded.
    """

    route_code: str = Field(
        min_length=1,
        max_length=20,
    )

    route_name: str = Field(
        min_length=1,
        max_length=100,
    )

    departure_time: time | None = None

    arrival_time: time | None = None

    status: str

class RouteResponse(BaseModel):

    model_config = ConfigDict(from_attributes=True)

    id: int

    route_code: str
    route_name: str

    bus_id: int | None
    bus_number: str | None = None

    driver_id: int | None
    driver_name: str | None = None

    departure_time: time | None
    arrival_time: time | None

    status: str

    total_stops: int

    created_at: datetime
    updated_at: datetime
# ==========================================================
# STOP SCHEMAS
# ==========================================================

class StopCreate(BaseModel):
    """
    Create a master stop.

    Stops are reusable across multiple routes.
    """

    stop_code: str = Field(
        min_length=1,
        max_length=20,
    )

    stop_name: str = Field(
        min_length=1,
        max_length=150,
    )

    latitude: float | None = None

    longitude: float | None = None

    radius: int = Field(
        default=50,
        ge=10,
        le=500,
    )

    status: str = "Active"


class StopUpdate(BaseModel):
    """
    Update a master stop.
    """

    stop_code: str

    stop_name: str

    latitude: float | None = None

    longitude: float | None = None

    radius: int

    status: str


class StopResponse(BaseModel):

    id: int

    stop_code: str

    stop_name: str

    latitude: float | None

    longitude: float | None

    radius: int

    status: str

    created_at: datetime

    updated_at: datetime

    model_config = ConfigDict(
        from_attributes=True,
    )
# ==========================================================
# ROUTE STOP SCHEMAS
# ==========================================================

class RouteStopCreate(BaseModel):
    """
    Add an existing stop to a route.
    """

    stop_id: int

    scheduled_time: str | None = None

    fare: float | None = Field(
        default=None,
        ge=0,
    )

    distance_from_previous: float | None = Field(
        default=None,
        ge=0,
    )

    estimated_minutes: int | None = Field(
        default=None,
        ge=0,
    )
class RouteStopUpdate(BaseModel):

    sequence: int

    scheduled_time: str | None = None

    fare: float | None = None

    distance_from_previous: float | None = None

    estimated_minutes: int | None = None


class RouteStopResponse(BaseModel):

    id: int

    route_id: int

    stop_id: int

    stop_name: str

    stop_code: str

    # These belong to the referenced master stop. They are included here so
    # route views and road routing never need a second lookup per stop.
    latitude: float | None = None

    longitude: float | None = None

    radius: int | None = None

    sequence: int

    scheduled_time: str | None

    fare: float | None

    distance_from_previous: float | None

    estimated_minutes: int | None

    model_config = ConfigDict(
        from_attributes=True,
    )


class RouteStopReorder(BaseModel):
    """
    Used for drag-and-drop or move up/down operations.
    """

    stop_ids: list[int]
class StopImport(BaseModel):
    """
    Represents one row parsed from the Excel sheet
    before being inserted into the database.
    """

    route_name: str

    stop_name: str

    sequence: int

    scheduled_time: str | None = None

    bus_name: str | None = None


class NotificationFeedbackCreate(BaseModel):
    """Driver feedback raised from the live-trip controls."""

    feedback_type: Literal[
        "traffic",
        "breakdown",
        "accident",
        "medical",
        "delay",
        "other",
    ]
    message: str | None = Field(default=None, max_length=500)


class NotificationStatusUpdate(BaseModel):
    """Management workflow state for an operational notification."""

    status: Literal["Open", "Acknowledged", "Resolved"]
