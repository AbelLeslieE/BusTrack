"""Published geometry remains readable even when recording is disabled."""
import json
from backend.models_route_studio import TraceSession, TraceChoice

def published_geometry(db, route_id, bus_id):
    choice = db.get(TraceChoice, bus_id) if bus_id else None
    if not choice or not choice.trace_id:
        return None
    trace = db.get(TraceSession, choice.trace_id)
    if not trace or trace.route_id != route_id or trace.status != "PUBLISHED":
        return None
    return {"type": "LineString", "coordinates": json.loads(trace.geometry_json)}
