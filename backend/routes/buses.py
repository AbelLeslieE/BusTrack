"""
Bus Management API

Handles CRUD operations for school buses.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus
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

    new_bus = Bus(**bus.model_dump())

    db.add(new_bus)
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

    for key, value in bus.model_dump().items():
        setattr(existing, key, value)

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