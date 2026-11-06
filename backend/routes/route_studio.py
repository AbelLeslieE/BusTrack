"""Tracer-only capture and explicitly selected route drafts."""
import json
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_

from backend.database import get_db
from backend.models import Bus, User, Route, Stop, RouteStop, Student
from backend.models_route_studio import TracerAssignment, TraceSession, TracePoint, TraceChoice
from backend.security import require_authenticated, require_gps_technician, require_admin
from backend.services.trip_reset import lock_tracking_bus, as_utc
from backend.routes.models_tracking import LiveTrip
from backend.services.generated_codes import lock_generated_code_writes, next_route_code
from backend.services.stop_codes import lock_stop_code_writes, next_stop_code
from backend.services.road_matching import planned_route, road_geometry
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
    radius: int = Field(default=50, ge=10, le=1000)


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

def _route_plan(s):
    """Decode legacy stop lists and the richer, backward-compatible plan."""
    stored = json.loads(s.stops_json)
    geometry = json.loads(s.geometry_json)
    if isinstance(stored, list):
        return {
            "stops": stored,
            "guide_points": [],
            "geometry_source": "trace",
            "source_geometry": geometry,
        }
    if not isinstance(stored, dict) or not isinstance(stored.get("stops"), list):
        raise HTTPException(500, "This saved route plan is invalid.")
    return {
        "stops": stored["stops"],
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
            "source_geometry": plan["source_geometry"], "route_id": s.route_id}

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
    s = TraceSession(id=str(data.request_id), user_id=actor.id, bus_id=a.bus_id, name=data.name)
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


@router.post("/recordings/{sid}/select")
def select_route(sid: str, data: Select, db: Session = Depends(get_db), actor=Depends(require_admin), _=Depends(access)):
    from backend.routes.assignments import apply_route_assignment
    from backend.schemas import RouteAssignmentUpdate
    s = owned(db, sid, actor, True)
    if s.revision != data.revision or s.status not in {"DRAFT", "PUBLISHED"}:
        raise HTTPException(409, "Reload the current finished path before selecting it.")
    if db.query(LiveTrip).filter(LiveTrip.bus_id == s.bus_id, LiveTrip.status == "Running", LiveTrip.ended_at.is_(None)).first():
        raise HTTPException(409, "Route selection requires no running trip. Finish the current operation through the existing administrator controls first.")
    current = db.query(Route).filter(Route.bus_id == s.bus_id).all()
    if len(current) != 1:
        raise HTTPException(409, "Assign exactly one manual route to this bus first.")
    current = current[0]
    choice = db.get(TraceChoice, s.bus_id)
    if choice is None:
        choice = TraceChoice(bus_id=s.bus_id, manual_route_id=current.id)
        db.add(choice)
    if data.mode == "manual":
        target = db.get(Route, choice.manual_route_id)
        if not target:
            raise HTTPException(409, "Original manual route is unavailable.")
    else:
        stops = _route_plan(s)["stops"]
        if len(stops) < 2:
            raise HTTPException(422, "Add at least two confirmed stops before selecting this route.")
        target = db.get(Route, s.route_id) if s.route_id else None
        if target is None:
            lock_generated_code_writes(db, "route")
            target = Route(route_code=next_route_code(db), route_name=f"{s.name[:60]} · {s.id[:8]}", status="Active", total_stops=len(stops))
            db.add(target)
            db.flush()
            lock_stop_code_writes(db)
            for sequence, item in enumerate(stops, 1):
                # Exact master-stop reuse preserves assigned passenger stop IDs.
                stop = db.query(Stop).filter(Stop.stop_name == item["name"], Stop.latitude == item["latitude"], Stop.longitude == item["longitude"]).first()
                if stop is None:
                    if db.query(Stop).filter(Stop.stop_name == item["name"]).first():
                        raise HTTPException(409, "A master stop with this name has different coordinates. Use a new name or preserve its existing coordinates.")
                    stop = Stop(stop_code=next_stop_code(db), stop_name=item["name"], latitude=item["latitude"], longitude=item["longitude"], radius=item["radius"], status="Active")
                    db.add(stop)
                    db.flush()
                db.add(RouteStop(route_id=target.id, stop_id=stop.id, sequence=sequence))
            db.flush()
            s.route_id = target.id
    if target.bus_id and target.bus_id != s.bus_id:
        raise HTTPException(409, "Target route is now assigned to another bus.")
    passengers = db.query(Student).filter(or_(Student.route_id == current.id,
        and_(Student.route_id.is_(None), Student.bus_id == s.bus_id))).all()
    target_stops = {row.stop_id for row in db.query(RouteStop).filter(RouteStop.route_id == target.id)}
    if any(p.stop_id and p.stop_id not in target_stops for p in passengers):
        raise HTTPException(409, "The selected route omits an assigned passenger stop. Preserve the exact stop name and location or resolve passenger assignments first.")
    for passenger in passengers:
        passenger.route_id = target.id
    db.flush()
    apply_route_assignment(target.id, RouteAssignmentUpdate(bus_id=s.bus_id, driver_id=current.driver_id), db, actor)
    choice.trace_id = s.id if data.mode == "traced" else None
    if data.mode == "traced":
        s.status = "PUBLISHED"
    record_audit_event(db, category="route_studio", action="route_selected", actor=actor, details={"mode": data.mode, "trace_id": sid, "route_id": target.id, "previous_route_id": current.id})
    db.commit()
    return payload(s)

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
    if len({p.name.strip().casefold() for p in data.stops}) != len(data.stops):
        raise HTTPException(422, "Stop names must be unique within a route.")
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
                         status="DRAFT", geometry_json=source.geometry_json, stops_json=source.stops_json)
    db.add(draft)
    record_audit_event(db, category="route_studio", action="draft_copied", actor=actor,
                       details={"previous_version": sid, "new_version": draft.id})
    db.commit()
    return payload(draft)
