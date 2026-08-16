"""
Create the default administrator account.

Safe to run multiple times.
"""

import os
from sqlalchemy import select

from backend.auth import create_user, get_password_hash
from backend.database import SessionLocal
from backend.models import User


DEFAULT_USERNAME = (os.getenv("BOOTSTRAP_ADMIN_USERNAME") or "admin").strip().casefold()


def _password_reset_requested() -> bool:
    """Allow a hosting-admin controlled, one-time account recovery at startup."""

    return os.getenv("BOOTSTRAP_ADMIN_RESET_PASSWORD", "false").strip().casefold() == "true"


def create_default_admin() -> None:
    """Create the default administrator if it does not already exist."""

    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "").strip()
    if password and not 12 <= len(password) <= 72:
        raise RuntimeError("BOOTSTRAP_ADMIN_PASSWORD must contain 12-72 characters.")

    database_session = SessionLocal()

    try:
        existing_admin = database_session.scalar(
            select(User).where(User.username == DEFAULT_USERNAME)
        )

        if existing_admin:
            if _password_reset_requested():
                if existing_admin.role != "Admin":
                    raise RuntimeError(
                        "BOOTSTRAP_ADMIN_USERNAME belongs to a non-admin account. "
                        "Choose the administrator username before resetting a password."
                    )
                if not password:
                    raise RuntimeError(
                        "BOOTSTRAP_ADMIN_PASSWORD is required when resetting an administrator password."
                    )
                existing_admin.password_hash = get_password_hash(password)
                existing_admin.failed_login_attempts = 0
                existing_admin.locked_until = None
                existing_admin.auth_version += 1
                database_session.commit()
                print("Bootstrap administrator password reset completed.")
            return

        if not password:
            if os.getenv("APP_ENV", "development").strip().casefold() == "production":
                raise RuntimeError(
                    "No administrator account exists. Set BOOTSTRAP_ADMIN_PASSWORD "
                    "in the hosting provider's secret store before the first startup."
                )
            print(
                "No administrator account exists. Run "
                "'python database/init_database.py --username admin' "
                "to create one interactively."
            )
            return

        create_user(
            database_session=database_session,
            username=DEFAULT_USERNAME,
            password=password,
            role="Admin",
        )

    finally:
        database_session.close()


if __name__ == "__main__":
    create_default_admin()
