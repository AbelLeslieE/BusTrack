"""
Create the default administrator account.

Safe to run multiple times.
"""

from sqlalchemy import select

from backend.auth import create_user
from backend.database import SessionLocal
from backend.models import User


DEFAULT_USERNAME = "admin"
DEFAULT_PASSWORD = "Admin@123"


def create_default_admin() -> None:
    """Create the default administrator if it does not already exist."""

    database_session = SessionLocal()

    try:
        existing_admin = database_session.scalar(
            select(User).where(User.username == DEFAULT_USERNAME)
        )

        if existing_admin:
            print("✓ Default administrator already exists.")
            return

        create_user(
            database_session=database_session,
            username=DEFAULT_USERNAME,
            password=DEFAULT_PASSWORD,
            role="admin",
        )

        print("=" * 45)
        print("✓ Default administrator created")
        print(f"Username : {DEFAULT_USERNAME}")
        print(f"Password : {DEFAULT_PASSWORD}")
        print("=" * 45)

    finally:
        database_session.close()


if __name__ == "__main__":
    create_default_admin()