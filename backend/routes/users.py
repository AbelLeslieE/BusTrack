"""
User Management API.

Handles CRUD operations for BusTrack users.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

from backend.auth import (
    normalize_username,
    get_password_hash,
)
from backend.database import get_db
from backend.models import (
    User,
    Driver,
    Bus,
    Student,
    Stop,
    Route,
    RouteStop,
)
from backend.schemas import (
    UserCreate,
    UserUpdate,
    UserResponse,
    UserListResponse,
)


# ==========================================================
# ROUTER
# ==========================================================

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


# ==========================================================
# CREATE USER
# ==========================================================

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
    """
    Create a BusTrack user.

    Driver accounts automatically receive a Driver profile.
    Student accounts automatically receive a Student profile.
    """

    print("\n========== USER CREATE ==========")
    print(await request.json())
    print("=================================\n")


    # ======================================================
    # VALIDATE ROLE
    # ======================================================

    if user.role not in ALLOWED_ROLES:

        raise HTTPException(
            status_code=400,
            detail="Invalid role.",
        )


    # ======================================================
    # VALIDATE STATUS
    # ======================================================

    if user.status not in ALLOWED_STATUS:

        raise HTTPException(
            status_code=400,
            detail="Invalid status.",
        )


    # ======================================================
    # NORMALIZE USERNAME
    # ======================================================

    normalized_username = normalize_username(
        user.username
    )


    # ======================================================
    # USERNAME ALREADY EXISTS?
    # ======================================================

    existing_user = (
        db.query(User)
        .filter(
            User.username == normalized_username
        )
        .first()
    )

    if existing_user:

        raise HTTPException(
            status_code=400,
            detail="Username already exists.",
        )


    # ======================================================
    # DRIVER-SPECIFIC VALIDATION
    # ======================================================

    if user.role == "Driver":

        # --------------------------------------------------
        # License number is required for drivers
        # --------------------------------------------------

        if not user.license_number:

            raise HTTPException(
                status_code=400,
                detail="License Number is required.",
            )


        # --------------------------------------------------
        # Check duplicate license number
        # --------------------------------------------------

        existing_license = (
            db.query(Driver)
            .filter(
                Driver.license_number
                == user.license_number
            )
            .first()
        )

        if existing_license:

            raise HTTPException(
                status_code=400,
                detail="License number already exists.",
            )


    # ======================================================
    # EMAIL ALREADY EXISTS?
    # ======================================================

    if user.email:

        existing_email = (
            db.query(User)
            .filter(
                User.email == user.email
            )
            .first()
        )

        if existing_email:

            raise HTTPException(
                status_code=400,
                detail="Email already exists.",
            )


    # ======================================================
    # CREATE USER
    # ======================================================

    new_user = User(

        full_name=user.full_name,

        username=normalized_username,

        password_hash=get_password_hash(
            user.password
        ),

        email=user.email or None,

        phone=user.phone or None,

        role=user.role,

        status=user.status,
    )


    try:

        db.add(new_user)

        # --------------------------------------------------
        # Generate User ID before creating related profile
        # --------------------------------------------------

        db.flush()


        # ==================================================
        # CREATE DRIVER PROFILE
        # ==================================================

        if new_user.role == "Driver":

            # ----------------------------------------------
            # Validate driver code
            # ----------------------------------------------

            if not user.driver_code:

                raise HTTPException(
                    status_code=400,
                    detail="Driver Code is required.",
                )


            # ----------------------------------------------
            # Validate license number
            # ----------------------------------------------

            if not user.license_number:

                raise HTTPException(
                    status_code=400,
                    detail="License Number is required.",
                )


            # ----------------------------------------------
            # Validate license expiry
            # ----------------------------------------------

            if not user.license_expiry:

                raise HTTPException(
                    status_code=400,
                    detail="License Expiry is required.",
                )


            # ----------------------------------------------
            # Check duplicate driver code
            # ----------------------------------------------

            existing_driver = (
                db.query(Driver)
                .filter(
                    Driver.driver_code
                    == user.driver_code
                )
                .first()
            )

            if existing_driver:

                raise HTTPException(
                    status_code=400,
                    detail="Driver code already exists.",
                )


            # ----------------------------------------------
            # Create Driver profile
            # ----------------------------------------------

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


        # ==================================================
        # CREATE STUDENT PROFILE
        # ==================================================

        if new_user.role == "Student":

            # ----------------------------------------------
            # Student code is required
            # ----------------------------------------------

            if not user.student_code:

                raise HTTPException(
                    status_code=400,
                    detail="Student Code is required.",
                )


            # ----------------------------------------------
            # Check duplicate student code
            # ----------------------------------------------

            existing_student = (
                db.query(Student)
                .filter(
                    Student.student_code
                    == user.student_code
                )
                .first()
            )

            if existing_student:

                raise HTTPException(
                    status_code=400,
                    detail="Student code already exists.",
                )


            # ----------------------------------------------
            # Validate assigned bus
            # ----------------------------------------------

            assigned_bus = None

            if user.bus_id is not None:

                assigned_bus = (
                    db.query(Bus)
                    .filter(
                        Bus.id == user.bus_id
                    )
                    .first()
                )

                if assigned_bus is None:

                    raise HTTPException(
                        status_code=400,
                        detail="Assigned bus not found.",
                    )


            # ----------------------------------------------
            # Validate assigned boarding stop
            # ----------------------------------------------

            if user.stop_id is not None:

                # A boarding stop cannot be assigned
                # without an assigned bus.

                if assigned_bus is None:

                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "A bus must be assigned "
                            "before selecting a boarding stop."
                        ),
                    )


                # ------------------------------------------
                # Check that the stop exists
                # ------------------------------------------

                assigned_stop = (
                    db.query(Stop)
                    .filter(
                        Stop.id == user.stop_id
                    )
                    .first()
                )

                if assigned_stop is None:

                    raise HTTPException(
                        status_code=400,
                        detail="Boarding stop not found.",
                    )


                # ------------------------------------------
                # Find the route assigned to the bus
                # ------------------------------------------

                assigned_route = (
                    db.query(Route)
                    .filter(
                        Route.bus_id
                        == assigned_bus.id
                    )
                    .first()
                )

                if assigned_route is None:

                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "The selected bus "
                            "has no route assigned."
                        ),
                    )


                # ------------------------------------------
                # Verify that the stop belongs
                # to the selected bus route
                # ------------------------------------------

                route_stop = (
                    db.query(RouteStop)
                    .filter(
                        RouteStop.route_id
                        == assigned_route.id,

                        RouteStop.stop_id
                        == assigned_stop.id,
                    )
                    .first()
                )

                if route_stop is None:

                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "The selected boarding stop "
                            "does not belong to the "
                            "selected bus route."
                        ),
                    )


            # ----------------------------------------------
            # Create Student profile
            # ----------------------------------------------

            student = Student(

                user_id=new_user.id,

                student_code=user.student_code,

                bus_id=user.bus_id,

                stop_id=user.stop_id,

            )

            db.add(student)

        # ==================================================
        # COMMIT
        # ==================================================

        db.commit()

        db.refresh(new_user)


    except Exception:

        db.rollback()

        raise


    return new_user

# ==========================================================
# GET ALL USERS
# ==========================================================

@router.get(
    "",
    response_model=list[UserListResponse],
)
def get_users(
    db: Session = Depends(get_db),
):

    return (
        db.query(User)
        .order_by(
            User.created_at.desc()
        )
        .all()
    )


# ==========================================================
# GET USER
# ==========================================================

@router.get(
    "/{user_id}",
    response_model=UserResponse,
)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
):

    user = db.get(
        User,
        user_id,
    )

    if user is None:

        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    return user


# ==========================================================
# UPDATE USER
# ==========================================================

@router.put(
    "/{user_id}",
    response_model=UserResponse,
)
def update_user(
    user_id: int,
    updated_user: UserUpdate,
    db: Session = Depends(get_db),
):

    user = db.get(
        User,
        user_id,
    )

    if user is None:

        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )


    # ======================================================
    # VALIDATE ROLE
    # ======================================================

    if updated_user.role not in ALLOWED_ROLES:

        raise HTTPException(
            status_code=400,
            detail="Invalid role.",
        )


    # ======================================================
    # VALIDATE STATUS
    # ======================================================

    if updated_user.status not in ALLOWED_STATUS:

        raise HTTPException(
            status_code=400,
            detail="Invalid status.",
        )


    # ======================================================
    # UPDATE USER
    # ======================================================

    user.full_name = updated_user.full_name

    user.email = (
        updated_user.email
        or None
    )

    user.phone = (
        updated_user.phone
        or None
    )

    user.role = updated_user.role

    user.status = updated_user.status


    # ======================================================
    # SAVE
    # ======================================================

    db.commit()

    db.refresh(user)


    return user


# ==========================================================
# DELETE USER
# ==========================================================

@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
):

    user = db.get(
        User,
        user_id,
    )

    if user is None:

        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )


    # ======================================================
    # DELETE DRIVER PROFILE
    # ======================================================

    driver = (
        db.query(Driver)
        .filter(
            Driver.user_id == user.id
        )
        .first()
    )

    if driver:

        db.delete(driver)


    # ======================================================
    # DELETE STUDENT PROFILE
    # ======================================================

    student = (
        db.query(Student)
        .filter(
            Student.user_id == user.id
        )
        .first()
    )

    if student:

        db.delete(student)


    # ======================================================
    # DELETE USER
    # ======================================================

    db.delete(user)

    db.commit()