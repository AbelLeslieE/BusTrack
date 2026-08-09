"""
BusTrack
Tracking Schemas
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


# ==========================================================
# START TRIP
# ==========================================================

class TripStartRequest(BaseModel):

    driver_id: int

    bus_id: int

    route_id: int


# ==========================================================
# GPS UPDATE
# ==========================================================

class LocationUpdateRequest(BaseModel):

    trip_id: int

    latitude: float

    longitude: float

    speed: float | None = None

    accuracy: float | None = None


# ==========================================================
# STOP TRIP
# ==========================================================

class TripStopRequest(BaseModel):

    trip_id: int


# ==========================================================
# LIVE LOCATION RESPONSE
# ==========================================================

class LiveLocationResponse(BaseModel):

    model_config = ConfigDict(from_attributes=True)

    latitude: float

    longitude: float

    speed: float | None

    accuracy: float | None

    recorded_at: datetime



# ==========================================================
# LIVE TRIP RESPONSE
# ==========================================================

# ==========================================================
# LIVE TRIP RESPONSE
# ==========================================================

class LiveTripResponse(BaseModel):

    model_config = ConfigDict(from_attributes=True)

    id: int

    driver_id: int

    bus_id: int

    route_id: int

    # Human-readable information
    bus_number: str

    route_name: str

    route_code: str | None = None

    status: str

    started_at: datetime

    ended_at: datetime | None