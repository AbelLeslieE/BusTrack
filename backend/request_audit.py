"""Request metadata logging for the Technician operational queue.

Only request metadata is stored.  Request bodies, headers, passwords, JWTs,
and GPS-token plaintext values are deliberately excluded.
"""

from __future__ import annotations

import time

from sqlalchemy.orm import Session
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.database import SessionLocal
from backend.models import APIRequestLog


class RequestAuditMiddleware:
    """Persist a bounded, safe API request summary after the response is sent."""

    # These high-frequency calls are internal heartbeats or the log reader
    # itself. Excluding them keeps the request queue useful instead of noisy.
    EXCLUDED_PATHS = {
        "/api/auth/me",
        "/api/integrations/gps/audit",
        "/api/integrations/gps/requests",
    }

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    @staticmethod
    def _client_ip(scope: Scope) -> str | None:
        client = scope.get("client")
        return str(client[0]) if isinstance(client, (tuple, list)) and client else None

    @staticmethod
    def _save(scope: Scope, *, method: str, path: str, status_code: int, duration_ms: int) -> None:
        state = scope.get("state", {})
        if not isinstance(state, dict):
            state = {}
        db: Session | None = None
        try:
            db = SessionLocal()
            db.add(APIRequestLog(
                method=method[:10],
                path=path[:255],
                status_code=status_code,
                duration_ms=max(0, duration_ms),
                actor_user_id=state.get("audit_actor_user_id"),
                actor_username=state.get("audit_actor_username"),
                actor_role=state.get("audit_actor_role"),
                integration_token_id=state.get("audit_integration_token_id"),
                integration_token_label=state.get("audit_integration_token_label"),
                client_ip=RequestAuditMiddleware._client_ip(scope),
            ))
            db.commit()
        except Exception:
            # Observability must never cause a business request to fail.
            if db is not None:
                db.rollback()
        finally:
            if db is not None:
                db.close()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = str(scope.get("path", ""))
        method = str(scope.get("method", "GET")).upper()
        if not path.startswith("/api/") or method == "OPTIONS" or path in self.EXCLUDED_PATHS:
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        response_status = 500

        async def capture_response(message: Message) -> None:
            nonlocal response_status
            if message.get("type") == "http.response.start":
                response_status = int(message.get("status", 500))
            await send(message)

        try:
            await self.app(scope, receive, capture_response)
        finally:
            duration_ms = int((time.perf_counter() - started) * 1000)
            self._save(scope, method=method, path=path, status_code=response_status, duration_ms=duration_ms)
