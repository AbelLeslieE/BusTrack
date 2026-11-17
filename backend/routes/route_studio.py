"""Tracer-only capture and explicitly selected route drafts."""
import json
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, User, Route, Stop, RouteStop
from backend.models_route_studio import (
    ProviderTraceSetting,
    TracerAssignment,
    TraceSession,
    TracePoint,
)
from backend.security import require_authenticated, require_gps_technician, require_admin
from backend.services.trip_reset import lock_tracking_bus, as_utc
from backend.services.generated_codes import lock_generated_code_writes, next_route_code
from backend.services.stop_codes import lock_stop_code_writes, next_stop_code
from backend.services.road_matching import planned_route, road_geometry
from backend.services.provider_trace import (
    PROVIDER_TRACE_SOURCE,
    capture_schedule_payload,
    finalize_provider_traces,
)
from backend.audit import record_audit_event

router = APIRouter(prefix="/api/route-studio", tags=["Route Studio"])


@router.get("/geometry/{route_id}")
def route_geometry(route_id: int, db: Session = Depends(get_db), actor=Depends(require_gps_technician)):
    # Published static routes remain available after disabling capture tools.
    trace = db.query(TraceSession).filter(TraceSession.route_id == route_id, TraceSession.status == "PUBLISHED").first()
    return {"geometry": {"type": "LineString", "coordinates": json.loads(trace.geometry_json)} if trace else None}

def enabled():
    return os.getenv("ENABLE_ROUTE_STUDIO", "false").casefold() in {"true", "1", "yes"}

def access(actor=Depends(require_authenticated)):
    if not enabled():
        raise HTTPException(404, "Route Studio is disabled.")
    if actor.role not in {"Admin", "Technician", "Tracer"}:
        raise HTTPException(403, "Route Studio access required.")
    return actor

class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

class Assignment(Strict):
    user_id: int
    bus_id: int


class ProviderCaptureUpdate(Strict):
    morning_enabled: bool
    evening_enabled: bool

class Start(Strict):
    request_id: uuid.UUID
    name: str = Field(min_length=1, max_length=100)

class Point(Strict):
    sequence: int = Field(ge=1, le=20000)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    recorded_at: AwareDatetime
    accuracy: float = Field(ge=0, le=100000)
    speed: float | None = Field(default=None, ge=0)
    heading: float | None = Field(default=None, ge=0, le=360)

class Batch(Strict):
    points: list[Point] = Field(min_length=1, max_length=200)

class Action(Strict):
    action: Literal["pause", "resume", "finish", "discard"]
    final_sequence: int | None = Field(default=None, ge=0, le=20000)

class DraftStop(Strict):
    name: str = Field(min_length=1, max_length=100)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius: int = Field(default=250, ge=10, le=1000)


class RouteGuide(Strict):
    segment: int = Field(ge=0, le=198)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class Draft(Strict):
    revision: int
    name: str = Field(min_length=1, max_length=100)
    stops: list[DraftStop] = Field(max_length=200)
    geometry: list[list[float]] = Field(min_length=2, max_length=20000)
    guide_points: list[RouteGuide] = Field(default_factory=list, max_length=198)
    geometry_source: Literal["trace", "road"] = "trace"
    source_geometry: list[list[float]] | None = Field(default=None, min_length=2, max_length=20000)


class RoadPlan(Strict):
    revision: int
    stops: list[DraftStop] = Field(min_length=2, max_length=200)
    guide_points: list[RouteGuide] = Field(default_factory=list, max_length=198)

class Select(Strict):
    mode: Literal["manual", "traced"]
    revision: int


class Publish(Strict):
    revision: int

def _route_plan(s):
    """Decode legacy stop lists and the richer, backward-compatible plan."""
    stored = json.loads(s.stops_json)
    geometry = json.loads(s.geometry_json)
    if isinstance(stored, list):
        stops = stored
        for stop in stops:
            stop.setdefault("radius", 250)
        return {
            "stops": stops,
            "guide_points": [],
            "geometry_source": "trace",
            "source_geometry": geometry,
        }
    if not isinstance(stored, dict) or not isinstance(stored.get("stops"), list):
        raise HTTPException(500, "This saved route plan is invalid.")
    stops = stored["stops"]
    for stop in stops:
        stop.setdefault("radius", 250)
    return {
        "stops": stops,
        "guide_points": stored.get("guide_points", []),
        "geometry_source": stored.get("geometry_source", "trace"),
        "source_geometry": stored.get("source_geometry") or geometry,
    }


def _encode_route_plan(*, stops, guide_points, geometry_source, source_geometry):
    return json.dumps({
        "stops": stops,
        "guide_points": guide_points,
        "geometry_source": geometry_source,
        "source_geometry": source_geometry,
    })


def _ordered_anchors(stops, guides):
    anchors = []
    for segment, stop in enumerate(stops[:-1]):
        anchors.append({"latitude": stop.latitude, "longitude": stop.longitude})
        anchors.extend(
            {"latitude": guide.latitude, "longitude": guide.longitude}
            for guide in guides if guide.segment == segment
        )
    anchors.append({"latitude": stops[-1].latitude, "longitude": stops[-1].longitude})
    return anchors


def payload(s):
    plan = _route_plan(s)
    return {"id": s.id, "bus_id": s.bus_id, "user_id": s.user_id, "name": s.name,
            "status": s.status, "revision": s.revision, "created_at": s.created_at,
            "geometry": json.loads(s.geometry_json), "stops": plan["stops"],
            "guide_points": plan["guide_points"], "geometry_source": plan["geometry_source"],
            "source_geometry": plan["source_geometry"], "route_id": s.route_id,
            "source": s.source, "capture_window": s.capture_window}


def _available_route_name(db: Session, requested_name: str) -> str:
    """Return a readable route name that satisfies the master-table constraint."""

    base = (requested_name.strip() or "Recorded route")[:100]
    existing = {
        value.casefold()
        for (value,) in db.query(Route.route_name).all()
    }
    if base.casefold() not in existing:
        return base
    number = 2
    while True:
        suffix = f" ({number})"
        candidate = f"{base[:100 - len(suffix)]}{suffix}"
        if candidate.casefold() not in existing:
            return candidate
        number += 1


def _publication_payload(
    s,
    route: Route,
    *,
    created_stops: int = 0,
    reused_stops: int = 0,
):
    result = payload(s)
    result["publication"] = {
        "route_id": route.id,
        "route_code": route.route_code,
        "route_name": route.route_name,
        "created_stops": created_stops,
        "reused_stops": reused_stops,
        "assigned": bool(route.bus_id or route.driver_id),
    }
    return result

def owned(db, sid, actor, write=False):
    s = db.get(TraceSession, sid)
    if not s or (actor.role == "Tracer" and s.user_id != actor.id):
        raise HTTPException(404, "Recording not found.")
    if write:
        lock_tracking_bus(db, s.bus_id)
        db.refresh(s)
    return s

@router.get("/availability")
def availability(actor=Depends(require_authenticated)):
    from backend.services.daily_direction import IST
    now = datetime.now(timezone.utc)
    return {"enabled": enabled() and actor.role in {"Admin", "Technician", "Tracer"}, "server_utc": now, "server_ist": now.astimezone(IST)}


@router.get("/stops")
def master_stops(db: Session = Depends(get_db), actor=Depends(require_gps_technician), _=Depends(access)):
    return [{"name": s.stop_name, "latitude": s.latitude, "longitude": s.longitude, "radius": s.radius}
            for s in db.query(Stop).filter(Stop.latitude.is_not(None), Stop.longitude.is_not(None)).order_by(Stop.stop_name).limit(2000)]

@router.get("")
def overview(db: Session = Depends(get_db), actor=Depends(access)):
    query = db.query(TraceSession)
    if actor.role == "Tracer":
        query = query.filter(TraceSession.user_id == actor.id)
    a = db.get(TracerAssignment, actor.id)
    return {"recordings": [payload(s) for s in query.order_by(TraceSession.created_at.desc()).limit(100)],
            "assignment": {"bus_id": a.bus_id, "bus_number": db.get(Bus, a.bus_id).bus_number} if a and db.get(Bus, a.bus_id) else None,
            "buses": [{"id": b.id, "name": b.bus_number} for b in db.query(Bus).all()] if actor.role != "Tracer" else [],
            "tracers": [{"id": u.id, "name": u.full_name} for u in db.query(User).filter(User.role == "Tracer", User.status == "Active")] if actor.role != "Tracer" else []}


def _provider_capture_overview(db: Session) -> dict:
    schedule = capture_schedule_payload()
    settings = {
        item.bus_id: item
        for item in db.query(ProviderTraceSetting).all()
    }
    latest: dict[int, TraceSession] = {}
    for session in db.query(TraceSession).filter(
        TraceSession.source == PROVIDER_TRACE_SOURCE,
    ).order_by(TraceSession.created_at.desc()).all():
        latest.setdefault(session.bus_id, session)
    schedule["buses"] = [
        {
            "id": bus.id,
            "bus_number": bus.bus_number,
            "registration_number": bus.registration_number,
            "provider": bus.gps_provider or "auto",
            "morning_enabled": bool(settings.get(bus.id) and settings[bus.id].morning_enabled),
            "evening_enabled": bool(settings.get(bus.id) and settings[bus.id].evening_enabled),
            "last_trace": (
                {
                    "id": latest[bus.id].id,
                    "name": latest[bus.id].name,
                    "status": latest[bus.id].status,
                    "capture_window": latest[bus.id].capture_window,
                }
                if bus.id in latest else None
            ),
        }
        for bus in db.query(Bus).order_by(Bus.bus_number).all()
    ]
    return schedule


@router.get("/provider-capture")
def provider_capture_overview(
    db: Session = Depends(get_db),
    actor=Depends(require_gps_technician),
    _=Depends(access),
):
    return _provider_capture_overview(db)


@router.put("/provider-capture/{bus_id}")
def update_provider_capture(
    bus_id: int,
    data: ProviderCaptureUpdate,
    db: Session = Depends(get_db),
    actor=Depends(require_gps_technician),
    _=Depends(access),
):
    bus = lock_tracking_bus(db, bus_id)
    if bus is None:
        raise HTTPException(404, "Bus not found.")
    setting = db.get(ProviderTraceSetting, bus_id)
    if setting is None:
        setting = ProviderTraceSetting(bus_id=bus_id)
        db.add(setting)
    setting.morning_enabled = data.morning_enabled
    setting.evening_enabled = data.evening_enabled
    setting.updated_by = actor.id
    setting.updated_at = datetime.now(timezone.utc)
    # Turning off the active window safely closes what was recorded so far.
    finalized = finalize_provider_traces(db, bus_id=bus_id)
    record_audit_event(
        db,
        category="route_studio",
        action="provider_trace_setting_updated",
        actor=actor,
        subject_label=bus.bus_number,
        details={
            "bus_id": bus.id,
            "morning_enabled": data.morning_enabled,
            "evening_enabled": data.evening_enabled,
            "finalized_trace_ids": finalized,
        },
    )
    db.commit()
    return _provider_capture_overview(db)

@router.put("/assignment")
def assign(data: Assignment, db: Session = Depends(get_db), actor=Depends(require_gps_technician), _=Depends(access)):
    u, b = db.get(User, data.user_id), lock_tracking_bus(db, data.bus_id)
    if not u or u.role != "Tracer" or u.status != "Active" or not b:
        raise HTTPException(422, "Choose an active Tracer and an existing bus.")
    # Lock user too: assignments to different buses cannot race each other.
    db.query(User).filter(User.id == u.id).with_for_update().one()
    if db.query(TraceSession).filter(TraceSession.user_id == u.id, TraceSession.status.in_(["RECORDING", "PAUSED"])).first():
        raise HTTPException(409, "Finish the tracer's recording before reassigning.")
    a = db.get(TracerAssignment, u.id)
    if not a:
        a = TracerAssignment(user_id=u.id)
        db.add(a)
    a.bus_id, a.assigned_by = b.id, actor.id
    record_audit_event(db, category="route_studio", action="tracer_assigned", actor=actor, details=data.model_dump())
    db.commit()
    return {"assigned": True}

@router.post("/recordings")
def start(data: Start, db: Session = Depends(get_db), actor=Depends(access)):
    if actor.role != "Tracer":
        raise HTTPException(403, "Log in as the assigned Tracer to record onboard GPS.")
    a = db.get(TracerAssignment, actor.id)
    if not a or not lock_tracking_bus(db, a.bus_id):
        raise HTTPException(409, "A technician must assign your bus first.")
    db.query(User).filter(User.id == actor.id).with_for_update().one()
    db.refresh(a)
    existing = db.get(TraceSession, str(data.request_id))
    if existing:
        return payload(owned(db, existing.id, actor))
    if db.query(TraceSession).filter(TraceSession.bus_id == a.bus_id, TraceSession.status.in_(["RECORDING", "PAUSED"])).first():
        raise HTTPException(409, "This bus already has an unfinished recording.")
    s = TraceSession(
        id=str(data.request_id), user_id=actor.id, bus_id=a.bus_id,
        name=data.name, source="phone",
    )
    db.add(s)
    db.commit()
    return payload(s)

@router.get("/recordings/{sid}")
def detail(sid: str, db: Session = Depends(get_db), actor=Depends(access)):
    s = owned(db, sid, actor)
    result = payload(s)
    result["points"] = [json.loads(p.payload) for p in db.query(TracePoint).filter(TracePoint.session_id == sid).order_by(TracePoint.sequence).limit(20000)]
    return result

@router.post("/recordings/{sid}/points")
def upload(sid: str, data: Batch, db: Session = Depends(get_db), actor=Depends(access)):
    s = owned(db, sid, actor, True)
    if actor.role != "Tracer" or actor.id != s.user_id or s.status not in {"RECORDING", "PAUSED"}:
        raise HTTPException(409, "This recording is not accepting points.")
    ack = []
    for p in data.points:
        if as_utc(p.recorded_at) > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise HTTPException(422, "Phone time is ahead of server time.")
        encoded = json.dumps(p.model_dump(mode="json"), sort_keys=True)
        old = db.query(TracePoint).filter_by(session_id=sid, sequence=p.sequence).first()
        if old and old.payload != encoded:
            raise HTTPException(409, "Sequence already contains a different GPS point.")
        if not old:
            db.add(TracePoint(session_id=sid, sequence=p.sequence, payload=encoded))
            db.flush()
        ack.append(p.sequence)
    db.commit()
    return {"acknowledged": ack}

@router.post("/recordings/{sid}/action")
def action(sid: str, data: Action, db: Session = Depends(get_db), actor=Depends(access)):
    s = owned(db, sid, actor, True)
    allowed = {"pause": {"RECORDING"}, "resume": {"PAUSED"}, "finish": {"RECORDING", "PAUSED"}, "discard": {"RECORDING", "PAUSED", "DRAFT"}}
    target_status = {"pause": "PAUSED", "resume": "RECORDING", "finish": "DRAFT", "discard": "DISCARDED"}[data.action]
    if s.status == target_status:
        return payload(s)
    if s.status not in allowed[data.action]:
        raise HTTPException(409, "Invalid recording transition.")
    if data.action == "finish":
        points = db.query(TracePoint).filter_by(session_id=sid).order_by(TracePoint.sequence).all()
        if data.final_sequence is None or [p.sequence for p in points] != list(range(1, data.final_sequence + 1)):
            raise HTTPException(409, "Synchronize all GPS samples before finishing.")
        if len(points) < 2:
            raise HTTPException(422, "At least two GPS samples are required.")
        raw = [json.loads(p.payload) for p in points]
        geometry, matched = road_geometry(raw)
        if len(geometry) < 2:
            raise HTTPException(422, "The GPS samples do not show enough reliable movement to make a route. Continue recording with precise location enabled.")
        s.geometry_json = json.dumps(geometry)
        s.ended_at = datetime.now(timezone.utc)
        record_audit_event(db, category="route_studio", action="recording_finished", actor=actor,
                           details={"trace_id": s.id, "raw_samples": len(raw),
                                    "geometry_points": len(geometry), "road_matched": matched,
                                    "geometry_mode": "osrm_match" if matched else "filtered_gps_trail"})
    s.status = target_status
    db.commit()
    return payload(s)


@router.post("/recordings/{sid}/publish")
def publish_route(
    sid: str,
    data: Publish,
    db: Session = Depends(get_db),
    actor=Depends(require_admin),
    _=Depends(access),
):
    """Save a finished draft into Routes and Stops without assigning it.

    Assignment remains exclusively owned by the Assignment workspace. This
    makes publishing safe even when a bus has no route yet or currently has a
    running trip.
    """

    s = owned(db, sid, actor, True)
    if s.revision != data.revision:
        raise HTTPException(409, "Reload the current route draft before publishing it.")

    if s.status == "PUBLISHED" and s.route_id:
        existing_route = db.get(Route, s.route_id)
        if existing_route is None:
            raise HTTPException(409, "The published route no longer exists. Create an editable copy and publish it again.")
        return _publication_payload(s, existing_route)

    if s.status != "DRAFT":
        raise HTTPException(409, "Only a finished route draft can be published.")

    stops = _route_plan(s)["stops"]
    if len(stops) < 2:
        raise HTTPException(422, "Add at least two confirmed stops before saving this route.")

    lock_generated_code_writes(db, "route")
    route = Route(
        route_code=next_route_code(db),
        route_name=_available_route_name(db, s.name),
        status="Active",
        total_stops=len(stops),
    )
    db.add(route)
    db.flush()

    created_stops = 0
    reused_stops = 0
    lock_stop_code_writes(db)
    for sequence, item in enumerate(stops, 1):
        stop_name = item["name"].strip()
        # Reuse only the exact same physical master stop. The same display
        # name at a different location is valid and receives a new stop code.
        stop = db.query(Stop).filter(
            Stop.stop_name == stop_name,
            Stop.latitude == item["latitude"],
            Stop.longitude == item["longitude"],
        ).first()
        if stop is None:
            stop = Stop(
                stop_code=next_stop_code(db),
                stop_name=stop_name,
                latitude=item["latitude"],
                longitude=item["longitude"],
                radius=item["radius"],
                status="Active",
            )
            db.add(stop)
            db.flush()
            created_stops += 1
        else:
            reused_stops += 1
        db.add(RouteStop(route_id=route.id, stop_id=stop.id, sequence=sequence))

    s.route_id = route.id
    s.status = "PUBLISHED"
    record_audit_event(
        db,
        category="route_studio",
        action="route_published",
        actor=actor,
        subject_label=route.route_code,
        details={
            "trace_id": sid,
            "route_id": route.id,
            "created_stops": created_stops,
            "reused_stops": reused_stops,
            "assigned": False,
        },
    )
    db.commit()
    return _publication_payload(
        s,
        route,
        created_stops=created_stops,
        reused_stops=reused_stops,
    )


@router.post("/recordings/{sid}/select", deprecated=True)
def select_route(
    sid: str,
    data: Select,
    db: Session = Depends(get_db),
    actor=Depends(require_admin),
    _=Depends(access),
):
    """Keep cached clients safe while preserving separate assignment.

    Older tabs called ``select`` after saving a traced draft. Treat that one
    operation as publish-only; it never changes bus, driver, or passenger
    assignments. The removed manual-switch operation stays unavailable.
    """

    if data.mode != "traced":
        raise HTTPException(
            410,
            "Choose and assign a route from the Assignments workspace.",
        )
    return publish_route(sid, Publish(revision=data.revision), db, actor, _)

@router.post("/recordings/{sid}/road-route")
def build_road_route(sid: str, data: RoadPlan, db: Session = Depends(get_db),
                     actor=Depends(require_gps_technician), _=Depends(access)):
    """Preview an OSRM road route through stops and fine-tuning anchors."""
    s = owned(db, sid, actor)
    if s.status != "DRAFT" or s.revision != data.revision:
        raise HTTPException(409, "Reload the current unpublished draft before rebuilding its road route.")
    if any(guide.segment >= len(data.stops) - 1 for guide in data.guide_points):
        raise HTTPException(422, "A route guide refers to a stop segment that no longer exists.")
    anchors = _ordered_anchors(data.stops, data.guide_points)
    if len(anchors) > 200:
        raise HTTPException(422, "This route has too many editing points. Remove some guide points and try again.")
    try:
        geometry = planned_route(anchors)
    except Exception as error:
        raise HTTPException(502, f"OSRM could not connect these points along roads: {error}") from error
    return {"geometry": geometry, "anchor_count": len(anchors)}


@router.put("/recordings/{sid}/draft")
def edit(sid: str, data: Draft, db: Session = Depends(get_db), actor=Depends(require_gps_technician), _=Depends(access)):
    s = owned(db, sid, actor, True)
    if s.status != "DRAFT" or s.revision != data.revision:
        raise HTTPException(409, "Only the current unpublished draft can be edited.")
    if any(len(p) != 2 or not -180 <= p[0] <= 180 or not -90 <= p[1] <= 90 for p in data.geometry):
        raise HTTPException(422, "Invalid longitude/latitude path.")
    if data.source_geometry and any(len(p) != 2 or not -180 <= p[0] <= 180 or not -90 <= p[1] <= 90 for p in data.source_geometry):
        raise HTTPException(422, "Invalid original tracer geometry.")
    if any(guide.segment >= max(0, len(data.stops) - 1) for guide in data.guide_points):
        raise HTTPException(422, "A route guide refers to a stop segment that no longer exists.")
    existing = _route_plan(s)
    source_geometry = data.source_geometry or existing["source_geometry"] or data.geometry
    if data.geometry_source == "trace":
        source_geometry = data.geometry
    s.name = data.name
    s.geometry_json = json.dumps(data.geometry)
    s.stops_json = _encode_route_plan(
        stops=[p.model_dump() for p in data.stops],
        guide_points=[p.model_dump() for p in data.guide_points],
        geometry_source=data.geometry_source,
        source_geometry=source_geometry,
    )
    s.revision += 1
    record_audit_event(db, category="route_studio", action="draft_saved", actor=actor, subject_label=s.id)
    db.commit()
    return payload(s)


@router.post("/recordings/{sid}/copy")
def copy_version(sid: str, db: Session = Depends(get_db), actor=Depends(require_gps_technician), _=Depends(access)):
    source = owned(db, sid, actor, True)
    if source.status not in {"DRAFT", "PUBLISHED"}:
        raise HTTPException(409, "Finish recording before creating a draft version.")
    draft = TraceSession(id=str(uuid.uuid4()), user_id=actor.id, bus_id=source.bus_id, name=source.name,
                         status="DRAFT", geometry_json=source.geometry_json, stops_json=source.stops_json,
                         source=source.source)
    db.add(draft)
    record_audit_event(db, category="route_studio", action="draft_copied", actor=actor,
                       details={"previous_version": sid, "new_version": draft.id})
    db.commit()
    return payload(draft)
