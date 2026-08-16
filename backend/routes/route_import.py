from io import BytesIO

import openpyxl

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
)

from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, Route, Stop
from backend.security import require_management

router = APIRouter(

    prefix="/api/routes",

    tags=["Route Import"]

)

# ==========================================================
# PREVIEW EXCEL
# ==========================================================

@router.post("/preview")
async def preview_routes(
    file: UploadFile = File(...),
    _current_user = Depends(require_management),
):
    """
    Reads the Excel file and returns a preview
    without modifying the database.
    """

    if not file.filename.lower().endswith(".xlsx"):

        raise HTTPException(

            status_code=400,

            detail="Please upload an Excel (.xlsx) file."

        )

    contents = await file.read()

    try:

        workbook = openpyxl.load_workbook(

            BytesIO(contents),

            data_only=True

        )

    except Exception:

        raise HTTPException(

            status_code=400,

            detail="Invalid Excel file."

        )

    sheet = workbook.active

    rows = list(

        sheet.iter_rows(values_only=True)

    )

    if len(rows) < 2:

        raise HTTPException(

            status_code=400,

            detail="Empty Excel sheet."

        )

    # ==========================================================
    # FIND HEADER ROW
    # ==========================================================

    header = None
    header_row_index = None

    for index, row in enumerate(rows):

        values = [
            " ".join(str(value).split()).upper()
            if value is not None
            else ""
            for value in row
        ]

        if "BUS STOP NO" in values:

            header = values
            header_row_index = index
            break

    if header is None:

        raise HTTPException(
            status_code=400,
            detail="Could not locate the header row."
        )

    # ==========================================================
    # REQUIRED COLUMNS
    # ==========================================================

    required = [

        "BUS STOP NO",
        "ROUTE",
        "TIME",
        "BUS STOP",
        "2026-27",
        "BUS NAME"

    ]

    for column in required:

        if column not in header:

            raise HTTPException(
                status_code=400,
                detail=f"Missing column: {column}"
            )

    route_column = header.index("ROUTE")
    bus_column = header.index("BUS NAME")

    route_summary = {}

    for row in rows[header_row_index + 1:]:

        route = row[route_column]

        if not route:

            continue

        route = str(route).strip()

        if route not in route_summary:

            route_summary[route] = {

                "bus": str(row[bus_column]),

                "stops": 0

            }

        route_summary[route]["stops"] += 1

    return {

        "success": True,

        "routes": [

            {

                "route_name": route,

                "bus_number": data["bus"],

                "driver_name": None,

                "total_stops": data["stops"]

            }

            for route, data

            in route_summary.items()

        ]

    }
# ==========================================================
# IMPORT EXCEL
# ==========================================================

@router.post("/import")
async def import_routes(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """
    Upload a Route Excel file.

    This endpoint currently only validates
    and opens the workbook.
    """

    # ------------------------------------------------------
    # Validate Extension
    # ------------------------------------------------------

    if not file.filename.lower().endswith(".xlsx"):

        raise HTTPException(

            status_code=400,

            detail="Please upload an Excel (.xlsx) file."

        )

    # ------------------------------------------------------
    # Read File
    # ------------------------------------------------------

    contents = await file.read()

    try:

        workbook = openpyxl.load_workbook(

            BytesIO(contents),

            data_only=True

        )

    except Exception:

        raise HTTPException(

            status_code=400,

            detail="Invalid Excel file."

        )

    # ------------------------------------------------------
    # READ FIRST WORKSHEET
    # ------------------------------------------------------

    worksheet = workbook.active

    rows = list(worksheet.iter_rows(values_only=True))

    if len(rows) < 2:

        raise HTTPException(

            status_code=400,

            detail="The Excel sheet is empty."

        )

    # ==========================================================
    # FIND HEADER
    # ==========================================================

    header = None
    header_row_index = None

    for index, row in enumerate(rows):

        values = [
            " ".join(str(value).split()).upper()
            if value is not None
            else ""
            for value in row
        ]

        if "BUS STOP NO" in values:
            header = values
            header_row_index = index
            break

    if header is None:
        raise HTTPException(
            status_code=400,
            detail="Could not locate the header row."
        )

    # ------------------------------------------------------
    # REQUIRED COLUMNS
    # ------------------------------------------------------

    required_columns = [

        "BUS STOP NO",

        "ROUTE",

        "TIME",

        "BUS STOP",

        "2026-27",

        "BUS NAME"

    ]

    missing_columns = [

        column

        for column in required_columns

        if column not in header

    ]

    if missing_columns:

        raise HTTPException(

            status_code=400,

            detail=f"Missing columns: {', '.join(missing_columns)}"

        )

    # ------------------------------------------------------
    # COLUMN INDEX
    # ------------------------------------------------------

    column_index = {

        name: header.index(name)

        for name in required_columns

    }

    # ------------------------------------------------------
    # PARSE ROWS
    # ------------------------------------------------------

    parsed_rows = []

    for row in rows[header_row_index + 1:]:

        if row[column_index["ROUTE"]] is None:

            continue

        parsed_rows.append({

            "sequence":

                row[column_index["BUS STOP NO"]],

            "route":

                str(row[column_index["ROUTE"]]).strip(),

            "time":

                row[column_index["TIME"]],

            "stop":

                str(row[column_index["BUS STOP"]]).strip(),

            "fare":

                row[column_index["2026-27"]],

            "bus":

                str(row[column_index["BUS NAME"]]).strip()

        })

    # ------------------------------------------------------
    # GROUP BY ROUTE
    # ------------------------------------------------------

    grouped_routes = {}

    for row in parsed_rows:

        route_name = row["route"]

        if route_name not in grouped_routes:

            grouped_routes[route_name] = {

                "bus": row["bus"],

                "stops": []

            }

        grouped_routes[route_name]["stops"].append({

            "sequence": row["sequence"],

            "stop_name": row["stop"],

            "scheduled_time": row["time"],

            "fare": row["fare"]

        })

    # ------------------------------------------------------
    # SORT STOPS
    # ------------------------------------------------------

    for route in grouped_routes.values():

        route["stops"].sort(

            key=lambda stop: stop["sequence"]

        )

    # ------------------------------------------------------
    # BUILD SUMMARY
    # ------------------------------------------------------

    summary = []

    for route_name, route_data in grouped_routes.items():

        summary.append({

            "route": route_name,

            "bus": route_data["bus"],

            "total_stops": len(route_data["stops"])

        })

    # ------------------------------------------------------
    # IMPORT TO DATABASE
    # ------------------------------------------------------

    routes_created = 0
    stops_created = 0

    for route_name, route_data in grouped_routes.items():

        # ---------------------------------------------
        # Find Bus
        # ---------------------------------------------

        bus = (

            db.query(Bus)

            .filter(

                Bus.bus_number == route_data["bus"]

            )

            .first()

        )

        # ---------------------------------------------
        # Find Existing Route
        # ---------------------------------------------

        route = (

            db.query(Route)

            .filter(

                Route.route_name == route_name

            )

            .first()

        )

        # ---------------------------------------------
        # Create Route
        # ---------------------------------------------

        if route is None:

            route = Route(

                route_code=route_name.replace(" ROUTE", "").upper(),

                route_name=route_name,

                bus_id=bus.id if bus else None,

                status="Active"

            )

            db.add(route)

            db.flush()

            routes_created += 1

        else:

            # Update assigned bus if found
            route.bus_id = bus.id if bus else None

            # Remove existing stops
            (

                db.query(Stop)

                .filter(

                    Stop.route_id == route.id

                )

                .delete()

            )

        # ---------------------------------------------
        # Insert Stops
        # ---------------------------------------------

        for stop in route_data["stops"]:

            db.add(

                Stop(

                    route_id=route.id,

                    sequence=int(stop["sequence"]),

                    stop_name=stop["stop_name"],

                    scheduled_time=str(stop["scheduled_time"]),

                    fare=float(stop["fare"])

                    if stop["fare"] is not None

                    else None

                )

            )

            stops_created += 1

    # ------------------------------------------------------
    # SAVE
    # ------------------------------------------------------

    db.commit()

    # ------------------------------------------------------
    # RESULT
    # ------------------------------------------------------

    return {

        "success": True,

        "routes_created": routes_created,

        "stops_created": stops_created,

        "message": "Excel imported successfully."

    }
