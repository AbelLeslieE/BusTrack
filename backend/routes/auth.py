"""Authentication API routes for secure browser sign-in."""

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.audit import record_audit_event
from backend.auth import SESSION_COOKIE_NAME, DatabaseSession, authenticate_user, get_current_user, normalize_username
from backend.models import UserSession
from backend.roles import canonical_role
from backend.schemas import TokenResponse, UserResponse
from backend.utils.jwt_handler import ACCESS_TOKEN_EXPIRE_MINUTES, create_access_token, get_token_identity


router = APIRouter(prefix="/api/auth", tags=["Authentication"])
LoginForm = Annotated[OAuth2PasswordRequestForm, Depends()]


@router.post("/login", response_model=TokenResponse)
def login(
    form_data: LoginForm,
    database_session: DatabaseSession,
    response: Response,
    request: Request,
) -> TokenResponse:
    """Validate credentials and issue a short-lived JWT bearer token."""

    user = authenticate_user(database_session, form_data.username, form_data.password)
    if user is None:
        request.state.audit_actor_username = normalize_username(form_data.username)[:64] or None
        # Keep failed attempts visible to an authorised technician without
        # recording a password or revealing whether an account exists.
        record_audit_event(
            database_session,
            category="portal",
            action="sign_in_failed",
            actor_username=normalize_username(form_data.username)[:64] or None,
            subject_type="portal",
            subject_label="BusTrack sign-in",
            request=request,
        )
        database_session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    request.state.audit_actor_user_id = user.id
    request.state.audit_actor_username = user.username
    request.state.audit_actor_role = user.role
    session = UserSession(
        session_id=secrets.token_urlsafe(32),
        user_id=user.id,
        client_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:500] or None,
        expires_at=expires_at,
    )
    database_session.add(session)
    resolved_role = canonical_role(user.role) or user.role
    record_audit_event(
        database_session,
        category="portal",
        action="portal_entered",
        actor=user,
        subject_type="portal",
        subject_label=f"{resolved_role} portal",
        details={"portal_role": resolved_role, "session": "created"},
        request=request,
    )
    database_session.commit()
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


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, request: Request, database_session: DatabaseSession) -> None:
    """Revoke the current tracked browser session and clear its cookie."""

    authorization = request.headers.get("authorization", "")
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        try:
            _, _, session_id = get_token_identity(token)
            if session_id:
                session = database_session.query(UserSession).filter(UserSession.session_id == session_id).first()
                if session and session.revoked_at is None:
                    session.revoked_at = datetime.now(timezone.utc)
                    session.revoked_reason = "Signed out"
                    record_audit_event(
                        database_session,
                        category="portal",
                        action="portal_signed_out",
                        actor=session.user,
                        subject_type="portal",
                        subject_label=f"{canonical_role(session.user.role) or session.user.role} portal",
                        details={"session": "revoked"},
                        request=request,
                    )
                    database_session.commit()
        except Exception:
            # Logout remains safe and idempotent even when an expired token is
            # presented by the browser.
            pass

    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: Annotated[object, Depends(get_current_user)]) -> object:
    """Return safe account details for the signed-in browser session."""

    return current_user
