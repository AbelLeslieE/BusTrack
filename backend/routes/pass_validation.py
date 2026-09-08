"""Trusted issuance, scanning, identity enrollment and verification history."""
import base64
from datetime import datetime, timedelta
from io import BytesIO
import json
from uuid import uuid4
import warnings

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import AuditEvent, Bus, BusPass, Driver, PassIdentity, PassVerification, Route, Student
from backend.routes.models_tracking import LiveTrip
from backend.security import require_authenticated, require_management, require_user, normalized_role
from backend.services.pass_credentials import (
    MESSAGES, begin_write, decode_credential, eligibility, identity_data,
    issue_credential, locked_pass, utcnow,
)

router = APIRouter(prefix="/api", tags=["Bus pass authentication"])


class EmptyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signedToken: str = Field(min_length=1, max_length=2048)


class IdentityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    official_name: str = Field(min_length=2, max_length=100)
    department: str = Field(min_length=1, max_length=120)
    photo_base64: str | None = Field(default=None, max_length=700000)


def audit(db, actor, action, student_id, details):
    db.add(AuditEvent(category="bus_pass", action=action, actor_user_id=actor.id,
        actor_username=actor.username, actor_role=actor.role,
        subject_type="student", subject_id=student_id, details_json=json.dumps(details)))


@router.post("/students/me/bus-pass/live-token")
def live_token(payload: EmptyRequest, db: Session = Depends(get_db), actor=Depends(require_user)):
    begin_write(db)
    student = db.query(Student).filter(Student.user_id == actor.id).first()
    bus_pass = db.query(BusPass).filter(BusPass.student_id == student.id).first() if student else None
    if bus_pass:
        bus_pass = locked_pass(db, bus_pass.id)
    state, route, bus, identity = eligibility(bus_pass, db)
    if state != "VALID":
        raise HTTPException(403, MESSAGES[state])
    result = issue_credential(bus_pass, route, bus)
    result["student"] = identity_data(identity, student)
    result["status"] = "ACTIVE"
    db.commit()
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


def scanner_trip(db, actor):
    driver = db.query(Driver).filter(Driver.user_id == actor.id).first()
    if not driver:
        return None, None, None, None
    trips = db.query(LiveTrip).filter(LiveTrip.driver_id == driver.id,
        LiveTrip.status == "Running", LiveTrip.ended_at.is_(None)).limit(2).all()
    if len(trips) != 1:
        return driver, None, None, None
    trip = trips[0]
    route = db.get(Route, trip.route_id)
    bus = db.get(Bus, trip.bus_id)
    # Trip ownership alone is insufficient after Admin reassigns a driver/bus.
    assigned_driver = route.driver_id if route and route.driver_id else (bus.driver_id if bus else None)
    if (not route or not bus or route.bus_id != bus.id or driver.bus_id != bus.id
            or assigned_driver != driver.id or route.status != "Active" or bus.status != "Active"):
        return driver, None, None, None
    return driver, trip, route, bus


@router.post("/driver/bus-pass/verify")
def verify_pass(payload: VerifyRequest, db: Session = Depends(get_db), actor=Depends(require_authenticated)):
    # Read roles from authenticated DB user, never a payload/localStorage role.
    if normalized_role(actor) != "Driver":
        row = PassVerification(id=str(uuid4()), actor_user_id=actor.id, driver_name=actor.full_name,
            scanned_at=utcnow(), result="UNAUTHORIZED_SCANNER", reason=MESSAGES["UNAUTHORIZED_SCANNER"])
        db.add(row); db.commit()
        raise HTTPException(403, MESSAGES["UNAUTHORIZED_SCANNER"])
    state, claims = decode_credential(payload.signedToken)
    begin_write(db)
    bus_pass = locked_pass(db, claims["passId"]) if claims else None
    log_identity = db.get(PassIdentity, bus_pass.student_id) if bus_pass else None
    driver, trip, trip_route, trip_bus = scanner_trip(db, actor)
    identity = route = bus = None
    duplicate = None
    if state == "VALID":
        state, route, bus, identity = eligibility(bus_pass, db)
        if state == "VALID" and (
            claims["studentId"] != bus_pass.student_id or claims["busId"] != bus.id
            or claims["passNumber"] != bus_pass.pass_number
            or claims["routeId"] != route.id or claims["version"] != bus_pass.credential_version
        ):
            state = "ASSIGNMENT_CHANGED"
        if state == "VALID" and not trip:
            state = "NO_ACTIVE_TRIP"
        if state == "VALID":
            duplicate = db.query(PassVerification).filter_by(consumed_token=claims["jti"]).first()
            recent_other_trip = db.query(PassVerification).filter(
                PassVerification.student_id == bus_pass.student_id,
                PassVerification.result == "VALID", PassVerification.trip_id != trip.id,
                PassVerification.scanned_at >= utcnow() - timedelta(seconds=90)).first()
            if (duplicate and (duplicate.trip_id != trip.id or duplicate.actor_user_id != actor.id)) or recent_other_trip:
                state = "REPLAY_SUSPECTED"
            elif bus.id != trip.bus_id:
                state = "WRONG_BUS"
            elif route.id != trip.route_id:
                state = "WRONG_ROUTE"
    now = utcnow()
    # Retry by the same scanner/trip is idempotent, but all current eligibility
    # checks above still run (revocation and expiry can change between retries).
    if state == "VALID" and duplicate:
        row = duplicate
    else:
        row = PassVerification(id=str(uuid4()), actor_user_id=actor.id, driver_name=actor.full_name,
            driver_id=driver.id if driver else None, trip_id=trip.id if trip else None,
            bus_id=trip_bus.id if trip_bus else None, bus_number=trip_bus.bus_number if trip_bus else None,
            route_id=trip_route.id if trip_route else None, route_name=trip_route.route_name if trip_route else None,
            pass_id=bus_pass.id if bus_pass else None, student_id=bus_pass.student_id if bus_pass else None,
            student_name=log_identity.official_name if log_identity else None,
            token_id=claims["jti"] if claims else None,
            consumed_token=claims["jti"] if state == "VALID" else None,
            scanned_at=now, result=state, reason=MESSAGES[state])
        db.add(row)
    result = {"valid": state == "VALID", "status": state, "message": MESSAGES[state],
              "verificationId": row.id, "verifiedAt": now.isoformat(), "duplicate": bool(duplicate and state == "VALID")}
    if state == "VALID":
        result.update(student=identity_data(identity, bus_pass.student),
            bus_pass={"passId": bus_pass.id, "busId": bus.id, "busNumber": bus.bus_number,
                "routeId": route.id, "routeName": route.route_name, "validUntil": bus_pass.valid_until.isoformat()},
            trip={"id": trip.id, "direction": trip.route_direction}, identityCheckRequired=True)
    elif state == "WRONG_BUS":
        result.update(assignedBus=bus.bus_number, currentBus=trip_bus.bus_number)
    db.commit()
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@router.get("/bus-passes/identities/{student_id}")
def get_identity(student_id: int, db: Session = Depends(get_db), actor=Depends(require_management)):
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    identity = db.get(PassIdentity, student_id)
    return {"official_name": identity.official_name if identity else student.user.full_name,
            "department": identity.department if identity else "",
            "photo": "data:image/jpeg;base64," + identity.photo_base64 if identity else None}


@router.put("/bus-passes/identities/{student_id}")
def save_identity(student_id: int, payload: IdentityRequest, db: Session = Depends(get_db), actor=Depends(require_management)):
    photo = None
    if payload.photo_base64:
        try:
            raw = base64.b64decode(payload.photo_base64, validate=True)
            if len(raw) > 500000:
                raise ValueError()
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(raw)) as image:
                    if image.format not in {"JPEG", "PNG", "WEBP"} or image.width * image.height > 16_000_000:
                        raise ValueError()
                    image = ImageOps.exif_transpose(image).convert("RGB")
                    image.thumbnail((640, 640))
                    output = BytesIO(); image.save(output, format="JPEG", quality=85)
                    photo = base64.b64encode(output.getvalue()).decode()
        except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise HTTPException(400, "Upload a valid JPEG, PNG or WebP photograph under 500 KB and 16 megapixels.") from None
    begin_write(db)
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    # Serialize identity edits and verification against the same pass row.
    bus_pass = db.query(BusPass).filter_by(student_id=student_id).first()
    if bus_pass:
        bus_pass = locked_pass(db, bus_pass.id)
        bus_pass.credential_version += 1
    identity = db.get(PassIdentity, student_id)
    if not identity and not photo:
        raise HTTPException(400, "An official photograph is required.")
    if not identity:
        identity = PassIdentity(student_id=student_id)
        db.add(identity)
    identity.official_name = payload.official_name
    identity.department = payload.department
    if photo:
        identity.photo_base64 = photo
    identity.updated_by = actor.id
    identity.updated_at = utcnow()
    audit(db, actor, "pass_identity_updated", student_id, {"photo_changed": photo is not None})
    db.commit()
    return {"saved": True}


@router.get("/bus-passes/verifications")
def verification_history(db: Session = Depends(get_db), actor=Depends(require_management),
        result: str | None = Query(None, max_length=40), student_id: int | None = None,
        bus_id: int | None = None, suspicious: bool = False,
        before: datetime | None = None, limit: int = Query(50, ge=1, le=100)):
    query = db.query(PassVerification)
    if result:
        query = query.filter(PassVerification.result == result)
    if student_id:
        query = query.filter(PassVerification.student_id == student_id)
    if bus_id:
        query = query.filter(PassVerification.bus_id == bus_id)
    if suspicious:
        query = query.filter(PassVerification.result.in_(["INVALID_SIGNATURE", "REPLAY_SUSPECTED", "UNAUTHORIZED_SCANNER"]))
    if before:
        query = query.filter(PassVerification.scanned_at < before)
    rows = query.order_by(PassVerification.scanned_at.desc(), PassVerification.id.desc()).limit(limit).all()
    return {"records": [{"id": r.id, "student": r.student_name, "studentId": r.student_id,
        "driver": r.driver_name, "bus": r.bus_number, "route": r.route_name, "tripId": r.trip_id,
        "scannedAt": r.scanned_at, "result": r.result, "reason": r.reason} for r in rows],
        "nextBefore": rows[-1].scanned_at if len(rows) == limit else None}
