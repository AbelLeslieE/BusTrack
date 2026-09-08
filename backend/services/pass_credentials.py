"""Online-only pass authentication. Browser data is never an authorization source."""
import base64
from datetime import date, datetime, timezone
from io import BytesIO
import os
import re
import secrets

import jwt
import qrcode
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException
from sqlalchemy import text

from backend.models import Bus, BusPass, PassIdentity, Route

TTL = 25
ISSUER = "bustrack-pass"
AUDIENCE = "bustrack-driver"
TOKEN_TYPE = "bustrack-pass+jwt"


def utcnow():
    return datetime.now(timezone.utc)


def signing_key():
    """Deployment secret, distinct from login JWT keys. No ephemeral fallback."""
    try:
        pem = os.environ["BUS_PASS_SIGNING_KEY_PEM"].replace("\\n", "\n").encode()
        key = serialization.load_pem_private_key(pem, password=None)
        if not isinstance(key, Ed25519PrivateKey):
            raise ValueError("Wrong key type")
        return key
    except (KeyError, ValueError, TypeError):
        raise HTTPException(503, "Secure bus pass authentication is unavailable. Contact the transport office.") from None


def begin_write(db):
    # SQLite SELECT may not start a native transaction. Acquire its write lock
    # before reading eligibility/replay state; PostgreSQL uses the pass row lock.
    if db.bind.dialect.name == "sqlite":
        native = db.connection().connection.driver_connection
        if not native.in_transaction:
            db.execute(text("BEGIN IMMEDIATE"))


def locked_pass(db, pass_id):
    begin_write(db)
    return db.query(BusPass).filter(BusPass.id == pass_id).with_for_update(of=BusPass).populate_existing().first()


def assignment(student, db):
    # Match the existing assignment policy; reject ambiguous legacy assignments.
    route = db.get(Route, student.route_id) if student.route_id else None
    if not student.route_id and student.bus_id:
        matches = db.query(Route).filter(Route.bus_id == student.bus_id).limit(2).all()
        route = matches[0] if len(matches) == 1 else None
    bus = db.get(Bus, route.bus_id) if route and route.bus_id else None
    return route, bus


MESSAGES = {
    "VALID": "Pass authenticated. Compare the official photo with the person boarding.",
    "INVALID_SIGNATURE": "Authentication failed. This QR may be forged or modified.",
    "INVALID_BUS_PASS": "This is not a supported BusTrack pass credential.",
    "QR_EXPIRED": "Ask the student to refresh their live Bus Pass.",
    "PASS_EXPIRED": "The bus pass validity period has ended.",
    "REVOKED": "This bus pass has been revoked.",
    "SUSPENDED": "This bus pass is suspended.",
    "PASS_INACTIVE": "This bus pass is not active for travel today.",
    "STUDENT_INACTIVE": "The student account is not active.",
    "UNKNOWN_PASS": "No issued pass was found.",
    "ASSIGNMENT_CHANGED": "The transport assignment or pass has changed. Refresh the live Bus Pass.",
    "ASSIGNMENT_INACTIVE": "An active bus and route assignment is required.",
    "IDENTITY_REQUIRED": "The transport office must enroll the official student photo and identity first.",
    "WRONG_BUS": "The pass is assigned to a different bus.",
    "WRONG_ROUTE": "The pass is assigned to a different route.",
    "REPLAY_SUSPECTED": "This credential or student was recently verified on another trip. Ask the transport office to review.",
    "NO_ACTIVE_TRIP": "Start your assigned trip first. No unambiguous active trip is available for verification.",
    "UNAUTHORIZED_SCANNER": "Only an authenticated driver may verify bus passes.",
}


def eligibility(bus_pass, db):
    if bus_pass is None:
        return "UNKNOWN_PASS", None, None, None
    student = bus_pass.student
    if not student or not student.user or student.user.status != "Active" or student.user.role not in {"User", "Student"}:
        return "STUDENT_INACTIVE", None, None, None
    state = bus_pass.status.upper()
    if state in {"REVOKED", "SUSPENDED"}:
        return state, None, None, None
    if state == "EXPIRED" or (bus_pass.valid_until and bus_pass.valid_until < date.today()):
        return "PASS_EXPIRED", None, None, None
    if state != "ACTIVE" or not bus_pass.valid_from or not bus_pass.valid_until or bus_pass.valid_from > date.today():
        return "PASS_INACTIVE", None, None, None
    route, bus = assignment(student, db)
    if not route or not bus or route.status != "Active" or bus.status != "Active":
        return "ASSIGNMENT_INACTIVE", route, bus, None
    identity = db.get(PassIdentity, student.id)
    if not identity or not identity.photo_base64:
        return "IDENTITY_REQUIRED", route, bus, None
    return "VALID", route, bus, identity


def issue_credential(bus_pass, route, bus):
    now = int(utcnow().timestamp())
    payload = dict(iss=ISSUER, aud=AUDIENCE, iat=now, exp=now + TTL,
                   jti=secrets.token_urlsafe(24), passId=bus_pass.id,
                   studentId=bus_pass.student_id, busId=bus.id, routeId=route.id, passNumber=bus_pass.pass_number,
                   version=bus_pass.credential_version)
    token = jwt.encode(payload, signing_key(), algorithm="EdDSA", headers={"typ": TOKEN_TYPE})
    output = BytesIO()
    qrcode.make(token, box_size=6, border=4).save(output, format="PNG")
    return {"signedToken": token, "qrImage": "data:image/png;base64," + base64.b64encode(output.getvalue()).decode(),
            "issuedAt": now, "expiresAt": now + TTL, "serverTime": utcnow().timestamp(), "refreshAfter": 20}


def decode_credential(token):
    """Use library signature verification with a fixed algorithm/key/audience."""
    key = signing_key().public_key()
    try:
        header = jwt.get_unverified_header(token)
        if header != {"alg": "EdDSA", "typ": TOKEN_TYPE}:
            return "INVALID_SIGNATURE", None
        payload = jwt.decode(token, key, algorithms=["EdDSA"], issuer=ISSUER, audience=AUDIENCE,
            options={"require": ["iss", "aud", "iat", "exp", "jti", "passId", "studentId", "busId", "routeId", "version", "passNumber"],
                     "verify_exp": False, "verify_iat": False})
        # Strict types reject boolean IDs and unbounded timestamp/identifier claims.
        for name in ("iat", "exp", "passId", "studentId", "busId", "routeId", "version"):
            if type(payload[name]) is not int or payload[name] <= 0:
                return "INVALID_BUS_PASS", None
        if not isinstance(payload["jti"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{32}", payload["jti"]):
            return "INVALID_BUS_PASS", None
        now = utcnow().timestamp()
        if not isinstance(payload["passNumber"], str) or not 1 <= len(payload["passNumber"]) <= 40:
            return "INVALID_BUS_PASS", None
        if payload["exp"] - payload["iat"] != TTL or payload["iat"] > now:
            return "INVALID_BUS_PASS", None
        if payload["exp"] <= now:
            return "QR_EXPIRED", payload
        return "VALID", payload
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        return "INVALID_SIGNATURE", None


def identity_data(identity, student):
    return {"name": identity.official_name, "studentId": student.student_code,
            "department": identity.department, "photo": "data:image/jpeg;base64," + identity.photo_base64}
