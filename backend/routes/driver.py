"""
Driver Management API

Handles CRUD operations for school bus drivers.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Driver, Bus, Route
from backend.schemas import (

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

    # Bus assignment is managed centrally in the Assignments workspace.
    for key, value in driver.model_dump(exclude={"bus_id"}).items():
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

    # Remove the driver's central assignment before deleting the profile.
    db.query(Route).filter(Route.driver_id == driver.id).update(
        {Route.driver_id: None}, synchronize_session=False
    )
    db.query(Bus).filter(Bus.driver_id == driver.id).update(
        {Bus.driver_id: None}, synchronize_session=False
    )
    driver.bus_id = None
    db.flush()
    db.delete(driver)
    db.commit()

    return {
        "message": "Driver deleted successfully."
    }
