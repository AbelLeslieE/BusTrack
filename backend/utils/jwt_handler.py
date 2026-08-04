"""JWT creation and validation helpers with secure local-development defaults.

TODO: Add refresh-token rotation and token revocation for multi-device production sessions.
"""

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import secrets

from jose import JWTError, jwt


PROJECT_DIR = Path(__file__).resolve().parents[2]
DEVELOPMENT_SECRET_FILE = PROJECT_DIR / "database" / ".dev_jwt_secret"
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))


def _get_secret_key() -> str:
    """Read a configured secret or create one persistent random key for local development."""

    configured_secret = os.getenv("JWT_SECRET_KEY")
    if configured_secret:
        return configured_secret
    if os.getenv("APP_ENV", "development").lower() == "production":
        raise RuntimeError("JWT_SECRET_KEY must be configured when APP_ENV is production.")
    if DEVELOPMENT_SECRET_FILE.exists():
        return DEVELOPMENT_SECRET_FILE.read_text(encoding="utf-8").strip()
    DEVELOPMENT_SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    secret_key = secrets.token_urlsafe(48)
    DEVELOPMENT_SECRET_FILE.write_text(secret_key, encoding="utf-8")
    return secret_key


def create_access_token(subject: str) -> str:
    """Create a signed, time-limited bearer token for an authenticated user."""

    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, _get_secret_key(), algorithm=JWT_ALGORITHM)


def get_token_subject(token: str) -> str:
    """Return the authenticated username or raise when the token is invalid."""

    payload = jwt.decode(token, _get_secret_key(), algorithms=[JWT_ALGORITHM])
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise JWTError("Token subject is missing.")
    return subject
