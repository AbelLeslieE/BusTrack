"""Contracts for the vendor-to-BusTrack GPS translation boundary."""

from pydantic import BaseModel, Field
from typing import Any


class GPSIngestTokenCreate(BaseModel):
    label: str = Field(min_length=2, max_length=100)
    bus_id: int | None = None


class GPSDeviceMappingCreate(BaseModel):
    bus_id: int
    external_device_id: str = Field(min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=100)


class GPSDeviceMappingUpdate(BaseModel):
    external_device_id: str = Field(min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=100)
    is_active: bool = True


class GPSIngestTokenUpdate(BaseModel):
    is_active: bool


class GPSTranslationConfigUpdate(BaseModel):
    """JSON-path configuration accepted from the Technician workspace."""

    field_paths: dict[str, Any]
