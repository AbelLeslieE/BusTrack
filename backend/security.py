"""Shared application security controls.

This module is intentionally small and dependency-free so every API router can
use the same authentication policy.  The request middleware is process-local;
production deployments should still put the application behind a reverse
proxy/WAF with an edge rate limit as well.
"""

from __future__ import annotations

from collections import defaultdict, deque
import json
import os
import threading
import time
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.auth import get_current_user
from backend.models import User
from backend.roles import ROLE_ADMIN, ROLE_DRIVER, ROLE_TECHNICIAN, ROLE_USER, canonical_role
from backend.services.restore_state import restore_in_progress


class _RequestTooLarge(Exception):
    """Internal signal used when a chunked request exceeds its body limit."""


def normalized_role(user: User) -> str:
    """Return a canonical role, or an empty string for an unknown role."""

    return canonical_role(user.role) or ""


def require_authenticated(
    current_user: User = Depends(get_current_user),
) -> User:
    """Require a valid, active bearer-token session."""

    return current_user


def require_management(
    current_user: User = Depends(require_authenticated),
) -> User:
    """Compatibility name for endpoints that require an Admin account."""

    if normalized_role(current_user) != ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return current_user


def require_admin(
    current_user: User = Depends(require_authenticated),
) -> User:
    """Require an administrator account for identity and access changes."""

    if normalized_role(current_user) != ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required.",
        )
    return current_user


def require_driver(
    current_user: User = Depends(require_authenticated),
) -> User:
    """Require a driver account for driver-owned trip operations."""

    if normalized_role(current_user) != ROLE_DRIVER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Driver access required.",
        )
    return current_user


def require_gps_technician(
    current_user: User = Depends(require_authenticated),
) -> User:
    """Allow only Admins and dedicated GPS technicians into integration tools."""

    if normalized_role(current_user) not in {ROLE_ADMIN, ROLE_TECHNICIAN}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="GPS technician access required.",
        )
    return current_user


def require_user(
    current_user: User = Depends(require_authenticated),
) -> User:
    """Require a User account for personal transport data."""

    if normalized_role(current_user) != ROLE_USER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User access required.",
        )
    return current_user


# Backwards-compatible import for student-profile routes. New code should use
# require_user; the underlying profile is still named Student in the database.
require_student = require_user


class _SlidingWindowLimiter:
    """A bounded in-process sliding-window limiter.

    This protects a single worker immediately and degrades safely when the
    application is scaled out.  The deployment proxy must provide the shared
    distributed limit for multi-worker/multi-instance deployments.
    """

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else now
        cutoff = current - self.window_seconds
        with self._lock:
            bucket = self._requests[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self.max_requests:
                return False
            bucket.append(current)
            # Do not let abandoned client keys grow without bound.
            if len(self._requests) > 10_000:
                stale_keys = [
                    candidate
                    for candidate, values in self._requests.items()
                    if not values or values[-1] <= cutoff
                ]
                for candidate in stale_keys[:2_000]:
                    self._requests.pop(candidate, None)
            return True


class RequestSecurityMiddleware:
    """Apply request-size, abuse-rate, and browser security protections."""

    MAX_REQUEST_BYTES = 2 * 1024 * 1024
    MAX_UPLOAD_BYTES = 15 * 1024 * 1024
    MAX_BACKUP_UPLOAD_BYTES = 100 * 1024 * 1024

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.general_limiter = _SlidingWindowLimiter(240, 60)
        # Vendor devices can legitimately send one position per bus every
        # 20 seconds, so this isolated webhook has a fleet-sized allowance.
        self.gps_ingest_limiter = _SlidingWindowLimiter(2_000, 60)
        self.login_limiter = _SlidingWindowLimiter(10, 60)
        self.upload_limiter = _SlidingWindowLimiter(12, 60)

    @staticmethod
    def _client_key(scope: Scope) -> str:
        client = scope.get("client")
        if isinstance(client, (tuple, list)) and client:
            return str(client[0])
        return "unknown-client"

    @staticmethod
    async def _reject(send: Send, code: int, detail: str, retry_after: int = 60) -> None:
        body = json.dumps({"detail": detail}).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"retry-after", str(retry_after).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})

    @staticmethod
    def _security_headers(path: str) -> list[tuple[bytes, bytes]]:
        # FastAPI's built-in Swagger UI is a development-only page in this
        # application.  Its HTML bootstraps Swagger with an inline script and
        # loads the bundled assets from jsDelivr, so it needs a narrowly scoped
        # policy that differs from the application UI policy below.
        is_api_docs = path in {"/docs", "/redoc"}
        script_src = (
            b"script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            if is_api_docs
            else b"script-src 'self' https://unpkg.com; "
        )
        style_src = (
            b"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            if is_api_docs
            else (
                b"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com "
                b"https://cdnjs.cloudflare.com https://unpkg.com; "
            )
        )
        img_src = (
            b"img-src 'self' data: https://fastapi.tiangolo.com; "
            if is_api_docs
            else (
                b"img-src 'self' data: blob: https://unpkg.com "
                b"https://tile.openstreetmap.org https://*.tile.openstreetmap.org; "
            )
        )
        headers = [
            (b"x-content-type-options", b"nosniff"),
            (b"x-frame-options", b"DENY"),
            (b"referrer-policy", b"strict-origin-when-cross-origin"),
            (b"permissions-policy", b"camera=(), microphone=(), payment=()"),
            (b"cross-origin-opener-policy", b"same-origin"),
            (b"cross-origin-resource-policy", b"same-origin"),
            (b"x-permitted-cross-domain-policies", b"none"),
            (
                b"content-security-policy",
                (
                    b"default-src 'self'; "
                    + b"base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
                    + b"form-action 'self'; "
                    + script_src
                    + style_src
                    + b"font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; "
                    + img_src
                    + b"connect-src 'self' https://unpkg.com https://router.project-osrm.org https://nominatim.openstreetmap.org; "
                    + b"worker-src 'self' blob:"
                ),
            ),
        ]
        if path.startswith("/api/"):
            headers.append((b"cache-control", b"no-store"))
        if os.getenv("APP_ENV", "development").casefold() == "production":
            headers.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))
        return headers

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = str(scope.get("path", ""))
        method = str(scope.get("method", "GET")).upper()
        client_key = self._client_key(scope)

        if (
            restore_in_progress()
            and path.startswith("/api/")
            and path != "/api/settings/backup/restore"
        ):
            await self._reject(send, 503, "Database recovery is in progress. Please try again shortly.", retry_after=30)
            return

        if path.startswith("/api/"):
            limiter = self.general_limiter
            if path == "/api/integrations/gps/ingest":
                limiter = self.gps_ingest_limiter
            elif path == "/api/auth/login":
                limiter = self.login_limiter
            elif path.endswith("/import") or path.endswith("/preview"):
                limiter = self.upload_limiter
            if not limiter.allow(client_key):
                await self._reject(send, 429, "Too many requests. Please try again later.")
                return

        content_length = scope.get("headers", [])
        declared_length = next(
            (value for key, value in content_length if key.lower() == b"content-length"),
            None,
        )
        if declared_length is not None:
            try:
                request_size = int(declared_length)
            except (TypeError, ValueError):
                await self._reject(send, 400, "Invalid Content-Length header.", retry_after=1)
                return
            max_size = (
                self.MAX_BACKUP_UPLOAD_BYTES
                if path == "/api/settings/backup/restore"
                else self.MAX_UPLOAD_BYTES
                if path.endswith("/import") or path.endswith("/preview")
                else self.MAX_REQUEST_BYTES
            )
            if request_size > max_size:
                await self._reject(send, 413, "Request body is too large.", retry_after=1)
                return

        max_size = (
            self.MAX_BACKUP_UPLOAD_BYTES
            if path == "/api/settings/backup/restore"
            else self.MAX_UPLOAD_BYTES
            if path.endswith("/import") or path.endswith("/preview")
            else self.MAX_REQUEST_BYTES
        )
        received_bytes = 0

        async def limited_receive() -> Message:
            nonlocal received_bytes
            message = await receive()
            if message.get("type") == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > max_size:
                    raise _RequestTooLarge
            return message

        async def send_with_headers(message: Message) -> None:
            if message.get("type") == "http.response.start":
                existing = list(message.get("headers", []))
                existing_names = {key.lower() for key, _ in existing}
                existing.extend(
                    (key, value)
                    for key, value in self._security_headers(path)
                    if key not in existing_names
                )
                message = {**message, "headers": existing}
            await send(message)

        try:
            await self.app(scope, limited_receive, send_with_headers)
        except _RequestTooLarge:
            await self._reject(send, 413, "Request body is too large.", retry_after=1)
