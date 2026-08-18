"""Small, central audit writer for security-sensitive BusTrack actions."""

from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from backend.models import AuditEvent, User


def client_context(request: Request | None) -> dict[str, str | None]:
    """Return bounded request metadata suitable for an audit trail."""

    if request is None:
        return {"client_ip": None, "user_agent": None}
    return {
        "client_ip": request.client.host if request.client else None,
        "user_agent": (request.headers.get("user-agent") or "")[:500] or None,
    }


def record_audit_event(
    db: Session,
    *,
    category: str,
    action: str,
    actor: User | None = None,
    subject_type: str | None = None,
    subject_id: int | None = None,
    subject_label: str | None = None,
    details: dict[str, Any] | None = None,
    request: Request | None = None,
    actor_username: str | None = None,
    actor_role: str | None = None,
) -> AuditEvent:
    """Stage an immutable audit entry in the caller's current transaction.

    Callers commit their normal business change and the audit entry together.
    ``details`` is metadata only; it must never contain credentials or payloads.
    """

    context = client_context(request)
    event = AuditEvent(
        category=category,
        action=action,
        actor_user_id=actor.id if actor else None,
        actor_username=actor.username if actor else actor_username,
        actor_role=actor.role if actor else actor_role,
        subject_type=subject_type,
        subject_id=subject_id,
        subject_label=(subject_label or "")[:200] or None,
        client_ip=context["client_ip"],
        user_agent=context["user_agent"],
        details_json=json.dumps(details, separators=(",", ":"), default=str) if details else None,
    )
    db.add(event)
    return event
