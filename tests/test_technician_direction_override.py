"""Technician direction overrides must redraw the student trip immediately."""

from __future__ import annotations

from datetime import date
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
from backend.database import Base
from backend.models import Bus, Driver, Route, RouteStop, Stop, Student, User
from backend.routes.gps_provider import override_provider_trip_direction
from backend.routes.models_tracking import LiveTrip
from backend.routes.student import get_student_live_tracking
from backend.schemas_gps_provider import GPSProviderTripDirectionUpdate


class TechnicianDirectionOverrideTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / f"bus_tracker_technician_direction_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_override_reverses_student_stop_order_without_mutating_route(self) -> None:
        with self.session_factory() as db:
            technician = User(username="gps-tech", password_hash="unused", full_name="GPS Technician", role="Technician", status="Active")
            student_user = User(username="direction-student", password_hash="unused", full_name="Direction Student", role="User", status="Active")
            driver_user = User(username="direction-driver", password_hash="unused", full_name="Direction Driver", role="Driver", status="Active")
            bus = Bus(bus_number="DIR-TECH-01", registration_number="DIR-TECH-REG", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            db.add_all([technician, student_user, driver_user, bus])
            db.flush()
            driver = Driver(user_id=driver_user.id, driver_code="DIR-TECH-DRV", license_number="DIR-TECH-LIC", license_expiry=date(2030, 1, 1), status="Available", bus_id=bus.id)
            route = Route(route_code="DIR-TECH-R", route_name="Direction Route", bus_id=bus.id, driver_id=None, status="Active", total_stops=3)
            stops = [
                Stop(stop_code="DIR-A", stop_name="Start", latitude=10.0, longitude=76.0, radius=50, status="Active"),
                Stop(stop_code="DIR-B", stop_name="Middle", latitude=10.05, longitude=76.05, radius=50, status="Active"),
                Stop(stop_code="DIR-C", stop_name="Terminal", latitude=10.1, longitude=76.1, radius=50, status="Active"),
            ]
            db.add_all([driver, route, *stops])
            db.flush()
            route_stops = [RouteStop(route_id=route.id, stop_id=stop.id, sequence=index) for index, stop in enumerate(stops, start=1)]
            db.add_all(route_stops)
            db.flush()
            student = Student(user_id=student_user.id, student_code="DIR-TECH-STUDENT", route_id=route.id, bus_id=bus.id, stop_id=stops[0].id)
            trip = LiveTrip(driver_id=driver.id, bus_id=bus.id, route_id=route.id, status="Running", route_direction="forward", current_route_stop_id=route_stops[1].id, current_stop_status="Approaching", current_latitude=10.05, current_longitude=76.05)
            db.add_all([student, trip])
            db.commit()

            result = override_provider_trip_direction(
                bus.id,
                GPSProviderTripDirectionUpdate(direction="reverse"),
                None,
                db,
                technician,
            )
            tracking = get_student_live_tracking(student_user, db)

            self.assertEqual(result["route_direction"], "reverse")
            self.assertEqual(tracking["trip"]["route_direction"], "reverse")
            self.assertEqual([stop["stop_code"] for stop in tracking["stops"]], ["DIR-C", "DIR-B", "DIR-A"])
            self.assertEqual(tracking["trip"]["current_stop"]["stop_code"], "DIR-B")
            self.assertEqual([item.sequence for item in route.route_stops], [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
