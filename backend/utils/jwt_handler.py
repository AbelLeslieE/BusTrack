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
JWT_ISSUER = os.getenv("JWT_ISSUER", "bustrack")
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "bustrack-web")

if JWT_ALGORITHM not in {"HS256", "HS384", "HS512"}:
    raise RuntimeError("JWT_ALGORITHM must be HS256, HS384, or HS512.")
if ACCESS_TOKEN_EXPIRE_MINUTES < 5 or ACCESS_TOKEN_EXPIRE_MINUTES > 1440:
    raise RuntimeError("ACCESS_TOKEN_EXPIRE_MINUTES must be between 5 and 1440.")


def _get_secret_key() -> str:
    """Read a configured secret or create one persistent random key for local development."""

    configured_secret = os.getenv("JWT_SECRET_KEY", "").strip()
    is_production = os.getenv("APP_ENV", "development").strip().casefold() == "production"
    if is_production and len(configured_secret) < 32:
        raise RuntimeError("JWT_SECRET_KEY must contain at least 32 characters in production.")
    if configured_secret:
        return configured_secret
    if is_production:
        raise RuntimeError("JWT_SECRET_KEY must be configured when APP_ENV is production.")
    if DEVELOPMENT_SECRET_FILE.exists():
        return DEVELOPMENT_SECRET_FILE.read_text(encoding="utf-8").strip()
    DEVELOPMENT_SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    secret_key = secrets.token_urlsafe(48)
    DEVELOPMENT_SECRET_FILE.write_text(secret_key, encoding="utf-8")
    return secret_key


def validate_security_configuration() -> None:
    """Fail closed during production startup when the signing key is absent."""

    _get_secret_key()


def create_access_token(
    subject: str,
    expires_at: datetime | None = None,
    auth_version: int = 1,
    session_id: str | None = None,
) -> str:
    """Create a signed, time-limited bearer token for an authenticated user."""

    now = datetime.now(timezone.utc)
    expires_at = expires_at or now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": subject,
        "iat": now,
        "exp": expires_at,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "typ": "access",
        "ver": auth_version,
    }
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, _get_secret_key(), algorithm=JWT_ALGORITHM)


def get_token_identity(token: str) -> tuple[str, int, str | None]:
    """Return the subject, session version, and optional session ID."""

    payload = jwt.decode(
        token,
        _get_secret_key(),
        algorithms=[JWT_ALGORITHM],
        issuer=JWT_ISSUER,
        audience=JWT_AUDIENCE,
    )
    if payload.get("typ") != "access":
        raise JWTError("Invalid token type.")
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise JWTError("Token subject is missing.")
    auth_version = payload.get("ver", 1)
    if not isinstance(auth_version, int) or auth_version < 1:
        raise JWTError("Token session version is invalid.")
    session_id = payload.get("sid")
    if session_id is not None and (not isinstance(session_id, str) or not session_id):
        raise JWTError("Token session ID is invalid.")
    return subject, auth_version, session_id


def get_token_subject(token: str) -> str:
    """Backward-compatible subject helper for callers that do not need versioning."""

    return get_token_identity(token)[0]
