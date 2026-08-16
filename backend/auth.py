"""Password hashing, authentication, and current-user dependencies."""

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import User
from backend.utils.jwt_handler import get_token_subject


password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SESSION_COOKIE_NAME = "bus_tracker_session"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)
DatabaseSession = Annotated[Session, Depends(get_db)]
MAX_LOGIN_FAILURES = 5
LOGIN_LOCKOUT_MINUTES = 15


def normalize_username(username: str) -> str:
    """Normalize usernames consistently before storage and lookup."""

    return username.strip().casefold()


def get_password_hash(password: str) -> str:
    """Generate a bcrypt password hash with a unique cryptographic salt."""

    return password_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Safely compare a supplied password with its bcrypt hash."""

    try:
        return password_context.verify(password, password_hash)
    except (TypeError, ValueError):
        return False


def authenticate_user(database_session: Session, username: str, password: str) -> User | None:
    """Return an active user only when the supplied password is valid."""

    user = database_session.scalar(
        select(User).where(User.username == normalize_username(username))
    )
    # User not found
    if user is None:
        return None

    # Account must be active and not temporarily locked.
    if user.status != "Active":
        return None

    now = datetime.now(timezone.utc)
    locked_until = user.locked_until
    if locked_until is not None and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    if locked_until and locked_until > now:
        return None
    if locked_until and locked_until <= now:
        user.locked_until = None
        user.failed_login_attempts = 0

    # Invalid password
    if not verify_password(password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= MAX_LOGIN_FAILURES:
            user.locked_until = now + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
        database_session.commit()
        return None

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login = now
    database_session.commit()

    return user


def create_user(database_session: Session, username: str, password: str, role: str = "Admin") -> User:
    """Create an active user using a salted hash instead of a plaintext password."""

    normalized_username = normalize_username(username)
    user = User(
        full_name="System Administrator",
        username=normalized_username,
        password_hash=get_password_hash(password),
        role=role,
        status="Active",
    )
    database_session.add(user)
    database_session.commit()
    database_session.refresh(user)
    return user


def get_current_user(
    request: Request,
    token: Annotated[str | None, Depends(oauth2_scheme)],
    database_session: DatabaseSession,
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Accept the legacy bearer header and the safer HttpOnly browser cookie.
    # Keeping both during migration avoids interrupting existing modules.
    token = token or request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise credentials_error

    try:
        username = get_token_subject(token)

    except JWTError as error:
        raise credentials_error from error

    user = database_session.scalar(
        select(User).where(User.username == username)
    )

    

    if user is None:
        raise credentials_error

    if user.status != "Active":
        raise credentials_error

    now = datetime.now(timezone.utc)
    locked_until = user.locked_until
    if locked_until is not None and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    if locked_until and locked_until > now:
        raise credentials_error

    return user
