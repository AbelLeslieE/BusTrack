"""
Bus Management API

Handles CRUD operations for school buses.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, Driver
from backend.schemas import BusCreate, BusUpdate, BusResponse

router = APIRouter(
    prefix="/api/buses",
    tags=["Bus Management"]
)


@router.get("/", response_model=list[BusResponse])
def get_buses(db: Session = Depends(get_db)):
    """Return all buses."""
    return db.query(Bus).order_by(Bus.bus_number).all()


@router.post(
    "/",
    response_model=BusResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_bus(
    bus: BusCreate,
    db: Session = Depends(get_db),
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
        route=bus.route,
        device_id=bus.device_id,
    )

    db.add(new_bus)
    db.flush()

    
    # ------------------------------------------------------
    # Assign Driver
    # ------------------------------------------------------

    if bus.driver_id is not None:

        driver = (
            db.query(Driver)
            .filter(Driver.id == bus.driver_id)
            .first()
        )

        if driver is None:
            raise HTTPException(
                status_code=400,
                detail="Driver not found.",
            )

        driver.bus_id = new_bus.id

    db.commit()
    db.refresh(new_bus)

    return new_bus

@router.get("/{bus_id}", response_model=BusResponse)
def get_bus(
    bus_id: int,
    db: Session = Depends(get_db),
):
    """Return a single bus."""

    bus = db.query(Bus).filter(Bus.id == bus_id).first()

    if not bus:
        raise HTTPException(
            status_code=404,
            detail="Bus not found.",
        )
    return bus

    

@router.put("/{bus_id}", response_model=BusResponse)
def update_bus(
    bus_id: int,
    bus: BusUpdate,
    db: Session = Depends(get_db),
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
    existing.route = bus.route
    existing.device_id = bus.device_id

    db.commit()
    db.refresh(existing)

    return existing

@router.delete("/{bus_id}")
def delete_bus(
    bus_id: int,
    db: Session = Depends(get_db),
):
    """Delete a bus."""

    bus = db.query(Bus).filter(Bus.id == bus_id).first()

    if not bus:
        raise HTTPException(
            status_code=404,
            detail="Bus not found.",
        )

    db.delete(bus)
    db.commit()

    return {
        "message": "Bus deleted successfully."
    }