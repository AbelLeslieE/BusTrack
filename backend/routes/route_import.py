"""Excel route import built on the same Route/Stop/RouteStop model as the UI."""

from __future__ import annotations

from datetime import datetime, time
from io import BytesIO
from typing import Any

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, Route, RouteStop, Stop
from backend.routes.route_stops import remove_route_stop_records
from backend.security import require_management
from backend.services.generated_codes import lock_generated_code_writes, next_route_code
from backend.services.stop_codes import lock_stop_code_writes, next_stop_code


router = APIRouter(prefix="/api/routes", tags=["Route Import"])

REQUIRED_COLUMNS = ("BUS STOP NO", "ROUTE", "TIME", "BUS STOP", "2026-27", "BUS NAME")
MAX_IMPORT_BYTES = 5 * 1024 * 1024


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


async def _read_import_file(file: UploadFile) -> tuple[list[tuple[Any, ...]], list[str], int]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload an Excel (.xlsx) file.")
    contents = await file.read()
    if not contents or len(contents) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=400, detail="The Excel file is empty or exceeds the 5 MB limit.")
    try:
        workbook = openpyxl.load_workbook(BytesIO(contents), data_only=True, read_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid Excel file.") from error
    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="The Excel sheet is empty.")

    for index, row in enumerate(rows):
        header = [" ".join(_text(value).split()).upper() for value in row]
        if "BUS STOP NO" in header:
            missing = [column for column in REQUIRED_COLUMNS if column not in header]
            if missing:
                raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")
            return rows, header, index
    raise HTTPException(status_code=400, detail="Could not locate the header row.")


def _as_time(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.strftime("%H:%M")
    if isinstance(value, time):
        return value.strftime("%H:%M")
    return _text(value)[:10] or None


def _as_sequence(value: Any, row_number: int) -> int:
    try:
        sequence = int(float(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"Row {row_number}: BUS STOP NO must be a number.")
    if sequence < 1:
        raise HTTPException(status_code=422, detail=f"Row {row_number}: BUS STOP NO must be at least 1.")
    return sequence


def _as_fare(value: Any, row_number: int) -> float | None:
    if value in (None, ""):
        return None
    try:
        fare = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"Row {row_number}: 2026-27 must be a valid fare.")
    if fare < 0:
        raise HTTPException(status_code=422, detail=f"Row {row_number}: fare cannot be negative.")
    return fare


def _parse_routes(rows: list[tuple[Any, ...]], header: list[str], header_row_index: int) -> dict[str, dict[str, Any]]:
    column = {name: header.index(name) for name in REQUIRED_COLUMNS}
    routes: dict[str, dict[str, Any]] = {}
    for row_index, row in enumerate(rows[header_row_index + 1:], start=header_row_index + 2):
        def value(name: str) -> Any:
            return row[column[name]] if column[name] < len(row) else None

        route_name = _text(value("ROUTE"))
        if not route_name:
            continue
        stop_name = _text(value("BUS STOP"))
        if not stop_name:
            raise HTTPException(status_code=422, detail=f"Row {row_index}: BUS STOP is required.")
        route = routes.setdefault(route_name, {"bus_number": _text(value("BUS NAME")), "stops": []})
        route["stops"].append({
            "sequence": _as_sequence(value("BUS STOP NO"), row_index),
            "stop_name": stop_name,
            "scheduled_time": _as_time(value("TIME")),
            "fare": _as_fare(value("2026-27"), row_index),
        })

    if not routes:
        raise HTTPException(status_code=422, detail="The worksheet contains no route rows.")
    for route_name, route in routes.items():
        route["stops"].sort(key=lambda item: item["sequence"])
        names = [item["stop_name"].casefold() for item in route["stops"]]
        if len(names) != len(set(names)):
            raise HTTPException(status_code=422, detail=f"Route {route_name} contains the same stop more than once.")
    return routes


@router.post("/preview")
async def preview_routes(file: UploadFile = File(...), _current_user=Depends(require_management)):
    rows, header, header_row_index = await _read_import_file(file)
    routes = _parse_routes(rows, header, header_row_index)
    return {
        "success": True,
        "routes": [
            {"route_name": route_name, "bus_number": data["bus_number"] or None,
             "driver_name": None, "total_stops": len(data["stops"])}
            for route_name, data in routes.items()
        ],
    }


@router.post("/import")
async def import_routes(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _current_user=Depends(require_management),
):
    """Upsert routes and master stops, then replace each imported route's stops."""

    rows, header, header_row_index = await _read_import_file(file)
    grouped_routes = _parse_routes(rows, header, header_row_index)
    routes_created = routes_updated = stops_created = route_stops_created = 0
    unmatched_buses: list[str] = []

    try:
        # Use the same lock order as the complete Stops import. This keeps
        # sequential ST/RT allocation safe across both import workflows.
        lock_stop_code_writes(db)
        lock_generated_code_writes(db, "route")
        for route_name, route_data in grouped_routes.items():
            bus_number = route_data["bus_number"]
            bus = db.query(Bus).filter(func.lower(Bus.bus_number) == bus_number.casefold()).first() if bus_number else None
            if bus_number and bus is None:
                unmatched_buses.append(bus_number)

            route = db.query(Route).filter(func.lower(Route.route_name) == route_name.casefold()).first()
            if route is None:
                route = Route(
                    route_code=next_route_code(db),
                    route_name=route_name,
                    bus_id=bus.id if bus else None,
                    status="Active",
                )
                db.add(route)
                db.flush()
                routes_created += 1
            else:
                if bus is not None:
                    route.bus_id = bus.id
                routes_updated += 1

            resolved_stops: list[tuple[Stop, dict[str, Any]]] = []
            for item in route_data["stops"]:
                stop = db.query(Stop).filter(func.lower(Stop.stop_name) == item["stop_name"].casefold()).first()
                if stop is None:
                    stop = Stop(
                        stop_code=next_stop_code(db),
                        stop_name=item["stop_name"],
                        status="Active",
                    )
                    db.add(stop)
                    db.flush()
                    stops_created += 1
                resolved_stops.append((stop, item))

            stop_ids = [stop.id for stop, _item in resolved_stops]
            if len(stop_ids) != len(set(stop_ids)):
                raise HTTPException(
                    status_code=422,
                    detail=f'Route "{route_name}" contains the same stop more than once.',
                )

            # Preserve route-stop IDs that are still present. Live trips and
            # immutable stop events reference those IDs, so deleting and
            # recreating every row would corrupt or reject an otherwise safe
            # route import.
            existing_route_stops = db.query(RouteStop).filter(
                RouteStop.route_id == route.id
            ).all()
            existing_by_stop_id = {
                route_stop.stop_id: route_stop
                for route_stop in existing_route_stops
            }
            imported_stop_ids = set(stop_ids)
            remove_route_stop_records(
                db,
                [
                    route_stop
                    for route_stop in existing_route_stops
                    if route_stop.stop_id not in imported_stop_ids
                ],
            )

            for position, (stop, item) in enumerate(resolved_stops, start=1):
                route_stop = existing_by_stop_id.get(stop.id)
                if route_stop is None:
                    route_stop = RouteStop(route_id=route.id, stop_id=stop.id)
                    db.add(route_stop)
                route_stop.sequence = position
                route_stop.scheduled_time = item["scheduled_time"]
                route_stop.fare = item["fare"]
                route_stop.distance_from_previous = None
                route_stop.estimated_minutes = None
                route_stops_created += 1
            route.total_stops = len(route_data["stops"])
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=422, detail=f"Route import failed: {error}") from error

    return {
        "success": True,
        "routes_created": routes_created,
        "routes_updated": routes_updated,
        "stops_created": stops_created,
        "route_stops_created": route_stops_created,
        "unmatched_buses": sorted(set(unmatched_buses)),
        "message": "Excel routes imported successfully.",
    }
