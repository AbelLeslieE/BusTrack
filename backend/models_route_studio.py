"""Independent recordings; never aliases live tracking state."""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, UniqueConstraint
from backend.database import Base

def now():
    return datetime.now(timezone.utc)

class TracerAssignment(Base):
    __tablename__ = "route_studio_assignments"
    user_id = Column(Integer, primary_key=True)
    bus_id = Column(Integer, nullable=False, index=True)
    assigned_by = Column(Integer, nullable=False)

class TraceSession(Base):
    __tablename__ = "route_studio_sessions"
    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    bus_id = Column(Integer, nullable=False, index=True)
    status = Column(String(24), nullable=False, default="RECORDING")
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)
    ended_at = Column(DateTime(timezone=True))
    revision = Column(Integer, default=1, nullable=False)
    geometry_json = Column(Text, default="[]", nullable=False)
    stops_json = Column(Text, default="[]", nullable=False)
    route_id = Column(Integer)

class TracePoint(Base):
    __tablename__ = "route_studio_points"
    __table_args__ = (UniqueConstraint("session_id", "sequence"),)
    id = Column(Integer, primary_key=True)
    session_id = Column(String(36), nullable=False, index=True)
    sequence = Column(Integer, nullable=False)
    payload = Column(Text, nullable=False)

class TraceChoice(Base):
    __tablename__ = "route_studio_choices"
    bus_id = Column(Integer, primary_key=True)
    manual_route_id = Column(Integer, nullable=False)
    trace_id = Column(String(36))
