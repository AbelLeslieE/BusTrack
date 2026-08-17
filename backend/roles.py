"""Single source of truth for Bus Tracker account roles.

The application has four account types:

* Admin – full fleet and account administration.
* Driver – the driver portal, including live tracking and issue reporting.
* User – the personal passenger/student portal.
* Technician – GPS provider integration and device-translation management.

The aliases are solely for safely upgrading existing databases.  New accounts
must always use the four canonical values above.
"""

from __future__ import annotations


ROLE_ADMIN = "Admin"
ROLE_DRIVER = "Driver"
ROLE_USER = "User"
ROLE_TECHNICIAN = "Technician"
CANONICAL_ROLES = frozenset({ROLE_ADMIN, ROLE_DRIVER, ROLE_USER, ROLE_TECHNICIAN})

# Only roles that were previously supported receive an explicit migration.
# Former Student accounts are now User accounts; their Student profile remains
# the source of their route, stop, and bus information.
LEGACY_ROLE_MAPPINGS = {
    "admin": ROLE_ADMIN,
    "administrator": ROLE_ADMIN,
    "transport admin": ROLE_ADMIN,
    "transport manager": ROLE_ADMIN,
    "driver": ROLE_DRIVER,
    "student": ROLE_USER,
    "user": ROLE_USER,
    "dispatcher": ROLE_USER,
    "technician": ROLE_TECHNICIAN,
    "developer": ROLE_TECHNICIAN,
}


def canonical_role(value: object) -> str | None:
    """Return the canonical role for a stored or submitted role value."""

    return LEGACY_ROLE_MAPPINGS.get(str(value or "").strip().casefold())


def is_admin_role(value: object) -> bool:
    return canonical_role(value) == ROLE_ADMIN


def is_driver_role(value: object) -> bool:
    return canonical_role(value) == ROLE_DRIVER


def is_user_role(value: object) -> bool:
    return canonical_role(value) == ROLE_USER


def is_technician_role(value: object) -> bool:
    return canonical_role(value) == ROLE_TECHNICIAN
