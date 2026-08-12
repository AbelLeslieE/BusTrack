"""Password hashing, authentication, and current-user dependencies.

TODO: Add account lockout and audited security events before internet-facing deployment.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import User
from backend.utils.jwt_handler import get_token_subject


password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
DatabaseSession = Annotated[Session, Depends(get_db)]


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

    # Account must be active
    if user.status != "Active":
        return None

    # Invalid password
    if not verify_password(password, user.password_hash):
        return None

    return user
    return user


def create_user(database_session: Session, username: str, password: str, role: str = "Administrator"    ) -> User:
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
    token: Annotated[str, Depends(oauth2_scheme)],
    database_session: DatabaseSession,
) -> User:

    

    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        username = get_token_subject(token)
        print("USERNAME:", username)

    except JWTError as error:
        print("JWT ERROR:", error)
        raise credentials_error from error

    user = database_session.scalar(
        select(User).where(User.username == username)
    )

    

    if user is None:
        raise credentials_error

    if user.status != "Active":
        raise credentials_error

    return user