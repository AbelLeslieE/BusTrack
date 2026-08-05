"""Pydantic contracts for authentication-related API data.

TODO: Add schemas for fleet modules as each API area is implemented.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from datetime import date, datetime, time 


class TokenResponse(BaseModel):
    """
    Returned after successful authentication.
    """

    access_token: str

    token_type: str = "bearer"

    user: UserResponse

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

    bus_id: int | None = None

class UserUpdate(BaseModel):
    """
    Update an existing user.
    """

    full_name: str

    email: str | None = None

    phone: str | None = None

    role: str

    status: str


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


class BusCreate(BaseModel):
    bus_number: str = Field(min_length=1, max_length=20)
    registration_number: str = Field(min_length=1, max_length=30)
    capacity: int = Field(gt=0, le=200)
    manufacturer: str = Field(min_length=1, max_length=50)
    model: str = Field(min_length=1, max_length=50)
    year: int = Field(ge=1990, le=2100)
    fuel_type: str = Field(min_length=1, max_length=20)

    status: str = "Active"

    driver_id: int | None = None

    route: str | None = Field(
        default=None,
        max_length=100,
    )

    device_id: str | None = Field(
        default=None,
        max_length=100,
    )
class BusUpdate(BaseModel):
    bus_number: str = Field(min_length=1, max_length=20)
    registration_number: str = Field(min_length=1, max_length=30)
    capacity: int = Field(gt=0, le=200)
    manufacturer: str = Field(min_length=1, max_length=50)
    model: str = Field(min_length=1, max_length=50)
    year: int = Field(ge=1990, le=2100)
    fuel_type: str = Field(min_length=1, max_length=20)

    status: str

    driver_id: int | None = None

    route: str | None = Field(
        default=None,
        max_length=100,
    )

    device_id: str | None = Field(
        default=None,
        max_length=100,
    )
class BusResponse(BaseModel):
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
    route: str | None
    device_id: str | None

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True) 
# ==========================================================
# DRIVER SCHEMAS
# ==========================================================


class DriverUpdate(BaseModel):
    """
    Request body used when updating a driver profile.
    """

    driver_code: str

    license_number: str

    license_expiry: date

    address: str | None = None

    status: str

    bus_id: int | None = None
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
    """

    route_code: str = Field(
        min_length=1,
        max_length=20,
    )

    route_name: str = Field(
        min_length=1,
        max_length=100,
    )

    bus_id: int | None = None

    driver_id: int | None = None

    departure_time: time | None = None

    arrival_time: time | None = None

    status: str = "Active"


class RouteUpdate(BaseModel):
    """
    Request body used when updating a route.
    """

    route_code: str = Field(
        min_length=1,
        max_length=20,
    )

    route_name: str = Field(
        min_length=1,
        max_length=100,
    )

    bus_id: int | None = None

    driver_id: int | None = None

    departure_time: time | None = None

    arrival_time: time | None = None

    status: str


class RouteResponse(BaseModel):
    """
    Route returned to the frontend.
    """

    id: int

    route_code: str
    route_name: str

    bus_id: int | None
    driver_id: int | None

    departure_time: time | None
    arrival_time: time | None

    status: str

    total_stops: int

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
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