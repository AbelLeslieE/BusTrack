"""Authenticated account settings.

These endpoints deliberately operate on the account in the validated session;
the client never supplies a user ID. That prevents someone from accidentally
changing another account while editing their own settings.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from io import BytesIO
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.audit import record_audit_event
from backend.auth import SESSION_COOKIE_NAME, get_password_hash, normalize_username, verify_password
from backend.database import engine, get_db
from backend.models import User, UserSession
from backend.schemas import AccountProfileUpdate, PasswordChangeRequest, TokenResponse, UserResponse
from backend.security import require_authenticated, require_management
from backend.services.database_backup import create_database_backup_archive, restore_database_backup_archive
from backend.services.restore_state import begin_restore, end_restore
from backend.utils.jwt_handler import ACCESS_TOKEN_EXPIRE_MINUTES, create_access_token, get_token_identity


router = APIRouter(prefix="/api/settings", tags=["Settings"])


def _password_policy_error(password: str) -> str | None:
    """Return a safe, actionable password-policy error, if any."""

    if len(password) < 12:
        return "New passwords must contain at least 12 characters."
    if not any(character.islower() for character in password):
        return "New passwords must include a lowercase letter."
    if not any(character.isupper() for character in password):
        return "New passwords must include an uppercase letter."
    if not any(character.isdigit() for character in password):
        return "New passwords must include a number."
    if not any(not character.isalnum() for character in password):
        return "New passwords must include a symbol."
    return None


def _request_session_id(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    try:
        return get_token_identity(token)[2]
    except Exception:
        return None


def _issue_session(response: Response, request: Request, db: Session, user: User) -> TokenResponse:
    """Rotate the browser token after sensitive account changes."""

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    session_id = _request_session_id(request)
    session = (
        db.query(UserSession)
        .filter(UserSession.session_id == session_id, UserSession.user_id == user.id)
        .first()
        if session_id
        else None
    )
    if session is None:
        session = UserSession(
            session_id=secrets.token_urlsafe(32),
            user_id=user.id,
            client_ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent", "")[:500] or None,
            expires_at=expires_at,
        )
        db.add(session)
    else:
        session.expires_at = expires_at
        session.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    token = create_access_token(
        user.username,
        expires_at=expires_at,
        auth_version=user.auth_version,
        session_id=session.session_id,
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=os.getenv("APP_ENV", "development").strip().casefold() == "production",
        samesite="lax",
        path="/",
    )
    return TokenResponse(access_token=token, expires_at=expires_at, user=user)


@router.get("/account", response_model=UserResponse)
def get_account_settings(current_user: User = Depends(require_authenticated)) -> User:
    """Return the current authenticated account's details."""

    return current_user


@router.put("/account", response_model=TokenResponse)
def update_account_settings(
    update: AccountProfileUpdate,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated),
) -> TokenResponse:
    """Update the authenticated account's identity details only."""

    full_name = update.full_name.strip()
    if len(full_name) < 2:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Full name is required.")

    username = normalize_username(update.username)
    duplicate_username = db.query(User).filter(
        User.username == username,
        User.id != current_user.id,
    ).first()
    if duplicate_username is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username is already in use.")

    email = str(update.email).strip().casefold() if update.email else None
    duplicate_email = (
        db.query(User)
        .filter(func.lower(User.email) == email, User.id != current_user.id)
        .first()
        if email
        else None
    )
    if duplicate_email is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email address is already in use.")

    current_user.full_name = full_name
    current_user.username = username
    current_user.email = email
    current_user.phone = update.phone.strip() if update.phone and update.phone.strip() else None
    db.commit()
    db.refresh(current_user)
    return _issue_session(response, request, db, current_user)


@router.put("/account/password", response_model=TokenResponse)
def change_account_password(
    update: PasswordChangeRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated),
) -> TokenResponse:
    """Change the authenticated account password after verification."""

    if not verify_password(update.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
    if verify_password(update.new_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a password that has not been used for this account.")
    policy_error = _password_policy_error(update.new_password)
    if policy_error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=policy_error)

    current_user.password_hash = get_password_hash(update.new_password)
    current_user.failed_login_attempts = 0
    current_user.locked_until = None
    current_user.auth_version += 1
    db.commit()
    db.refresh(current_user)
    return _issue_session(response, request, db, current_user)


@router.get("/backup/download")
def download_database_backup(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_management),
):
    """Download an admin-authorized ZIP backup from SQLite or PostgreSQL."""

    record_audit_event(
        db,
        category="security",
        action="database_backup_downloaded",
        actor=current_user,
        subject_type="database_backup",
        subject_label=f"{engine.dialect.name} ZIP backup",
        request=request,
    )
    db.commit()

    try:
        archive = create_database_backup_archive(engine)
    except Exception as error:
        raise HTTPException(status_code=500, detail="Unable to create the database backup.") from error

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return StreamingResponse(
        BytesIO(archive),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="BusTrack-backup-{timestamp}.zip"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/backup/restore")
async def restore_database_backup(
    request: Request,
    file: UploadFile = File(...),
    confirmation: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_management),
):
    """Replace all BusTrack data with a validated administrator backup.

    A restore is intentionally destructive. It is held behind an explicit
    confirmation phrase, validates the full archive before writes begin, and
    performs the data replacement in one database transaction.
    """

    if confirmation != "RESTORE":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Type RESTORE to confirm database recovery.")
    if not file.filename or not file.filename.casefold().endswith(".zip"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please upload a BusTrack backup ZIP file.")
    archive = await file.read()
    if not begin_restore():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Another database recovery is already in progress.")

    actor_username = current_user.username
    actor_role = current_user.role
    db.commit()
    try:
        restore_database_backup_archive(engine, archive)
        # The restored archive may no longer contain the administrator who
        # began this request. Keep a detached audit snapshot so recovery
        # itself remains traceable without assuming the old user ID exists.
        db.expire_all()
        record_audit_event(
            db,
            category="security",
            action="database_backup_restored",
            actor_username=actor_username,
            actor_role=actor_role,
            subject_type="database_backup",
            subject_label=file.filename,
            request=request,
        )
        db.commit()
        return {"success": True, "message": "Backup restored. Sign in again to continue."}
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="Database recovery could not be completed; existing data was not replaced.") from error
    finally:
        end_restore()
