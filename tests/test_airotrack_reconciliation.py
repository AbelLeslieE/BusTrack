"""Airotrack polling must recover a missing provider-owned route session."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Bus, Route, RouteStop, Stop
from backend.routes.models_tracking import BusGPSState, LiveTrip
from backend.services.airotrack import _store_position


class AirotrackReconciliationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / f"bus_tracker_airotrack_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_repeated_poll_recovers_trip_after_late_route_assignment(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="AIRO-01", registration_number="KL-08-AIRO-01", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            database_session.add(bus)
            database_session.commit()

            source_date = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d-%m-%Y %I:%M:%S %p")
            vendor_data = {
                "vehicle_registration": bus.registration_number,
                "latitude": 10.0,
                "longitude": 76.0,
                "imei_no": "AIRO-IMEI-01",
                "source_date": source_date,
                "speed": 0,
                "ignition": "OFF",
            }
            first = _store_position(database_session, bus, vendor_data)
            database_session.commit()
            self.assertIsNone(first["active_trip_id"])

            route = Route(route_code="AIRO-R", route_name="Airotrack Route", bus_id=bus.id, driver_id=None, status="Active", total_stops=2)
            start = Stop(stop_code="AIRO-A", stop_name="Airotrack Start", latitude=10.0, longitude=76.0, radius=100, status="Active")
            end = Stop(stop_code="AIRO-B", stop_name="Airotrack End", latitude=10.1, longitude=76.1, radius=100, status="Active")
            database_session.add_all([route, start, end])
            database_session.flush()
            database_session.add_all([
                RouteStop(route_id=route.id, stop_id=start.id, sequence=1),
                RouteStop(route_id=route.id, stop_id=end.id, sequence=2),
            ])
            database_session.commit()

            repeated = _store_position(database_session, bus, vendor_data)
            database_session.commit()

            state = database_session.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).one()
            trip = database_session.query(LiveTrip).filter(LiveTrip.bus_id == bus.id).one()
            self.assertFalse(repeated["applied"])
            self.assertEqual(repeated["active_trip_id"], trip.id)
            self.assertEqual((trip.current_latitude, trip.current_longitude), (state.latitude, state.longitude))
            self.assertIsNone(trip.driver_id)
            self.assertEqual(trip.current_route_stop_id, route.route_stops[0].id)


if __name__ == "__main__":
    unittest.main()
