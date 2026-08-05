"""
User Management API.

Handles CRUD operations for BusTrack users.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from backend.auth import normalize_username
from backend.database import get_db
from backend.models import User, Driver, Bus
from backend.schemas import (
    UserCreate,
    UserUpdate,
    UserResponse,
    UserListResponse,
)
from backend.auth import get_password_hash

router = APIRouter(
    prefix="/api/users",
    tags=["Users"],
)

# ==========================================================
# CONSTANTS
# ==========================================================

ALLOWED_ROLES = {
    "Administrator",
    "Driver",
    "Student",
    "Transport Manager",
    "Dispatcher",
    "Technician",
}

ALLOWED_STATUS = {
    "Active",
    "Inactive",
    "Locked",
}

@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    request: Request,
    user: UserCreate,
    db: Session = Depends(get_db),
):

    print("\n========== USER CREATE ==========")
    print(await request.json())
    print("=================================\n")

    # ------------------------------------------------------
    # Validate Role
    # ------------------------------------------------------

    if user.role not in ALLOWED_ROLES:
        raise HTTPException(
            status_code=400,
            detail="Invalid role.",
        )

    # ------------------------------------------------------
    # Validate Status
    # ------------------------------------------------------

    if user.status not in ALLOWED_STATUS:
        raise HTTPException(
            status_code=400,
            detail="Invalid status.",
        )

    # ------------------------------------------------------
    # Username Already Exists?
    # ------------------------------------------------------

    existing_user = (
        db.query(User)
        .filter(User.username == user.username)
        .first()
    )

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username already exists.",
        )

    # --------------------------------------------
    # Check duplicate license number
    # --------------------------------------------

    existing_license = (
        db.query(Driver)
        .filter(
            Driver.license_number == user.license_number
        )
        .first()
    )

    if existing_license:
        raise HTTPException(
            status_code=400,
            detail="License number already exists."
        )
    # ------------------------------------------------------
    # Email Already Exists?
    # ------------------------------------------------------

    if user.email:

        existing_email = (
            db.query(User)
            .filter(User.email == user.email)
            .first()
        )

        if existing_email:
            raise HTTPException(
                status_code=400,
                detail="Email already exists.",
            )

    # ------------------------------------------------------
    # Create User
    # ------------------------------------------------------

    new_user = User(
        full_name=user.full_name,
        username=normalize_username(user.username),
        password_hash=get_password_hash(user.password),

        email=user.email or None,
        phone=user.phone or None,

        role=user.role,
        status=user.status,
    )
    try:

        db.add(new_user)
        db.flush()

        # ------------------------------------------------------
        # Automatically create Driver profile
        # ------------------------------------------------------

        # ------------------------------------------------------
        # Automatically create Driver profile
        # ------------------------------------------------------

        if new_user.role == "Driver":

            # --------------------------------------------
            # Validate driver details
            # --------------------------------------------

            if not user.driver_code:
                raise HTTPException(
                    status_code=400,
                    detail="Driver Code is required."
                )

            if not user.license_number:
                raise HTTPException(
                    status_code=400,
                    detail="License Number is required."
                )

            if not user.license_expiry:
                raise HTTPException(
                    status_code=400,
                    detail="License Expiry is required."
                )

            # --------------------------------------------
            # Check duplicate driver code
            # --------------------------------------------

            existing_driver = (
                db.query(Driver)
                .filter(
                    Driver.driver_code == user.driver_code
                )
                .first()
            )

            if existing_driver:
                raise HTTPException(
                    status_code=400,
                    detail="Driver code already exists."
                )

            driver = Driver(
                user_id=new_user.id,
                driver_code=user.driver_code,
                license_number=user.license_number,
                license_expiry=user.license_expiry,
                address=user.address,
                bus_id=user.bus_id,
                status="Available",
            )

            db.add(driver)

        db.commit()
        db.refresh(new_user)

    except Exception:
        db.rollback()
        raise

    return new_user
@router.get(
    "",
    response_model=list[UserListResponse],
)
def get_users(
    db: Session = Depends(get_db),
):

    return (
        db.query(User)
        .order_by(User.created_at.desc())
        .all()
    )
@router.get(
    "/{user_id}",
    response_model=UserResponse,
)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
):

    user = db.get(User, user_id)

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    return user
@router.put(
    "/{user_id}",
    response_model=UserResponse,
)
def update_user(
    user_id: int,
    updated_user: UserUpdate,
    db: Session = Depends(get_db),
):

    user = db.get(User, user_id)

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    if updated_user.role not in ALLOWED_ROLES:
        raise HTTPException(
            status_code=400,
            detail="Invalid role.",
        )

    if updated_user.status not in ALLOWED_STATUS:
        raise HTTPException(
            status_code=400,
            detail="Invalid status.",
        )

    user.full_name = updated_user.full_name
    user.email = updated_user.email or None
    user.phone = updated_user.phone or None
    user.role = updated_user.role
    user.status = updated_user.status

    db.commit()
    db.refresh(user)

    return user
@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
):

    user = db.get(User, user_id)

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    # ---------------------------------------
    # Delete Driver Profile (if exists)
    # ---------------------------------------

    driver = (
        db.query(Driver)
        .filter(Driver.user_id == user.id)
        .first()
    )

    if driver:
        db.delete(driver)

    # ---------------------------------------
    # Delete User
    # ---------------------------------------

    db.delete(user)

    db.commit()