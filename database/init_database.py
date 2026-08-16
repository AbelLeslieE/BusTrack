"""Interactive first-administrator setup command for local Bus Tracker instances.

TODO: Replace this development bootstrap with an audited administrator-provisioning process.
"""

from __future__ import annotations

import argparse
from getpass import getpass
from pathlib import Path
import sys

from sqlalchemy import select

PROJECT_DIR = Path(__file__).resolve().parent.parent
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

import backend.models  # noqa: E402, F401
from backend.auth import create_user, get_password_hash, normalize_username  # noqa: E402
from backend.database import SessionLocal, initialize_database  # noqa: E402
from backend.models import User  # noqa: E402
from backend.roles import ROLE_ADMIN, is_admin_role  # noqa: E402


def main() -> None:
    """Create one administrator interactively without exposing its password in shell history."""

    parser = argparse.ArgumentParser(description="Create a Bus Tracker administrator account.")
    parser.add_argument("--username", required=True, help="Administrator username")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Reset the password for an existing administrator account",
    )
    arguments = parser.parse_args()
    password = getpass("Administrator password (12-72 characters): ")
    confirmation = getpass("Confirm administrator password: ")
    if password != confirmation:
        raise SystemExit("Passwords did not match.")
    if not 12 <= len(password) <= 72:
        raise SystemExit("Password must contain 12 to 72 characters.")

    initialize_database()
    with SessionLocal() as database_session:
        existing_user = database_session.scalar(
            select(User).where(User.username == normalize_username(arguments.username))
        )
        if existing_user is not None:
            if not arguments.reset_password:
                raise SystemExit("That username already exists. Use --reset-password to rotate its password.")
            if not is_admin_role(existing_user.role):
                raise SystemExit("Only an administrator account can be reset with this command.")
            existing_user.password_hash = get_password_hash(password)
            existing_user.failed_login_attempts = 0
            existing_user.locked_until = None
            existing_user.status = "Active"
            database_session.commit()
            print(f"Administrator '{normalize_username(arguments.username)}' password reset successfully.")
            return
        create_user(database_session, arguments.username, password, role=ROLE_ADMIN)
    print(f"Administrator '{normalize_username(arguments.username)}' created successfully.")


if __name__ == "__main__":
    main()
