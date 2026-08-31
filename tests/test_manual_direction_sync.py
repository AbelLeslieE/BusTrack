"""Manual driver direction changes must be reflected in student tracking."""

from __future__ import annotations

from datetime import date
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

import backend.models  # noqa: F401
from backend.database import Base
from backend.models import Bus, Driver, Route, RouteStop, Stop, Student, User
from backend.routes.gps import change_trip_direction
from backend.routes.models_tracking import LiveTrip
from backend.routes.student import get_student_live_tracking
from backend.schemas_tracking import TripDirectionRequest


class ManualDirectionSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / f"bus_tracker_direction_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_legacy_direction_endpoint_only_syncs_at_an_original_terminal(self) -> None:
        with self.session_factory() as database_session:
            driver_user = User(username="direction-driver", password_hash="unused", full_name="Direction Driver", role="Driver", status="Active")
            student_user = User(username="direction-student", password_hash="unused", full_name="Direction Student", role="User", status="Active")
            bus = Bus(bus_number="DIR-01", registration_number="DIR-REG-01", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            database_session.add_all([driver_user, student_user, bus])
            database_session.flush()

            driver = Driver(user_id=driver_user.id, driver_code="DIR-DRV", license_number="DIR-LIC", license_expiry=date(2030, 1, 1), status="Available", bus_id=bus.id)
            database_session.add(driver)
            database_session.flush()
            route = Route(route_code="DIR-R", route_name="Direction Route", bus_id=bus.id, driver_id=driver.id, status="Active", total_stops=2)
            start = Stop(stop_code="DIR-A", stop_name="Start", latitude=10.0, longitude=76.0, radius=50, status="Active")
            terminal = Stop(stop_code="DIR-B", stop_name="Terminal", latitude=10.1, longitude=76.1, radius=50, status="Active")
            database_session.add_all([route, start, terminal])
            database_session.flush()
            database_session.add_all([
                RouteStop(route_id=route.id, stop_id=start.id, sequence=1),
                RouteStop(route_id=route.id, stop_id=terminal.id, sequence=2),
            ])
            student = Student(user_id=student_user.id, student_code="DIR-STUDENT", route_id=route.id, bus_id=bus.id, stop_id=start.id)
            database_session.add(student)
            database_session.flush()
            trip = LiveTrip(driver_id=driver.id, bus_id=bus.id, route_id=route.id, status="Running", route_direction="forward", current_latitude=10.05, current_longitude=76.05)
            database_session.add(trip)
            database_session.commit()

            with self.assertRaises(HTTPException) as rejected_change:
                change_trip_direction(
                    TripDirectionRequest(trip_id=trip.id, direction="reverse"),
                    database_session,
                    driver_user,
                )
            self.assertEqual(rejected_change.exception.status_code, 409)

            # A legacy client can only synchronize at an actual original
            # terminal. Its requested direction is ignored in favour of the
            # GPS-derived return direction.
            trip.current_latitude = terminal.latitude
            trip.current_longitude = terminal.longitude
            database_session.commit()
            result = change_trip_direction(
                TripDirectionRequest(trip_id=trip.id, direction="forward"),
                database_session,
                driver_user,
            )

            # The tracking response now gives the timeline explicit states,
            # rather than asking the browser to infer a current stop from an
            # index. At the terminal it is a completed leg; after departure,
            # the terminal is completed and the next return stop is only
            # approaching until its geofence is entered.
            trip.current_route_stop_id = route.route_stops[1].id
            trip.current_stop_status = "Arrived"
            database_session.commit()
            student_tracking = get_student_live_tracking(student_user, database_session)

            self.assertEqual(result["route_direction"], "reverse")
            self.assertEqual(student_tracking["trip"]["route_direction"], "reverse")
            self.assertEqual(student_tracking["stops"][0]["stop_code"], "DIR-B")
            self.assertEqual(student_tracking["stops"][0]["tracking_status"], "terminal_completed")

            trip.current_route_stop_id = route.route_stops[0].id
            trip.current_stop_status = "Approaching"
            database_session.commit()
            travelling_tracking = get_student_live_tracking(student_user, database_session)
            self.assertEqual(
                [stop["tracking_status"] for stop in travelling_tracking["stops"]],
                ["completed", "approaching"],
            )


if __name__ == "__main__":
    unittest.main()
