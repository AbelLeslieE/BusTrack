"""End-to-end student timeline states for a full forward and return route."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Bus, Driver, Route, RouteStop, Stop, Student, User
from backend.routes.gps import update_route_stop_progression
from backend.routes.models_tracking import LiveTrip
from backend.routes.student import get_student_live_tracking
from backend.routes.trip_history import bus_history


class StudentTrackingTimelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / f"bus_tracker_student_timeline_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def setUp(self) -> None:
        self.db = self.session_factory()
        self.driver_user = User(username=f"timeline-driver-{uuid4().hex}", password_hash="unused", full_name="Timeline Driver", role="Driver", status="Active")
        self.student_user = User(username=f"timeline-student-{uuid4().hex}", password_hash="unused", full_name="Timeline Student", role="User", status="Active")
        self.bus = Bus(bus_number=f"TIME-{uuid4().hex[:6]}", registration_number=f"TIME-REG-{uuid4().hex[:6]}", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
        self.db.add_all([self.driver_user, self.student_user, self.bus])
        self.db.flush()
        self.driver = Driver(user_id=self.driver_user.id, driver_code=f"TIME-DRV-{uuid4().hex[:6]}", license_number=f"TIME-LIC-{uuid4().hex[:6]}", license_expiry=date(2030, 1, 1), status="Available", bus_id=self.bus.id)
        self.db.add(self.driver)
        self.db.flush()
        self.route = Route(route_code=f"TIME-R-{uuid4().hex[:6]}", route_name="Timeline Route", bus_id=self.bus.id, driver_id=self.driver.id, status="Active", total_stops=4)
        self.stops = [
            Stop(stop_code="TIME-START", stop_name="Start", latitude=10.000, longitude=76.000, radius=150, status="Active"),
            Stop(stop_code="TIME-2", stop_name="Stop 2", latitude=10.010, longitude=76.010, radius=150, status="Active"),
            Stop(stop_code="TIME-3", stop_name="Stop 3", latitude=10.020, longitude=76.020, radius=150, status="Active"),
            Stop(stop_code="TIME-END", stop_name="Terminal", latitude=10.030, longitude=76.030, radius=150, status="Active"),
        ]
        self.db.add_all([self.route, *self.stops])
        self.db.flush()
        self.route_stops = [RouteStop(route_id=self.route.id, stop_id=stop.id, sequence=index) for index, stop in enumerate(self.stops, start=1)]
        self.db.add_all(self.route_stops)
        self.student = Student(user_id=self.student_user.id, student_code=f"TIME-STUDENT-{uuid4().hex[:6]}", route_id=self.route.id, bus_id=self.bus.id, stop_id=self.stops[0].id)
        self.trip = LiveTrip(driver_id=self.driver.id, bus_id=self.bus.id, route_id=self.route.id, status="Running", route_direction="forward")
        self.db.add_all([self.student, self.trip])
        self.db.commit()
        self.now = datetime(2026, 8, 31, 8, 0, tzinfo=timezone.utc)
        self.trip.started_at = self.now
        self.db.commit()
        self.update_number = 0

    def tearDown(self) -> None:
        self.db.close()

    def _gps_update(self, latitude: float, longitude: float) -> dict:
        ordered_stops = list(self.route_stops)
        if self.trip.route_direction == "reverse":
            ordered_stops.reverse()
        timestamp = self.now + timedelta(seconds=self.update_number * 20)
        self.update_number += 1
        update_route_stop_progression(
            self.trip,
            ordered_stops,
            latitude,
            longitude,
            previous_location=None,
            current_timestamp=timestamp,
            db=self.db,
        )
        self.trip.current_latitude = latitude
        self.trip.current_longitude = longitude
        self.trip.last_location_update = timestamp
        self.trip.current_location_source = "vehicle_gps"
        self.db.commit()
        return get_student_live_tracking(self.student_user, self.db)

    @staticmethod
    def _states(response: dict) -> list[str]:
        return [item["tracking_status"] for item in response["stops"]]

    def test_student_timeline_tracks_each_geofence_for_forward_and_return(self) -> None:
        start = self._gps_update(10.000, 76.000)
        self.assertEqual(self._states(start), ["reached", "pending", "pending", "pending"])

        between_start_and_two = self._gps_update(10.005, 76.005)
        self.assertEqual(self._states(between_start_and_two), ["completed", "approaching", "pending", "pending"])

        at_stop_two = self._gps_update(10.010, 76.010)
        self.assertEqual(self._states(at_stop_two), ["completed", "reached", "pending", "pending"])

        between_two_and_three = self._gps_update(10.015, 76.015)
        self.assertEqual(self._states(between_two_and_three), ["completed", "completed", "approaching", "pending"])

        at_stop_three = self._gps_update(10.020, 76.020)
        self.assertEqual(self._states(at_stop_three), ["completed", "completed", "reached", "pending"])

        between_three_and_terminal = self._gps_update(10.025, 76.025)
        self.assertEqual(self._states(between_three_and_terminal), ["completed", "completed", "completed", "approaching"])

        at_terminal = self._gps_update(10.030, 76.030)
        self.assertEqual(at_terminal["trip"]["route_direction"], "reverse")
        self.assertEqual(self._states(at_terminal), ["terminal_completed", "pending", "pending", "pending"])

        terminal_heartbeat = self._gps_update(10.030, 76.030)
        self.assertEqual(terminal_heartbeat["trip"]["route_direction"], "reverse")
        self.assertEqual(self._states(terminal_heartbeat), ["terminal_completed", "pending", "pending", "pending"])

        return_between_terminal_and_three = self._gps_update(10.025, 76.025)
        self.assertEqual(self._states(return_between_terminal_and_three), ["completed", "approaching", "pending", "pending"])

        return_at_stop_three = self._gps_update(10.020, 76.020)
        self.assertEqual(self._states(return_at_stop_three), ["completed", "reached", "pending", "pending"])

        return_between_three_and_two = self._gps_update(10.015, 76.015)
        self.assertEqual(self._states(return_between_three_and_two), ["completed", "completed", "approaching", "pending"])

        return_at_stop_two = self._gps_update(10.010, 76.010)
        self.assertEqual(self._states(return_at_stop_two), ["completed", "completed", "reached", "pending"])

        return_between_two_and_start = self._gps_update(10.005, 76.005)
        self.assertEqual(self._states(return_between_two_and_start), ["completed", "completed", "completed", "approaching"])

        return_terminal = self._gps_update(10.000, 76.000)
        self.assertEqual(return_terminal["trip"]["route_direction"], "forward")
        self.assertEqual(self._states(return_terminal), ["terminal_completed", "pending", "pending", "pending"])

        start_heartbeat = self._gps_update(10.000, 76.000)
        self.assertEqual(start_heartbeat["trip"]["route_direction"], "forward")
        self.assertEqual(self._states(start_heartbeat), ["terminal_completed", "pending", "pending", "pending"])

        history = bus_history(
            self.bus.id,
            date_from=None,
            date_to=None,
            search="",
            db=self.db,
            _current_user=self.driver_user,
        )
        completed_legs = [leg for leg in history["trip_legs"] if leg["status"] == "Completed"]
        self.assertEqual(len(completed_legs), 2)
        by_direction = {leg["direction"]: leg for leg in completed_legs}
        self.assertEqual(by_direction["forward"]["terminal_stop_name"], "Terminal")
        self.assertEqual(by_direction["reverse"]["terminal_stop_name"], "Start")
        self.assertEqual(
            by_direction["forward"]["started_at"].replace(tzinfo=timezone.utc),
            self.now,
        )
        self.assertIsNotNone(by_direction["forward"]["terminal_reached_at"])
        self.assertIsNotNone(by_direction["reverse"]["terminal_reached_at"])
        self.assertEqual(
            len([event for event in history["timeline"] if event["event_type"] == "Leg completed"]),
            2,
        )
        # The terminal arrival at the end of the forward leg is the same
        # visit that is departed when the reverse leg begins.
        self.assertEqual(len(history["stop_visits"]), 7)
        self.assertEqual(history["trip_legs"][0]["status"], "Running")
        self.assertEqual(history["trip_legs"][0]["direction"], "forward")


if __name__ == "__main__":
    unittest.main()
