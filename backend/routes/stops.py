"""
==========================================================
BUSTRACK
MASTER STOPS API
==========================================================

This API manages the master list of transport stops.

Routes DO NOT own stops.
Routes reference stops through the RouteStop table.
"""

# ==========================================================
# IMPORTS
# ==========================================================
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
import io
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    UploadFile,
    File,
)
from sqlalchemy.orm import Session
from openpyxl import load_workbook
from io import BytesIO
from backend.database import get_db
from backend.models import (
    Stop,
    RouteStop,
)
from backend.security import require_management
# ==========================================================
# ROUTER
# ==========================================================

router = APIRouter(
    prefix="/api/stops",
    tags=["Stops"],
)
# ==========================================================
# GET ALL STOPS
# ==========================================================

@router.get("")
def get_stops(
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """
    Returns the master list of all transport stops.

    Stops are independent entities and can be reused
    across multiple routes.
    """

    stops = (

        db.query(Stop)

        .order_by(
            Stop.stop_name.asc()
        )

        .all()

    )

    data = []

    for stop in stops:

        data.append({

            "id": stop.id,

            "stop_code": stop.stop_code,

            "stop_name": stop.stop_name,

            "latitude": stop.latitude,

            "longitude": stop.longitude,

            "radius": stop.radius,

            "status": stop.status,

        })

    return data
# ==========================================================
# EXPORT STOPS TO EXCEL
# ==========================================================

@router.get("/export")
def export_stops(

    db: Session = Depends(get_db),
    _current_user = Depends(require_management),

):
    """
    Export all master stops to an Excel file.

    Format:

    Index | Place
    """

    workbook = Workbook()

    sheet = workbook.active

    sheet.title = "Stops"

    # ======================================================
    # HEADER
    # ======================================================

    sheet.append([

        "Index",

        "Place"

    ])

    # ======================================================
    # DATA
    # ======================================================

    stops = (

        db.query(Stop)

        .order_by(Stop.stop_name.asc())

        .all()

    )

    for index, stop in enumerate(stops, start=1):

        sheet.append([

            index,

            stop.stop_name

        ])

    # ======================================================
    # SAVE TO MEMORY
    # ======================================================

    output = io.BytesIO()

    workbook.save(output)

    output.seek(0)

    # ======================================================
    # DOWNLOAD
    # ======================================================

    return StreamingResponse(

        output,

        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

        headers={

            "Content-Disposition":

            'attachment; filename="Stops.xlsx"'

        }

    )   
# ==========================================================
# GET SINGLE STOP
# ==========================================================

@router.get("/{stop_id}")
def get_stop(

    stop_id: int,

    db: Session = Depends(get_db),
    _current_user = Depends(require_management),

):
    """
    Returns a single stop from the master stop database.
    """

    stop = (

        db.query(Stop)

        .filter(
            Stop.id == stop_id
        )

        .first()

    )

    if stop is None:

        raise HTTPException(

            status_code=404,

            detail="Stop not found."

        )

    return {

        "id": stop.id,

        "stop_code": stop.stop_code,

        "stop_name": stop.stop_name,

        "latitude": stop.latitude,

        "longitude": stop.longitude,

        "radius": stop.radius,

        "status": stop.status,

    }
# ==========================================================
# CREATE STOP
# ==========================================================

@router.post("")
def create_stop(

    stop_data: dict,

    db: Session = Depends(get_db),
    _current_user = Depends(require_management),

):
    """
    Creates a new master stop.
    """

    # ======================================================
    # VALIDATE STOP CODE
    # ======================================================

    existing_code = (

        db.query(Stop)

        .filter(
            Stop.stop_code == stop_data["stop_code"]
        )

        .first()

    )

    if existing_code:

        raise HTTPException(

            status_code=400,

            detail="Stop code already exists."

        )

    # ======================================================
    # VALIDATE STOP NAME
    # ======================================================

    existing_name = (

        db.query(Stop)

        .filter(
            Stop.stop_name == stop_data["stop_name"]
        )

        .first()

    )

    if existing_name:

        raise HTTPException(

            status_code=400,

            detail="Stop name already exists."

        )

    # ======================================================
    # CREATE STOP
    # ======================================================

    stop = Stop(

        stop_code = stop_data["stop_code"],

        stop_name = stop_data["stop_name"],

        latitude = stop_data.get("latitude"),

        longitude = stop_data.get("longitude"),

        radius = stop_data.get("radius", 50),

        status = stop_data.get("status", "Active"),

    )

    db.add(stop)

    db.commit()

    db.refresh(stop)

    return {

        "success": True,

        "message": "Stop created successfully.",

        "stop": {

            "id": stop.id,

            "stop_code": stop.stop_code,

            "stop_name": stop.stop_name,

            "latitude": stop.latitude,

            "longitude": stop.longitude,

            "radius": stop.radius,

            "status": stop.status,

        }

    }
# ==========================================================
# UPDATE STOP
# ==========================================================

@router.put("/{stop_id}")
def update_stop(

    stop_id: int,

    stop_data: dict,

    db: Session = Depends(get_db),
    _current_user = Depends(require_management),

):
    """
    Updates an existing master stop.
    """

    stop = (

        db.query(Stop)

        .filter(
            Stop.id == stop_id
        )

        .first()

    )

    if stop is None:

        raise HTTPException(

            status_code=404,

            detail="Stop not found."

        )

    # ======================================================
    # CHECK DUPLICATE STOP CODE
    # ======================================================

    existing_code = (

        db.query(Stop)

        .filter(
            Stop.stop_code == stop_data["stop_code"],
            Stop.id != stop_id
        )

        .first()

    )

    if existing_code:

        raise HTTPException(

            status_code=400,

            detail="Stop code already exists."

        )

    # ======================================================
    # CHECK DUPLICATE STOP NAME
    # ======================================================

    existing_name = (

        db.query(Stop)

        .filter(
            Stop.stop_name == stop_data["stop_name"],
            Stop.id != stop_id
        )

        .first()

    )

    if existing_name:

        raise HTTPException(

            status_code=400,

            detail="Stop name already exists."

        )

    # ======================================================
    # UPDATE VALUES
    # ======================================================

    stop.stop_code = stop_data["stop_code"]

    stop.stop_name = stop_data["stop_name"]

    stop.latitude = stop_data.get("latitude")

    stop.longitude = stop_data.get("longitude")

    stop.radius = stop_data.get("radius", 50)

    stop.status = stop_data.get("status", "Active")

    db.commit()

    db.refresh(stop)

    return {

        "success": True,

        "message": "Stop updated successfully.",

        "stop": {

            "id": stop.id,

            "stop_code": stop.stop_code,

            "stop_name": stop.stop_name,

            "latitude": stop.latitude,

            "longitude": stop.longitude,

            "radius": stop.radius,

            "status": stop.status,

        }

    }
# ==========================================================
# IMPORT STOPS FROM EXCEL
# ==========================================================

@router.post("/import")
async def import_stops(

    file: UploadFile = File(...),

    db: Session = Depends(get_db),
    _current_user = Depends(require_management),

):
    """
    Imports master stops from an Excel file.

    Expected format:

    Column A : Index (ignored)

    Column B : Place
    """

    workbook = load_workbook(

        BytesIO(await file.read()),

        data_only=True

    )

    sheet = workbook.active

    imported = 0

    skipped = 0
    # ======================================================
    # EXISTING STOP NAMES
    # ======================================================

    existing_stop_names = {

        stop.stop_name.strip().lower()

        for stop in db.query(Stop).all()

    }
    last_stop = (

        db.query(Stop)

        .order_by(Stop.id.desc())

        .first()

    )

    if last_stop:

        try:

            next_stop_number = int(last_stop.stop_code.replace("ST", "")) + 1

        except Exception:

            next_stop_number = last_stop.id + 1

    else:

        next_stop_number = 1

    for row in sheet.iter_rows(min_row=2, values_only=True):

        stop_name = row[1]

        if stop_name is None:

            continue

        stop_name = str(stop_name).strip()

        if stop_name == "":

            continue

        normalized_name = stop_name.lower()

        if normalized_name in existing_stop_names:

            skipped += 1

            continue

        existing_stop_names.add(normalized_name)

        # ======================================================
        # GENERATE NEXT AVAILABLE STOP CODE
        # ======================================================

        last_stop = (

            db.query(Stop)

            .order_by(Stop.id.desc())

            .first()

        )

        if last_stop:

            try:

                last_number = int(last_stop.stop_code.replace("ST", ""))

            except Exception:

                last_number = last_stop.id

        else:

            last_number = 0


        stop_code = f"ST{last_number + imported + 1:04d}"

        # ======================================================
        # CREATE STOP
        # ======================================================

        stop = Stop(

            stop_code=stop_code,

            stop_name=stop_name,

            latitude=None,

            longitude=None,

            radius=50,

            status="Active"

        )

        db.add(stop)

        imported += 1

    db.commit()

    return {

        "success": True,

        "imported": imported,

        "skipped": skipped,

        "message": "Stops imported successfully."

    }
# ==========================================================
# DELETE STOP
# ==========================================================

# ==========================================================
# DELETE STOP
# ==========================================================

@router.delete("/{stop_id}")
def delete_stop(

    stop_id: int,

    db: Session = Depends(get_db),
    _current_user = Depends(require_management),

):
    """
    Deletes a stop from the master stop database.
    """

    stop = (

        db.query(Stop)

        .filter(
            Stop.id == stop_id
        )

        .first()

    )

    if stop is None:

        raise HTTPException(

            status_code=404,

            detail="Stop not found."

        )

    # ======================================================
    # CHECK WHETHER STOP IS USED IN A ROUTE
    # ======================================================

    existing_route = (

        db.query(RouteStop)

        .filter(
            RouteStop.stop_id == stop.id
        )

        .first()

    )

    if existing_route:

        raise HTTPException(

            status_code=400,

            detail="This stop is used in one or more routes."

        )

    # ======================================================
    # DELETE STOP
    # ======================================================

    db.delete(stop)

    db.commit()

    return {

        "success": True,

        "message": "Stop deleted successfully."

    }
