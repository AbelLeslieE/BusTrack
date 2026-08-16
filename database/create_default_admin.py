"""
Create the default administrator account.

Safe to run multiple times.
"""

import os
from sqlalchemy import select

from backend.auth import create_user
from backend.database import SessionLocal
from backend.models import User


DEFAULT_USERNAME = (os.getenv("BOOTSTRAP_ADMIN_USERNAME") or "admin").strip().casefold()


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
            return

        if not password:
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
