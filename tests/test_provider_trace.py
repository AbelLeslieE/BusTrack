"""Provider GPS route capture remains opt-in and window-bounded."""

from __future__ import annotations

from datetime import datetime
import json
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models  # noqa: F401
import backend.models_route_studio  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Bus
from backend.models_route_studio import ProviderTraceSetting, TracePoint, TraceSession
from backend.services.gps_schedule import IST
from backend.services.provider_trace import (
    active_capture_window,
    finalize_provider_traces,
    record_provider_trace_observation,
)


def ist(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 11, 16, hour, minute, tzinfo=IST)


class ProviderTraceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.bus = Bus(
            bus_number="BUS-7",
            registration_number="KL64P4797",
            capacity=40,
            manufacturer="Tata",
            model="Starbus",
            year=2024,
            fuel_type="Diesel",
            status="Active",
            gps_provider="kingstrack",
        )
        self.db.add(self.bus)
        self.db.flush()
        self.db.add(ProviderTraceSetting(
            bus_id=self.bus.id,
            morning_enabled=True,
            evening_enabled=False,
            updated_by=1,
        ))
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def record(self, at: datetime, latitude: float, longitude: float) -> str | None:
        return record_provider_trace_observation(
            self.db,
            bus=self.bus,
            protocol="kingstrack",
            latitude=latitude,
            longitude=longitude,
            recorded_at=at,
            accuracy=None,
            speed_kmh=25,
            heading=None,
            received_at=at,
        )

    def test_exact_worker_windows_and_opt_in_switches(self) -> None:
        self.assertIsNone(active_capture_window(ist(6, 59)))
        self.assertEqual(active_capture_window(ist(7)).name, "morning")
        self.assertIsNone(active_capture_window(ist(9, 15)))
        self.assertIsNone(self.record(ist(6, 59), 10.0, 76.0))
        self.assertIsNone(self.record(ist(16, 15), 10.0, 76.0))
        self.assertEqual(self.db.query(TraceSession).count(), 0)

    def test_one_session_per_window_and_duplicate_fix_is_ignored(self) -> None:
        session_id = self.record(ist(7), 10.0, 76.0)
        self.assertEqual(self.record(ist(7), 10.0, 76.0), session_id)
        self.assertEqual(self.record(ist(7, 1), 10.001, 76.001), session_id)
        self.db.commit()
        session = self.db.get(TraceSession, session_id)
        self.assertEqual(session.source, "provider_gps")
        self.assertEqual(session.capture_window, "2026-11-16:morning")
        self.assertEqual(session.user_id, 0)
        points = self.db.query(TracePoint).filter_by(session_id=session_id).order_by(TracePoint.sequence).all()
        self.assertEqual([point.sequence for point in points], [1, 2])
        saved = json.loads(points[0].payload)
        self.assertAlmostEqual(saved["speed"], 25 / 3.6)
        self.assertEqual(saved["accuracy"], 10)

    def test_window_end_creates_one_editable_draft(self) -> None:
        session_id = self.record(ist(7), 10.0, 76.0)
        self.record(ist(7, 1), 10.001, 76.001)
        with patch(
            "backend.services.provider_trace.road_geometry",
            return_value=([[76.0, 10.0], [76.001, 10.001]], True),
        ):
            finished = finalize_provider_traces(self.db, now=ist(9, 15))
        self.db.commit()
        self.assertEqual(finished, [session_id])
        session = self.db.get(TraceSession, session_id)
        self.assertEqual(session.status, "DRAFT")
        self.assertEqual(json.loads(session.geometry_json)[-1], [76.001, 10.001])
        # The still-enabled daily switch cannot create a second trace for the
        # same bus/window if the job is retried.
        self.assertEqual(self.record(ist(9, 14), 10.002, 76.002), session_id)
        self.assertEqual(self.db.query(TraceSession).count(), 1)

    def test_turning_off_active_window_closes_capture_early(self) -> None:
        session_id = self.record(ist(7), 10.0, 76.0)
        self.record(ist(7, 1), 10.001, 76.001)
        setting = self.db.get(ProviderTraceSetting, self.bus.id)
        setting.morning_enabled = False
        with patch(
            "backend.services.provider_trace.road_geometry",
            return_value=([[76.0, 10.0], [76.001, 10.001]], False),
        ):
            self.assertEqual(finalize_provider_traces(self.db, now=ist(7, 2)), [session_id])
        self.assertEqual(self.db.get(TraceSession, session_id).status, "DRAFT")

    def test_mobile_tracer_jump_filter_and_osrm_pipeline_are_reused(self) -> None:
        session_id = self.record(ist(7), 10.0, 76.0)
        self.record(ist(7, 1), 10.0001, 76.0001)
        # An impossible jump is preserved as raw evidence but cannot enter the
        # usable geometry generated by the shared mobile-Tracer pipeline.
        self.record(ist(7, 2), 11.0, 77.0)
        self.record(ist(7, 3), 10.0002, 76.0002)
        with patch.dict("os.environ", {"ROUTE_STUDIO_ROAD_MATCHING_ENABLED": "false"}):
            finalize_provider_traces(self.db, now=ist(9, 15))
        session = self.db.get(TraceSession, session_id)
        geometry = json.loads(session.geometry_json)
        self.assertEqual(session.status, "DRAFT")
        self.assertNotIn([77.0, 11.0], geometry)
        self.assertEqual(geometry[-1], [76.0002, 10.0002])


if __name__ == "__main__":
    unittest.main()
