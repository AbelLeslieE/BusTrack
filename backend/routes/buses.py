"""
Bus Management API

Handles CRUD operations for school buses.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, Driver, Route, Student
from backend.schemas import BusCreate, BusUpdate, BusResponse
from backend.security import require_management
from backend.routes.models_tracking import (
    BusGPSState,
    GPSDeviceMapping,
    GPSIngestToken,
    ProviderGPSPosition,
)

# ======================================================
# BUILD BUS RESPONSE
# ======================================================

def build_bus_response(bus: Bus, db: Session) -> BusResponse:

    driver_name = None

    if bus.driver_id:

        driver = (
            db.query(Driver)
            .filter(Driver.id == bus.driver_id)
            .first()
        )

        if driver and driver.user:

            driver_name = driver.user.full_name

    return BusResponse(

        id=bus.id,

        bus_number=bus.bus_number,
        registration_number=bus.registration_number,
        capacity=bus.capacity,

        manufacturer=bus.manufacturer,
        model=bus.model,
        year=bus.year,

        fuel_type=bus.fuel_type,
        status=bus.status,

        driver_id=bus.driver_id,
        driver_name=driver_name,

        route=bus.route,
        device_id=bus.device_id,

        created_at=bus.created_at,
        updated_at=bus.updated_at,
    )




router = APIRouter(
    prefix="/api/buses",
    tags=["Bus Management"]
)


@router.get("/", response_model=list[BusResponse])
def get_buses(
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):

    buses = db.query(Bus).order_by(Bus.bus_number).all()

    return [

        build_bus_response(bus, db)

        for bus in buses

    ]

@router.post(
    "/",
    response_model=BusResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_bus(
    bus: BusCreate,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """Create a new bus."""

    existing_bus = (
        db.query(Bus)
        .filter(Bus.bus_number == bus.bus_number)
        .first()
    )

    if existing_bus:
        raise HTTPException(
            status_code=400,
            detail="Bus number already exists.",
        )

    existing_registration = (
        db.query(Bus)
        .filter(Bus.registration_number == bus.registration_number)
        .first()
    )

    if existing_registration:
        raise HTTPException(
            status_code=400,
            detail="Registration number already exists.",
        )

    new_bus = Bus(
        bus_number=bus.bus_number,
        registration_number=bus.registration_number,
        capacity=bus.capacity,
        manufacturer=bus.manufacturer,
        model=bus.model,
        year=bus.year,
        fuel_type=bus.fuel_type,
        status=bus.status,
        device_id=bus.device_id,
    )

    db.add(new_bus)
    db.flush()

    
    db.commit()
    db.refresh(new_bus)

    return build_bus_response(new_bus, db)

@router.get("/{bus_id}", response_model=BusResponse)
def get_bus(
    bus_id: int,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """Return a single bus."""

    bus = db.query(Bus).filter(Bus.id == bus_id).first()

    if not bus:
        raise HTTPException(
            status_code=404,
            detail="Bus not found.",
        )
    return build_bus_response(bus, db)

    

@router.put("/{bus_id}", response_model=BusResponse)
def update_bus(
    bus_id: int,
    bus: BusUpdate,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """Update a bus."""

    existing = (
        db.query(Bus)
        .filter(Bus.id == bus_id)
        .first()
    )

    if not existing:
        raise HTTPException(
            status_code=404,
            detail="Bus not found.",
        )

    duplicate_bus = (
        db.query(Bus)
        .filter(
            Bus.bus_number == bus.bus_number,
            Bus.id != bus_id,
        )
        .first()
    )

    if duplicate_bus:
        raise HTTPException(
            status_code=400,
            detail="Bus number already exists.",
        )

    duplicate_registration = (
        db.query(Bus)
        .filter(
            Bus.registration_number == bus.registration_number,
            Bus.id != bus_id,
        )
        .first()
    )

    if duplicate_registration:
        raise HTTPException(
            status_code=400,
            detail="Registration number already exists.",
        )

    existing.bus_number = bus.bus_number
    existing.registration_number = bus.registration_number
    existing.capacity = bus.capacity
    existing.manufacturer = bus.manufacturer
    existing.model = bus.model
    existing.year = bus.year
    existing.fuel_type = bus.fuel_type
    existing.status = bus.status
    existing.device_id = bus.device_id

    db.commit()
    db.refresh(existing)


    return build_bus_response(existing, db)

@router.delete("/{bus_id}")
def delete_bus(
    bus_id: int,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """Delete a bus."""

    bus = (
        db.query(Bus)
        .filter(Bus.id == bus_id)
        .first()
    )

    if not bus:
        raise HTTPException(
            status_code=404,
            detail="Bus not found."
        )

    # Clear every record that points at this bus before deleting it.
    db.query(Route).filter(Route.bus_id == bus.id).update(
        {Route.bus_id: None, Route.driver_id: None}, synchronize_session=False
    )
    db.query(Driver).filter(Driver.bus_id == bus.id).update(
        {Driver.bus_id: None}, synchronize_session=False
    )
    db.query(Student).filter(Student.bus_id == bus.id).update(
        {Student.bus_id: None}, synchronize_session=False
    )
    bus.driver_id = None
    bus.route = None

    # Provider identities and their history belong to the deleted bus. Clear
    # them explicitly because the established schema does not use DB-level
    # cascade rules for bus references.
    db.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).delete(synchronize_session=False)
    db.query(ProviderGPSPosition).filter(ProviderGPSPosition.bus_id == bus.id).delete(synchronize_session=False)
    db.query(GPSDeviceMapping).filter(GPSDeviceMapping.bus_id == bus.id).delete(synchronize_session=False)
    db.query(GPSIngestToken).filter(GPSIngestToken.bus_id == bus.id).delete(synchronize_session=False)

    db.delete(bus)

    db.commit()

    return {
        "message": "Bus deleted successfully."
    }
