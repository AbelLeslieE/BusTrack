"""Authentication API routes for secure browser sign-in."""

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import urlencode
from urllib.request import Request as URLRequest, urlopen

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse
from jose import JWTError
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from backend.audit import record_audit_event
from backend.auth import (
    SESSION_COOKIE_NAME,
    DatabaseSession,
    authenticate_user,
    get_current_user,
    get_password_hash,
    normalize_username,
)
from backend.models import Student, User, UserSession
from backend.roles import ROLE_USER, canonical_role
from backend.schemas import GoogleSignupComplete, TokenResponse, UserResponse
from backend.services.generated_codes import lock_generated_code_writes, next_student_code
from backend.utils.jwt_handler import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    create_temporary_token,
    decode_temporary_token,
    get_token_identity,
)


router = APIRouter(prefix="/api/auth", tags=["Authentication"])
LoginForm = Annotated[OAuth2PasswordRequestForm, Depends()]
GOOGLE_OAUTH_COOKIE = "bus_tracker_google_oauth"
GOOGLE_SIGNUP_COOKIE = "bus_tracker_google_signup"
GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"


def _secure_cookie() -> bool:
    return os.getenv("APP_ENV", "development").strip().casefold() == "production"


def _google_configuration() -> tuple[str, str, str]:
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    allowed_domain = os.getenv("GOOGLE_OAUTH_ALLOWED_DOMAIN", "sahardaya.ac.in").strip().casefold().lstrip("@")
    if not client_id or not client_secret:
        raise RuntimeError("Google signup is not configured.")
    if not allowed_domain or "." not in allowed_domain:
        raise RuntimeError("Google signup has an invalid allowed domain.")
    return client_id, client_secret, allowed_domain


def _google_redirect_uri(request: Request) -> str:
    configured = os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "").strip()
    return configured or str(request.url_for("google_signup_callback"))


def _bounded_json(response) -> dict:
    body = response.read(65_537)
    if len(body) > 65_536:
        raise ValueError("Google returned an oversized response.")
    parsed = json.loads(body.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Google returned an invalid response.")
    return parsed


def _fetch_google_identity(code: str, redirect_uri: str, code_verifier: str) -> dict:
    """Exchange one OAuth code and read the identity attached to its access token."""

    client_id, client_secret, _ = _google_configuration()
    token_request = URLRequest(
        GOOGLE_OAUTH_TOKEN_URL,
        data=urlencode({
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        }).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    with urlopen(token_request, timeout=10) as token_response:
        token_payload = _bounded_json(token_response)
    access_token = token_payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise ValueError("Google did not return an access token.")

    identity_request = URLRequest(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        method="GET",
    )
    with urlopen(identity_request, timeout=10) as identity_response:
        return _bounded_json(identity_response)


def _google_error_redirect(error_code: str) -> RedirectResponse:
    response = RedirectResponse(url=f"/?google_error={error_code}", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(GOOGLE_OAUTH_COOKIE, path="/api/auth/google")
    response.delete_cookie(GOOGLE_SIGNUP_COOKIE, path="/api/auth/google")
    return response


def _pending_google_signup(request: Request) -> dict:
    token = request.cookies.get(GOOGLE_SIGNUP_COOKIE, "")
    try:
        claims = decode_temporary_token(token, "google-signup")
    except (JWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your verified Google signup has expired. Start again from the sign-in page.",
        )
    email = claims.get("email")
    google_subject = claims.get("google_sub")
    if not isinstance(email, str) or not isinstance(google_subject, str) or not google_subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google signup session.")
    return claims


def _student_name(google_name: object, email: str) -> str:
    full_name = " ".join(str(google_name or "").split())[:100]
    if len(full_name) < 2:
        full_name = email.partition("@")[0].replace(".", " ").replace("_", " ").title()[:100]
    return full_name if len(full_name) >= 2 else "Sahardaya Student"


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


@router.get("/google/signup")
def google_signup_start(request: Request) -> RedirectResponse:
    """Send a new student through Google Workspace account verification."""

    try:
        client_id, _, allowed_domain = _google_configuration()
    except RuntimeError:
        return _google_error_redirect("not_configured")

    state_value = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    redirect_uri = _google_redirect_uri(request)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    state_token = create_temporary_token(
        "google-oauth-state",
        {"state": state_value, "verifier": code_verifier, "redirect_uri": redirect_uri},
        expires_in_minutes=10,
    )
    authorization_url = f"{GOOGLE_AUTHORIZE_URL}?{urlencode({
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': 'openid email profile',
        'state': state_value,
        'code_challenge': code_challenge,
        'code_challenge_method': 'S256',
        'hd': allowed_domain,
        'prompt': 'select_account',
    })}"
    response = RedirectResponse(url=authorization_url, status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        GOOGLE_OAUTH_COOKIE,
        state_token,
        max_age=10 * 60,
        httponly=True,
        secure=_secure_cookie(),
        samesite="lax",
        path="/api/auth/google",
    )
    response.delete_cookie(GOOGLE_SIGNUP_COOKIE, path="/api/auth/google")
    return response


@router.get("/google/callback", name="google_signup_callback")
def google_signup_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Validate Google's callback and open a short-lived credential setup step."""

    if error:
        return _google_error_redirect("cancelled" if error == "access_denied" else "google_failed")
    flow_cookie = request.cookies.get(GOOGLE_OAUTH_COOKIE, "")
    try:
        flow = decode_temporary_token(flow_cookie, "google-oauth-state")
        expected_state = flow.get("state")
        verifier = flow.get("verifier")
        redirect_uri = flow.get("redirect_uri")
        if not all(isinstance(value, str) and value for value in (code, state, expected_state, verifier, redirect_uri)):
            raise ValueError("Incomplete Google callback.")
        if not secrets.compare_digest(state, expected_state):
            raise ValueError("Google OAuth state mismatch.")
        identity = _fetch_google_identity(code, redirect_uri, verifier)
        _, _, allowed_domain = _google_configuration()
        email = str(identity.get("email") or "").strip().casefold()
        google_subject = identity.get("sub")
        hosted_domain = str(identity.get("hd") or "").strip().casefold()
        if identity.get("email_verified") is not True:
            return _google_error_redirect("email_not_verified")
        if (
            len(email) > 100
            or email.rpartition("@")[2] != allowed_domain
            or hosted_domain != allowed_domain
        ):
            return _google_error_redirect("wrong_domain")
        if not isinstance(google_subject, str) or not google_subject:
            raise ValueError("Google identity is missing a subject.")
    except (JWTError, OSError, ValueError, RuntimeError, json.JSONDecodeError):
        return _google_error_redirect("google_failed")

    full_name = _student_name(identity.get("name"), email)
    signup_token = create_temporary_token(
        "google-signup",
        {"email": email, "full_name": full_name, "google_sub": google_subject},
        expires_in_minutes=15,
    )
    response = RedirectResponse(url="/google-signup", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(GOOGLE_OAUTH_COOKIE, path="/api/auth/google")
    response.set_cookie(
        GOOGLE_SIGNUP_COOKIE,
        signup_token,
        max_age=15 * 60,
        httponly=True,
        secure=_secure_cookie(),
        samesite="strict",
        path="/api/auth/google",
    )
    return response


@router.get("/google/pending")
def read_google_signup(request: Request) -> dict[str, str]:
    """Return only the verified identity needed by the credential form."""

    claims = _pending_google_signup(request)
    return {"email": claims["email"], "full_name": str(claims.get("full_name") or "")}


@router.post("/google/complete", status_code=status.HTTP_201_CREATED)
def complete_google_signup(
    signup: GoogleSignupComplete,
    request: Request,
    response: Response,
    database_session: DatabaseSession,
) -> dict[str, str]:
    """Create or claim a student account after college Google verification."""

    claims = _pending_google_signup(request)
    email = str(claims["email"]).strip().casefold()
    _, _, allowed_domain = _google_configuration()
    if email.rpartition("@")[2] != allowed_domain:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="A Sahardaya email is required.")

    username = normalize_username(signup.username)
    if not any(character.islower() for character in signup.password):
        raise HTTPException(status_code=422, detail="Passwords must include a lowercase letter.")
    if not any(character.isupper() for character in signup.password):
        raise HTTPException(status_code=422, detail="Passwords must include an uppercase letter.")
    if not any(character.isdigit() for character in signup.password):
        raise HTTPException(status_code=422, detail="Passwords must include a number.")
    if not any(not character.isalnum() for character in signup.password):
        raise HTTPException(status_code=422, detail="Passwords must include a symbol.")
    try:
        # Acquire this before the first query so SQLite can begin an immediate
        # transaction; PostgreSQL uses the matching advisory transaction lock.
        lock_generated_code_writes(database_session, "student")
        existing_email = (
            database_session.query(User)
            .filter(func.lower(User.email) == email)
            .first()
        )
        username_owner = (
            database_session.query(User)
            .filter(func.lower(User.username) == username)
            .first()
        )
        if username_owner is not None and (existing_email is None or username_owner.id != existing_email.id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is already in use.")

        account_was_claimed = existing_email is not None
        if existing_email is not None:
            if canonical_role(existing_email.role) != ROLE_USER or not existing_email.must_change_password:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This email already has a BusTrack account. Sign in normally or contact the transport administrator.",
                )
            if existing_email.status != "Active":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This student account is not active. Contact the transport administrator.",
                )
            user = existing_email
            user.username = username
            user.password_hash = get_password_hash(signup.password)
            user.must_change_password = False
            user.failed_login_attempts = 0
            user.locked_until = None
            user.auth_version += 1
            now = datetime.now(timezone.utc)
            for active_session in (
                database_session.query(UserSession)
                .filter(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
                .all()
            ):
                active_session.revoked_at = now
                active_session.revoked_reason = "Imported account claimed through verified Google signup"
        else:
            full_name = _student_name(claims.get("full_name"), email)
            user = User(
                full_name=full_name,
                username=username,
                password_hash=get_password_hash(signup.password),
                email=email,
                role=ROLE_USER,
                status="Active",
                must_change_password=False,
            )
            database_session.add(user)
            database_session.flush()

        if user.student is None:
            database_session.add(Student(user_id=user.id, student_code=next_student_code(database_session)))

        record_audit_event(
            database_session,
            category="security",
            action="google_student_signup_completed",
            actor=user,
            subject_type="student",
            subject_id=user.id,
            subject_label=user.username,
            details={"existing_imported_account_claimed": account_was_claimed},
            request=request,
        )
        database_session.commit()
    except HTTPException:
        database_session.rollback()
        raise
    except IntegrityError as exc:
        database_session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That username or email is already registered.",
        ) from exc

    response.delete_cookie(GOOGLE_SIGNUP_COOKIE, path="/api/auth/google")
    return {"message": "Your BusTrack student account is ready.", "username": username}


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
