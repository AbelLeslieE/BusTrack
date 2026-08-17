"""
User Management API.

Handles CRUD operations for BusTrack users.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.auth import (
    normalize_username,
    get_password_hash,
)
from backend.security import require_admin
from backend.roles import ROLE_ADMIN, ROLE_DRIVER, ROLE_TECHNICIAN, ROLE_USER, is_admin_role
from backend.database import get_db
from backend.models import (
    User,
    Driver,
    Bus,
    Student,
    Route,
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
    ROLE_ADMIN,
    ROLE_DRIVER,
    ROLE_TECHNICIAN,
    ROLE_USER,
}

ALLOWED_STATUS = {
    "Active",
    "Inactive",
    "Locked",
}


def build_user_response(user: User, db: Session) -> dict:
    """Return a user plus the profile fields needed by the edit screen."""
    result = {
        "id": user.id, "username": user.username, "full_name": user.full_name,
        "email": user.email, "phone": user.phone, "role": user.role,
        "status": user.status, "last_login": user.last_login,
        "created_at": user.created_at, "updated_at": user.updated_at,
    }
    if user.driver:
        result.update({
            "driver_code": user.driver.driver_code,
            "license_number": user.driver.license_number,
            "license_expiry": user.driver.license_expiry,
            "address": user.driver.address,
            "bus_id": user.driver.bus_id,
        })
    if user.student:
        # route_id is authoritative. The fallback keeps records created before
        # the central Assignment workspace readable until they are next saved.
        route = user.student.route or (
            db.query(Route).filter(Route.bus_id == user.student.bus_id).first()
            if user.student.bus_id else None
        )
        result.update({
            "student_code": user.student.student_code,
            "route_id": route.id if route else None,
            "bus_id": user.student.bus_id,
            "stop_id": user.student.stop_id,
        })
    return result


# ==========================================================
# CREATE USER
# ==========================================================

@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    user: UserCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_admin),
):
    """
    Create a BusTrack user.

    Driver accounts automatically receive a Driver profile.
    User accounts automatically receive a Student transport profile.
    """

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

    if user.role == ROLE_DRIVER:

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

        if new_user.role == ROLE_DRIVER:

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

                bus_id=None,

                status="Available",
            )

            db.add(driver)


        # ==================================================
        # CREATE STUDENT PROFILE
        # ==================================================

        if new_user.role == ROLE_USER:

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


            # Student transport assignment belongs exclusively to the
            # Students workspace. A newly created student starts unassigned.

            student = Student(

                user_id=new_user.id,

                student_code=user.student_code,

                route_id=None,

                bus_id=None,

                stop_id=None,

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


    return build_user_response(new_user, db)

# ==========================================================
# GET ALL USERS
# ==========================================================

@router.get(
    "",
    response_model=list[UserListResponse],
)
def get_users(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_admin),
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
    _current_user: User = Depends(require_admin),
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

    return build_user_response(user, db)


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
    _current_user: User = Depends(require_admin),
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

    if (
        is_admin_role(user.role)
        and (updated_user.role != ROLE_ADMIN or updated_user.status != "Active")
    ):
        active_admins = db.query(User).filter(
            User.status == "Active",
            User.role == ROLE_ADMIN,
        ).count()
        if active_admins <= 1:
            raise HTTPException(status_code=409, detail="At least one active administrator must remain.")


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

    if updated_user.role == ROLE_DRIVER:
        driver = user.driver
        if driver is None:
            raise HTTPException(status_code=400, detail="This user has no driver profile.")
        if not updated_user.driver_code or not updated_user.license_number or not updated_user.license_expiry:
            raise HTTPException(status_code=400, detail="Driver code, license number, and license expiry are required.")
        duplicate_driver_code = db.query(Driver).filter(
            Driver.driver_code == updated_user.driver_code,
            Driver.id != driver.id,
        ).first()
        if duplicate_driver_code:
            raise HTTPException(status_code=400, detail="Driver code already exists.")
        duplicate_license = db.query(Driver).filter(
            Driver.license_number == updated_user.license_number,
            Driver.id != driver.id,
        ).first()
        if duplicate_license:
            raise HTTPException(status_code=400, detail="License number already exists.")
        driver.driver_code = updated_user.driver_code
        driver.license_number = updated_user.license_number
        driver.license_expiry = updated_user.license_expiry
        driver.address = updated_user.address

    if updated_user.role == ROLE_USER:
        student = user.student
        if student is None:
            raise HTTPException(status_code=400, detail="This user has no student profile.")
        if updated_user.student_code:
            student.student_code = updated_user.student_code


    # ======================================================
    # SAVE
    # ======================================================

    db.commit()

    db.refresh(user)


    return build_user_response(user, db)


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
    current_user: User = Depends(require_admin),
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


    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Use account status management instead of deleting your own account.")
    if is_admin_role(user.role):
        active_admins = db.query(User).filter(
            User.status == "Active",
            User.role == ROLE_ADMIN,
        ).count()
        if active_admins <= 1:
            raise HTTPException(status_code=409, detail="The last active administrator cannot be deleted.")

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
        db.query(Route).filter(Route.driver_id == driver.id).update(
            {Route.driver_id: None}, synchronize_session=False
        )

        db.query(Bus).filter(Bus.driver_id == driver.id).update(
            {Bus.driver_id: None}, synchronize_session=False
        )
        driver.bus_id = None
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
