"""Published geometry remains readable even when recording is disabled."""
import json
from backend.models import Route
from backend.models_route_studio import TraceSession

def published_geometry(db, route_id, bus_id):
    if not route_id or not bus_id:
        return None
    route = db.get(Route, route_id)
    if not route or route.bus_id != bus_id:
        return None
    trace = db.query(TraceSession).filter(
        TraceSession.route_id == route_id,
        TraceSession.status == "PUBLISHED",
    ).order_by(TraceSession.created_at.desc()).first()
    if not trace:
        return None
    return {"type": "LineString", "coordinates": json.loads(trace.geometry_json)}
