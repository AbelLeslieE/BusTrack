"""FastAPI entry point, database initialization, and frontend host for Bus Tracker.

TODO: Register business-area routers after each fleet workflow is defined.
"""

from contextlib import asynccontextmanager
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
from backend.routes.student import router as student_router

PROJECT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    create_default_admin()
    yield


app = FastAPI(title="Bus Tracker API", version="0.1.0", lifespan=lifespan)
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
