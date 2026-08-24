"""Admin management for student transport passes.

Passes never own a bus, route, or stop.  Those values are always resolved from
the existing Student assignment so Admin, Student, and Live Tracking screens
cannot drift apart.
"""

from datetime import date, datetime, timezone
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, BusPass, Route, Student, User
from backend.schemas import BusPassIssue, BusPassUpdate
from backend.security import require_management


router = APIRouter(prefix="/api/bus-passes", tags=["Bus Passes"])


def _one_year_after(start: date) -> date:
    """Return the same calendar day in the next year, safely handling Feb 29."""

    try:
        return start.replace(year=start.year + 1)
    except ValueError:
        return start.replace(year=start.year + 1, month=2, day=28)


def _resolve_valid_until(
    valid_from: date,
    validity_period: str,
    requested_valid_until: date | None,
) -> date:
    """Use the requested expiry when supplied, otherwise apply the selected plan."""

    if requested_valid_until is not None:
        valid_until = requested_valid_until
    elif validity_period == "One Day":
        # A one-day pass starts and ends on the purchased calendar day.
        valid_until = valid_from
    elif validity_period in {"One Year", "Two Semesters"}:
        valid_until = _one_year_after(valid_from)
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose an expiry date for a custom-validity pass.",
        )

    if valid_until < valid_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The expiry date cannot be before the pass start date.",
        )
    return valid_until


def _effective_status(bus_pass: BusPass) -> str:
    stored = (bus_pass.status or "Pending").strip().title()
    if stored == "Active" and bus_pass.valid_until and bus_pass.valid_until < date.today():
        return "Expired"
    if stored == "Active" and bus_pass.valid_from and bus_pass.valid_from > date.today():
        return "Pending"
    return stored


def _assignment(student: Student, db: Session) -> tuple[Route | None, Bus | None]:
    route = student.route or (
        db.query(Route).filter(Route.bus_id == student.bus_id).first()
        if student.bus_id else None
    )
    bus = db.get(Bus, route.bus_id) if route and route.bus_id else (
        student.bus if route is None else None
    )
    return route, bus


def _serialize(student: Student, bus_pass: BusPass | None, db: Session) -> dict:
    route, bus = _assignment(student, db)
    today = date.today()
    effective_status = _effective_status(bus_pass) if bus_pass else None
    days_until_expiry = (
        (bus_pass.valid_until - today).days
        if bus_pass and bus_pass.valid_until else None
    )
    return {
        "student": {
            "id": student.id,
            "name": student.user.full_name if student.user else "Unknown student",
            "student_code": student.student_code,
        },
        "transport": {
            "bus_number": bus.bus_number if bus else None,
            "route_name": route.route_name if route else None,
            "boarding_stop": student.stop.stop_name if student.stop else None,
            "assigned": bool(route and bus),
        },
        "bus_pass": (
            {
                "id": bus_pass.id,
                "pass_number": bus_pass.pass_number,
                "status": bus_pass.status,
                "effective_status": effective_status,
                "valid_from": bus_pass.valid_from,
                "valid_until": bus_pass.valid_until,
                "validity_period": bus_pass.validity_period,
                "academic_year": bus_pass.academic_year,
                "issued_at": bus_pass.issued_at,
                "days_until_expiry": days_until_expiry,
                "expiring_soon": (
                    effective_status == "Active"
                    and days_until_expiry is not None
                    and 0 <= days_until_expiry <= 30
                ),
            }
            if bus_pass else None
        ),
    }


def _issued_pass_number(student: Student, db: Session) -> str:
    """Generate a readable pass number without exposing personal data."""

    for _ in range(10):
        candidate = f"BP-{student.student_code}-{secrets.token_hex(3).upper()}"
        if db.query(BusPass.id).filter(BusPass.pass_number == candidate).first() is None:
            return candidate
    raise HTTPException(status_code=500, detail="Could not generate a unique bus pass number.")


@router.get("")
def list_bus_passes(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_management),
):
    """List every student with their pass and authoritative assignment state."""

    students = db.query(Student).order_by(Student.student_code).all()
    records = [_serialize(student, student.bus_pass, db) for student in students]
    return {
        "records": records,
        "total": len(records),
        "issued": sum(record["bus_pass"] is not None for record in records),
        "expiring_soon": sum(
            bool(record["bus_pass"] and record["bus_pass"]["expiring_soon"])
            for record in records
        ),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def issue_bus_pass(
    payload: BusPassIssue,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_management),
):
    """Issue one yearly/two-semester pass for a centrally assigned student."""

    student = db.get(Student, payload.student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")
    if student.bus_pass is not None:
        raise HTTPException(status_code=409, detail="This student already has a bus pass. Renew or update it instead.")
    route, bus = _assignment(student, db)
    if route is None or bus is None:
        raise HTTPException(
            status_code=400,
            detail="Assign the student to a route with a bus before issuing a pass.",
        )

    bus_pass = BusPass(
        student_id=student.id,
        pass_number=_issued_pass_number(student, db),
        status=payload.status,
        valid_from=payload.valid_from,
        valid_until=_resolve_valid_until(
            payload.valid_from,
            payload.validity_period,
            payload.valid_until,
        ),
        validity_period=payload.validity_period,
        academic_year=payload.academic_year.strip() if payload.academic_year else None,
        issued_at=datetime.now(timezone.utc),
    )
    db.add(bus_pass)
    db.commit()
    db.refresh(bus_pass)
    return _serialize(student, bus_pass, db)


@router.put("/{pass_id:int}")
def update_bus_pass(
    pass_id: int,
    payload: BusPassUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_management),
):
    """Renew a pass from a new start date or change its active/suspended state."""

    bus_pass = db.get(BusPass, pass_id)
    if bus_pass is None:
        raise HTTPException(status_code=404, detail="Bus pass not found.")

    next_valid_from = payload.valid_from or bus_pass.valid_from
    next_validity_period = payload.validity_period or bus_pass.validity_period
    dates_changed = payload.valid_from is not None or payload.valid_until is not None
    if payload.validity_period is not None and payload.validity_period != bus_pass.validity_period:
        dates_changed = True

    if dates_changed:
        if next_valid_from is None:
            raise HTTPException(status_code=422, detail="A pass start date is required.")
        bus_pass.valid_from = next_valid_from
        bus_pass.valid_until = _resolve_valid_until(
            next_valid_from,
            next_validity_period,
            payload.valid_until,
        )
        bus_pass.issued_at = datetime.now(timezone.utc)
    bus_pass.validity_period = next_validity_period
    bus_pass.academic_year = payload.academic_year.strip() if payload.academic_year else None
    bus_pass.status = payload.status

    db.commit()
    db.refresh(bus_pass)
    return _serialize(bus_pass.student, bus_pass, db)


@router.delete("/{pass_id:int}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bus_pass(
    pass_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_management),
):
    """Remove an issued pass without changing the student's bus assignment."""

    bus_pass = db.get(BusPass, pass_id)
    if bus_pass is None:
        raise HTTPException(status_code=404, detail="Bus pass not found.")
    db.delete(bus_pass)
    db.commit()
