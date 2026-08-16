"""Admin controls for active browser sessions and account suspension."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import User, UserSession
from backend.roles import ROLE_ADMIN, is_admin_role
from backend.security import require_admin


router = APIRouter(prefix="/api/active-users", tags=["Active Users"])
ACTIVE_WINDOW_SECONDS = 45


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _session_payload(session: UserSession, now: datetime) -> dict:
    user = session.user
    return {
        "session_id": session.session_id,
        "user_id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "status": user.status,
        "client_ip": session.client_ip,
        "user_agent": session.user_agent or "Unknown device",
        "created_at": session.created_at,
        "last_seen_at": session.last_seen_at,
        "expires_at": session.expires_at,
        "active": _as_utc(session.last_seen_at) >= now - timedelta(seconds=ACTIVE_WINDOW_SECONDS),
    }


def _suspended_user_payload(user: User) -> dict:
    return {
        "user_id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "status": user.status,
        "last_login": user.last_login,
    }


def _get_target(user_id: int, db: Session, current_user: User) -> User:
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use Logout to end your own session.",
        )
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return target


def _revoke_all_sessions(target: User, db: Session, reason: str) -> int:
    now = datetime.now(timezone.utc)
    sessions = db.query(UserSession).filter(
        UserSession.user_id == target.id,
        UserSession.revoked_at.is_(None),
    ).all()
    for session in sessions:
        session.revoked_at = now
        session.revoked_reason = reason
    # This also invalidates any pre-session-tracking token immediately.
    target.auth_version += 1
    return len(sessions)


@router.get("")
def list_active_users(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_admin),
) -> dict:
    """Return live browser sessions seen within the recent heartbeat window."""

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=ACTIVE_WINDOW_SECONDS)
    candidates = (
        db.query(UserSession)
        .join(User)
        .filter(
            UserSession.revoked_at.is_(None),
            User.status == "Active",
        )
        .order_by(UserSession.last_seen_at.desc())
        .all()
    )
    # Normalise timestamps in Python so both SQLite (which may return naive
    # datetimes) and PostgreSQL produce exactly the same active-device result.
    sessions = [
        session for session in candidates
        if _as_utc(session.expires_at) > now and _as_utc(session.last_seen_at) >= cutoff
    ]
    return {
        "sessions": [_session_payload(session, now) for session in sessions],
        "suspended_users": [
            _suspended_user_payload(user)
            for user in db.query(User).filter(User.status == "Locked").order_by(User.full_name).all()
        ],
        "active_sessions": len(sessions),
        "active_users": len({session.user_id for session in sessions}),
        "window_seconds": ACTIVE_WINDOW_SECONDS,
    }


@router.post("/sessions/{session_id}/kick")
def kick_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict:
    """Revoke exactly one active device session."""

    session = db.query(UserSession).filter(UserSession.session_id == session_id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active session not found.")
    _get_target(session.user_id, db, current_user)
    if session.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This session has already ended.")
    session.revoked_at = datetime.now(timezone.utc)
    session.revoked_reason = "Kicked by an administrator"
    db.commit()
    return {"message": "Device session ended immediately."}


@router.post("/{user_id}/kick")
def kick_user_everywhere(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict:
    """End every session for a user without suspending their account."""

    target = _get_target(user_id, db, current_user)
    count = _revoke_all_sessions(target, db, "Kicked from all devices by an administrator")
    db.commit()
    return {"message": "User was signed out from every device.", "revoked_sessions": count}


@router.post("/{user_id}/ban")
def ban_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict:
    """Suspend an account and terminate all of its current sessions."""

    target = _get_target(user_id, db, current_user)
    if is_admin_role(target.role):
        active_admins = db.query(User).filter(User.role == ROLE_ADMIN, User.status == "Active").count()
        if active_admins <= 1:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The last active Admin cannot be suspended.")
    if target.status == "Locked":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This user is already suspended.")
    target.status = "Locked"
    count = _revoke_all_sessions(target, db, "Account suspended by an administrator")
    db.commit()
    return {"message": "User suspended and signed out from every device.", "revoked_sessions": count}


@router.post("/{user_id}/restore")
def restore_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict:
    """Restore a suspended account. The user must sign in again."""

    target = _get_target(user_id, db, current_user)
    if target.status != "Locked":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This user is not suspended.")
    target.status = "Active"
    target.failed_login_attempts = 0
    target.locked_until = None
    db.commit()
    return {"message": "User restored. They can sign in again."}
