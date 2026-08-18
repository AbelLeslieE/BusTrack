"""FastAPI entry point, database initialization, and frontend host for Bus Tracker.

TODO: Register business-area routers after each fleet workflow is defined.
"""

from contextlib import asynccontextmanager, suppress
import asyncio
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from backend.routes.driver import router as driver_router
import backend.models 
import backend.routes.models_tracking  # noqa: F401
 # noqa: F401  # Registers SQLAlchemy models before table creation.
from backend.database import SessionLocal, initialize_database
from backend.routes.auth import router as authentication_router
from database.create_default_admin import create_default_admin
from backend.routes.buses import router as bus_router
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
from backend.routes.admin import router as admin_router
from backend.security import RequestSecurityMiddleware
from backend.request_audit import RequestAuditMiddleware
from backend.utils.jwt_handler import validate_security_configuration
from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
load_dotenv(PROJECT_DIR / ".env")


async def _airotrack_poll_loop() -> None:
    """Keep provider pulling independent of browser/admin page visits."""

    try:
        interval = max(20, int(os.getenv("AIROTRACK_POLL_INTERVAL_SECONDS", "120")))
    except ValueError:
        interval = 30
    while True:
        database_session = SessionLocal()
        try:
            from backend.services.airotrack import refresh_airotrack
            await asyncio.to_thread(refresh_airotrack, database_session)
        except Exception as error:  # Keep the tracker available if vendor is temporarily down.
            print(f"Airotrack polling error: {error}")
        finally:
            database_session.close()
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_security_configuration()
    initialize_database()
    create_default_admin()
    poll_task = None
    if os.getenv("AIROTRACK_API_TOKEN", "").strip():
        poll_task = asyncio.create_task(_airotrack_poll_loop())
    try:
        yield
    finally:
        if poll_task is not None:
            poll_task.cancel()
            with suppress(asyncio.CancelledError):
                await poll_task


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
app.include_router(admin_router)



# Serve the self-contained frontend files without depending on external tooling.
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="frontend")


@app.get("/", include_in_schema=False)
async def login_page() -> FileResponse:
    """Return the browser login screen."""

    return FileResponse(FRONTEND_DIR / "login.html")


@app.get("/dashboard", include_in_schema=False)
async def dashboard_page() -> FileResponse:
    """Return the protected SPA host; feature modules are loaded by the client router."""

    return FileResponse(FRONTEND_DIR / "dashboard.html")
