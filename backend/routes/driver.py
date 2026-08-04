"""
Driver Management API

Handles CRUD operations for school bus drivers.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Driver, Bus
from backend.schemas import (
    DriverCreate,
    DriverUpdate,
    DriverResponse,
)

router = APIRouter(
    prefix="/api/drivers",
    tags=["Driver Management"],
)


@router.get("/", response_model=list[DriverResponse])
def get_drivers(db: Session = Depends(get_db)):
    """Return all drivers."""
    return db.query(Driver).order_by(Driver.driver_code).all()


@router.post(
    "/",
    response_model=DriverResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_driver(
    driver: DriverCreate,
    db: Session = Depends(get_db),
):
    """Create a new driver."""

    existing_driver = (
        db.query(Driver)
        .filter(Driver.driver_code == driver.driver_code)
        .first()
    )

    if existing_driver:
        raise HTTPException(
            status_code=400,
            detail="Driver code already exists.",
        )

    existing_license = (
        db.query(Driver)
        .filter(Driver.license_number == driver.license_number)
        .first()
    )

    if existing_license:
        raise HTTPException(
            status_code=400,
            detail="License number already exists.",
        )

    if driver.bus_id is not None:
        bus = (
            db.query(Bus)
            .filter(Bus.id == driver.bus_id)
            .first()
        )

        if not bus:
            raise HTTPException(
                status_code=400,
                detail="Assigned bus does not exist.",
            )

    new_driver = Driver(**driver.model_dump())

    db.add(new_driver)
    db.commit()
    db.refresh(new_driver)

    return new_driver


@router.get("/{driver_id}", response_model=DriverResponse)
def get_driver(
    driver_id: int,
    db: Session = Depends(get_db),
):
    """Return a single driver."""

    driver = (
        db.query(Driver)
        .filter(Driver.id == driver_id)
        .first()
    )

    if not driver:
        raise HTTPException(
            status_code=404,
            detail="Driver not found.",
        )

    return driver


@router.put("/{driver_id}", response_model=DriverResponse)
def update_driver(
    driver_id: int,
    driver: DriverUpdate,
    db: Session = Depends(get_db),
):
    """Update a driver."""

    existing = (
        db.query(Driver)
        .filter(Driver.id == driver_id)
        .first()
    )

    if not existing:
        raise HTTPException(
            status_code=404,
            detail="Driver not found.",
        )

    duplicate_driver = (
        db.query(Driver)
        .filter(
            Driver.driver_code == driver.driver_code,
            Driver.id != driver_id,
        )
        .first()
    )

    if duplicate_driver:
        raise HTTPException(
            status_code=400,
            detail="Driver code already exists.",
        )

    duplicate_license = (
        db.query(Driver)
        .filter(
            Driver.license_number == driver.license_number,
            Driver.id != driver_id,
        )
        .first()
    )

    if duplicate_license:
        raise HTTPException(
            status_code=400,
            detail="License number already exists.",
        )

    if driver.bus_id is not None:
        bus = (
            db.query(Bus)
            .filter(Bus.id == driver.bus_id)
            .first()
        )

        if not bus:
            raise HTTPException(
                status_code=400,
                detail="Assigned bus does not exist.",
            )

    for key, value in driver.model_dump().items():
        setattr(existing, key, value)

    db.commit()
    db.refresh(existing)

    return existing


@router.delete("/{driver_id}")
def delete_driver(
    driver_id: int,
    db: Session = Depends(get_db),
):
    """Delete a driver."""

    driver = (
        db.query(Driver)
        .filter(Driver.id == driver_id)
        .first()
    )

    if not driver:
        raise HTTPException(
            status_code=404,
            detail="Driver not found.",
        )

    db.delete(driver)
    db.commit()

    return {
        "message": "Driver deleted successfully."
    }