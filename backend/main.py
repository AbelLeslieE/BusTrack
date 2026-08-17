"""FastAPI entry point, database initialization, and frontend host for Bus Tracker.

TODO: Register business-area routers after each fleet workflow is defined.
"""

from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from backend.routes.driver import router as driver_router
import backend.models 
import backend.routes.models_tracking  # noqa: F401
 # noqa: F401  # Registers SQLAlchemy models before table creation.
from backend.database import initialize_database
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
from backend.utils.jwt_handler import validate_security_configuration

PROJECT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_security_configuration()
    initialize_database()
    create_default_admin()
    yield


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
