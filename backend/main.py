"""FastAPI entry point, lifecycle coordinator, and frontend host for Bus Tracker."""

from contextlib import asynccontextmanager, suppress
import asyncio
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

# Load local configuration before importing modules that construct the database
# engine at import time. Managed deployments inject these values directly and
# therefore do not depend on a file inside the container.
PROJECT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
load_dotenv(PROJECT_DIR / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from backend.routes.driver import router as driver_router
import backend.models  # noqa: F401  # Register models before table creation.
import backend.routes.models_tracking  # noqa: F401
from backend.database import (
    SessionLocal,
    database_initialization_lock,
    initialize_database,
    validate_database_configuration,
)
from backend.services.telemetry_retention import (
    run_telemetry_retention,
    telemetry_retention_enabled,
)
from backend.services.gps_timestamp import repair_future_gps_states
from backend.services.restore_state import restore_in_progress
from backend.routes.auth import router as authentication_router
from database.create_default_admin import create_default_admin
from backend.routes.buses import router as bus_router
from backend.routes.bus_documents import router as bus_documents_router
from backend.routes.routes import router as route_router
from backend.routes.stops import router as stop_router
from backend.routes.route_import import router as route_import_router
from backend.routes.route_stops import router as route_stop_router
from backend.routes.users import router as users_router
from backend.routes.gps import router as gps_router
from backend.routes.gps_provider import router as gps_provider_router
from backend.routes.student import router as student_router
from backend.routes.assignments import router as assignments_router
from backend.routes.notifications import router as notifications_router
from backend.routes.settings import router as settings_router
from backend.routes.active_users import router as active_users_router
from backend.routes.trip_history import router as trip_history_router
from backend.routes.admin import router as admin_router
from backend.routes.bus_passes import router as bus_pass_router
from backend.routes.pass_validation import router as pass_validation_router
from backend.security import RequestSecurityMiddleware
from backend.request_audit import RequestAuditMiddleware
from backend.utils.jwt_handler import validate_security_configuration


configured_log_level = os.getenv("LOG_LEVEL", "INFO").strip().upper()
logging.basicConfig(
    level=getattr(logging, configured_log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("bustrack")


class FrontendStaticFiles(StaticFiles):
    """Give versioned/revalidated frontend assets a bounded browser lifetime."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code in {200, 304}:
            try:
                max_age = max(0, int(os.getenv("STATIC_ASSET_CACHE_SECONDS", "3600")))
            except ValueError:
                max_age = 3600
            response.headers["Cache-Control"] = f"public, max-age={max_age}, must-revalidate"
        return response


def background_jobs_enabled() -> bool:
    """Allow an autoscaled web service to delegate scheduled work to one instance."""

    configured = os.getenv("BACKGROUND_JOBS_ENABLED", "true").strip().casefold()
    return configured not in {"false", "0", "no", "off"}


async def _run_provider_refresh(label: str) -> None:
    """Refresh every configured pull provider without coupling failures."""

    database_session = SessionLocal()
    try:
        from backend.services.gps_providers import refresh_gps_providers

        result = await asyncio.to_thread(refresh_gps_providers, database_session)
        if result["errors"] or result["skipped"]:
            logger.warning(
                "GPS providers %s: %s updated, %s errors, %s skipped.",
                label,
                len(result["updated"]),
                len(result["errors"]),
                len(result["skipped"]),
            )
    except Exception:  # Keep the tracker available if vendor is temporarily down.
        database_session.rollback()
        logger.exception("GPS providers %s refresh failed.", label)
    finally:
        database_session.close()


async def _provider_poll_loop(*, initial_delay: bool = False) -> None:
    """Keep provider pulling independent of browser/admin page visits."""

    try:
        interval = max(
            20,
            int(os.getenv(
                "GPS_PROVIDER_POLL_INTERVAL_SECONDS",
                os.getenv("AIROTRACK_POLL_INTERVAL_SECONDS", "20"),
            )),
        )
    except ValueError:
        interval = 20
    if initial_delay:
        await asyncio.sleep(interval)
    while True:
        if restore_in_progress():
            await asyncio.sleep(1)
            continue
        loop_started_at = asyncio.get_running_loop().time()
        await _run_provider_refresh("poll")
        elapsed = asyncio.get_running_loop().time() - loop_started_at
        # Keep the configured interval measured from poll start. A slow fleet
        # request must not silently turn 20-second polling into 20 seconds plus
        # the full vendor response time.
        await asyncio.sleep(max(0, interval - elapsed))


async def _telemetry_retention_loop() -> None:
    """Periodically bound raw GPS storage without interrupting live tracking."""

    try:
        interval = max(60, int(os.getenv("TELEMETRY_RETENTION_INTERVAL_SECONDS", "300")))
    except ValueError:
        interval = 300
    while True:
        if restore_in_progress():
            await asyncio.sleep(1)
            continue
        database_session = SessionLocal()
        try:
            await asyncio.to_thread(run_telemetry_retention, database_session)
            database_session.commit()
        except Exception:  # A cleanup failure must never stop GPS ingest.
            database_session.rollback()
            logger.exception("Telemetry retention failed.")
        finally:
            database_session.close()
        await asyncio.sleep(interval)


async def _document_expiry_loop() -> None:
    """Startup catch-up and daily reminders, isolated from the GPS tasks."""
    from backend.services.bus_documents import run_document_reminders

    def check_documents():
        with SessionLocal() as database_session:
            run_document_reminders(database_session)
            database_session.commit()

    while True:
        if restore_in_progress():
            await asyncio.sleep(60)
            continue
        try:
            await asyncio.to_thread(check_documents)
        except Exception:
            logger.exception("Document expiry check failed.")
            await asyncio.sleep(300)
            continue
        await asyncio.sleep(86400)


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_database_configuration()
    validate_security_configuration()
    with database_initialization_lock():
        initialize_database()
    create_default_admin()
    # Repair any snapshot selected before future-device-time validation was
    # introduced. Raw provider history is retained and marked quarantined.
    with SessionLocal() as database_session:
        repair_result = repair_future_gps_states(database_session)
        database_session.commit()
        if any(repair_result.values()):
            logger.warning(
                "GPS future timestamp repair: %s quarantined, %s restored, %s cleared.",
                repair_result["quarantined_positions"],
                repair_result["repaired_states"],
                repair_result["cleared_states"],
            )
    poll_task = None
    retention_task = None
    document_task = None
    from backend.services.gps_providers import provider_polling_configured

    run_background_jobs = background_jobs_enabled()
    if run_background_jobs:
        document_task = asyncio.create_task(_document_expiry_loop())
    if run_background_jobs and provider_polling_configured():
        initial_refresh_completed = False
        if os.getenv("APP_ENV", "development").strip().casefold() == "production":
            # On a production cold start, refresh before the service reports ready.
            # The first student response then uses the newest fix available
            # from the provider instead of the pre-sleep database snapshot.
            await _run_provider_refresh("startup refresh")
            initial_refresh_completed = True
        poll_task = asyncio.create_task(
            _provider_poll_loop(initial_delay=initial_refresh_completed)
        )
    if run_background_jobs and telemetry_retention_enabled():
        # Run once at PostgreSQL startup so migration-era coordinate history is
        # reduced immediately; the periodic task keeps it bounded afterwards.
        database_session = SessionLocal()
        try:
            await asyncio.to_thread(run_telemetry_retention, database_session)
            database_session.commit()
        except Exception:
            database_session.rollback()
            logger.exception("Initial telemetry retention failed.")
        finally:
            database_session.close()
        retention_task = asyncio.create_task(_telemetry_retention_loop())
    try:
        yield
    finally:
        if document_task is not None:
            document_task.cancel()
            with suppress(asyncio.CancelledError):
                await document_task
        if poll_task is not None:
            poll_task.cancel()
            with suppress(asyncio.CancelledError):
                await poll_task
        if retention_task is not None:
            retention_task.cancel()
            with suppress(asyncio.CancelledError):
                await retention_task


is_production = os.getenv("APP_ENV", "development").strip().casefold() == "production"
app = FastAPI(
    title="Bus Tracker API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)
app.add_middleware(RequestSecurityMiddleware)
# The GPS receiver is normally service-to-service and does not need browser
# CORS.  This narrowly permits Postman's hosted workspace to run an authorised
# Browser Agent test with the required X-GPS-Token header; it does not grant
# access without a valid provider token.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"https://(?:[a-z0-9-]+\.)*postman\.co",
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-GPS-Token"],
    max_age=600,
)
app.add_middleware(RequestAuditMiddleware)
app.include_router(authentication_router)
app.include_router(bus_router)
app.include_router(bus_documents_router)
app.include_router(driver_router)
app.include_router(route_router)
app.include_router(stop_router)
app.include_router(route_import_router)
app.include_router(route_stop_router)
app.include_router(users_router)
app.include_router(student_router)
app.include_router(gps_router)
app.include_router(gps_provider_router)
app.include_router(assignments_router)
app.include_router(notifications_router)
app.include_router(settings_router)
app.include_router(active_users_router)
app.include_router(trip_history_router)
app.include_router(admin_router)
app.include_router(bus_pass_router)
app.include_router(pass_validation_router)



# Serve the self-contained frontend files without depending on external tooling.
app.mount("/static", FrontendStaticFiles(directory=FRONTEND_DIR), name="frontend")


@app.get("/health", include_in_schema=False)
async def health_check() -> JSONResponse:
    """Cloud liveness probe: the process is running and can answer HTTP."""

    return JSONResponse(
        {"status": "ok", "service": "bustrack"},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/ready", include_in_schema=False)
def readiness_check() -> JSONResponse:
    """Cloud startup/readiness probe: restores are idle and PostgreSQL responds."""

    if restore_in_progress():
        return JSONResponse(
            {"status": "unavailable", "reason": "database_restore_in_progress"},
            status_code=503,
            headers={"Cache-Control": "no-store"},
        )
    try:
        with SessionLocal() as database_session:
            database_session.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Readiness database check failed.")
        return JSONResponse(
            {"status": "unavailable", "reason": "database_unavailable"},
            status_code=503,
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse(
        {"status": "ready", "service": "bustrack"},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/", include_in_schema=False)
async def login_page() -> FileResponse:
    """Return the browser login screen."""

    return FileResponse(FRONTEND_DIR / "login.html")


@app.get("/dashboard", include_in_schema=False)
async def dashboard_page() -> FileResponse:
    """Return the protected SPA host; feature modules are loaded by the client router."""

    return FileResponse(FRONTEND_DIR / "dashboard.html")


@app.get("/student", include_in_schema=False)
@app.get("/student/dashboard", include_in_schema=False)
@app.get("/student/live-tracking", include_in_schema=False)
async def student_live_tracking_redirect() -> RedirectResponse:
    """Keep historic student links working after Live Tracking became home."""

    return RedirectResponse(url="/dashboard#studentTracking", status_code=307)
