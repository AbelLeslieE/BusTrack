"""Coordinate independent pull providers without letting one block another."""

from __future__ import annotations

import os
from typing import Any, Literal

from sqlalchemy.orm import Session

from backend.services.kingstrack import refresh_kingstrack


ProviderName = Literal["airotrack", "kingstrack"]


def provider_polling_configured() -> bool:
    # Keep startup tolerant of a malformed Kingstrack value. The refresh path
    # validates it and reports the configuration error without stopping the
    # independent Airotrack poller.
    return bool(
        os.getenv("AIROTRACK_API_TOKEN", "").strip()
        or os.getenv("KINGSTRACK_ACCOUNTS", "").strip()
    )


def refresh_gps_providers(
    db: Session,
    *,
    bus_id: int | None = None,
    provider: ProviderName | None = None,
) -> dict[str, Any]:
    """Refresh selected providers in isolation, with Kingstrack claiming first."""

    results: dict[str, dict[str, Any]] = {}
    combined = {"updated": [], "skipped": [], "errors": []}

    def run(name: ProviderName, callback) -> None:
        try:
            result = callback()
        except Exception as error:  # Each provider remains independent.
            db.rollback()
            result = {
                "provider": name,
                "updated": [],
                "skipped": [],
                "errors": [{"reason": str(error)}],
            }
        results[name] = result
        for key in combined:
            combined[key].extend(
                {"provider": name, **item}
                for item in result.get(key, [])
            )

    if provider in (None, "kingstrack"):
        kingstrack_configured = bool(os.getenv("KINGSTRACK_ACCOUNTS", "").strip())
        if kingstrack_configured or provider == "kingstrack":
            # Parsing happens inside the isolated callback so a configuration
            # mistake is visible in health results but cannot suppress Airotrack.
            run("kingstrack", lambda: refresh_kingstrack(db, bus_id=bus_id))

    if provider in (None, "airotrack"):
        if os.getenv("AIROTRACK_API_TOKEN", "").strip():
            from backend.services.airotrack import refresh_airotrack

            run("airotrack", lambda: refresh_airotrack(db, bus_id=bus_id))
        elif provider == "airotrack":
            from backend.services.airotrack import refresh_airotrack

            run("airotrack", lambda: refresh_airotrack(db, bus_id=bus_id))

    return {"providers": results, **combined}
