"""Vehicle GPS must establish tracking without a browser action."""

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
from backend.models import Bus, Driver, Route, RouteStop, Stop, User
from backend.routes.gps import start_trip, stop_trip
from backend.routes.gps_provider import _update_active_trip_from_vehicle
from backend.routes.models_tracking import LiveTrip
from backend.schemas_tracking import TripStopRequest
from backend.services.vehicle_gps import vehicle_gps_is_authoritative


class VehicleGpsAutostartTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / f"bus_tracker_vehicle_autostart_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_valid_ignition_on_module_position_creates_and_updates_tracking(self) -> None:
        with self.session_factory() as database_session:
            user = User(username="module-driver", password_hash="unused", full_name="Module Driver", role="Driver", status="Active")
            bus = Bus(bus_number="GPS-01", registration_number="GPS-REG-01", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            database_session.add_all([user, bus])
            database_session.flush()
            driver = Driver(user_id=user.id, driver_code="GPS-DRV", license_number="GPS-LIC", license_expiry=date(2030, 1, 1), status="Available", bus_id=bus.id)
            database_session.add(driver)
            database_session.flush()
            route = Route(route_code="GPS-R", route_name="GPS Route", bus_id=bus.id, driver_id=driver.id, status="Active", total_stops=2)
            stop_one = Stop(stop_code="GPS-A", stop_name="Start", latitude=10.0, longitude=76.0, radius=100, status="Active")
            stop_two = Stop(stop_code="GPS-B", stop_name="End", latitude=10.1, longitude=76.1, radius=100, status="Active")
            database_session.add_all([route, stop_one, stop_two])
            database_session.flush()
            database_session.add_all([
                RouteStop(route_id=route.id, stop_id=stop_one.id, sequence=1),
                RouteStop(route_id=route.id, stop_id=stop_two.id, sequence=2),
            ])
            database_session.commit()

            timestamp = datetime(2026, 8, 24, 8, 30, tzinfo=timezone.utc)
            trip_id = _update_active_trip_from_vehicle(
                database_session,
                {
                    "latitude": 10.0,
                    "longitude": 76.0,
                    "speed_kmh": 18.0,
                    "accuracy": 8.0,
                    "fix_time": timestamp,
                    "valid": True,
                    "ignition": True,
                },
                bus.id,
                timestamp,
            )
            database_session.commit()

            trip = database_session.get(LiveTrip, trip_id)
            self.assertIsNotNone(trip)
            self.assertEqual(trip.current_location_source, "vehicle_gps")
            self.assertEqual(trip.current_route_stop_id, route.route_stops[0].id)
            self.assertEqual(trip.current_stop_status, "Arrived")

            # The legacy endpoints now only attach/detach phone sharing. They
            # must return the GPS-created session and never end it.
            mobile_target = start_trip(None, user, database_session)
            stop_result = stop_trip(TripStopRequest(trip_id=trip_id), database_session, user)
            database_session.refresh(trip)
            self.assertEqual(mobile_target["id"], trip_id)
            self.assertIn("Vehicle GPS tracking continues", stop_result["message"])
            self.assertIsNone(trip.ended_at)

            # A normal 20-second update at the terminal must flip the same
            # still-running trip even when a provider labels a parked final
            # coordinate as "valid: false".
            final_fix = timestamp + timedelta(seconds=20)
            _update_active_trip_from_vehicle(
                database_session,
                {
                    "latitude": stop_two.latitude,
                    "longitude": stop_two.longitude,
                    "speed_kmh": 0.0,
                    "accuracy": 8.0,
                    "fix_time": final_fix,
                    "valid": False,
                    "ignition": True,
                },
                bus.id,
                final_fix,
            )
            database_session.commit()
            database_session.refresh(trip)
            self.assertEqual(trip.route_direction, "reverse")
            self.assertEqual(trip.terminal_stop_id, stop_two.id)
            self.assertIsNone(trip.ended_at)

    def test_ignition_off_heartbeat_creates_continuous_tracking_state(self) -> None:
        with self.session_factory() as database_session:
            user = User(username="parked-module-driver", password_hash="unused", full_name="Parked Module Driver", role="Driver", status="Active")
            bus = Bus(bus_number="GPS-02", registration_number="GPS-REG-02", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            database_session.add_all([user, bus])
            database_session.flush()
            driver = Driver(user_id=user.id, driver_code="GPS-PARKED", license_number="GPS-PARKED-LIC", license_expiry=date(2030, 1, 1), status="Available", bus_id=bus.id)
            database_session.add(driver)
            database_session.flush()
            route = Route(route_code="GPS-PARKED", route_name="Parked GPS Route", bus_id=bus.id, driver_id=driver.id, status="Active", total_stops=2)
            start = Stop(stop_code="GPS-PARKED-A", stop_name="Parked Start", latitude=10.0, longitude=76.0, radius=100, status="Active")
            end = Stop(stop_code="GPS-PARKED-B", stop_name="Parked End", latitude=10.1, longitude=76.1, radius=100, status="Active")
            database_session.add_all([route, start, end])
            database_session.flush()
            database_session.add_all([
                RouteStop(route_id=route.id, stop_id=start.id, sequence=1),
                RouteStop(route_id=route.id, stop_id=end.id, sequence=2),
            ])
            database_session.commit()
            timestamp = datetime(2026, 8, 24, 8, 30, tzinfo=timezone.utc)

            trip_id = _update_active_trip_from_vehicle(
                database_session,
                {"latitude": 10.0, "longitude": 76.0, "speed_kmh": 0.0, "accuracy": 8.0, "fix_time": timestamp, "valid": True, "ignition": False},
                bus.id,
                timestamp,
            )

            database_session.commit()

            trip = database_session.get(LiveTrip, trip_id)
            self.assertIsNotNone(trip)
            self.assertEqual(trip.current_location_source, "vehicle_gps")
            self.assertEqual(trip.current_route_stop_id, route.route_stops[0].id)
            self.assertEqual(trip.current_stop_status, "Arrived")

            # A parked module's expected two-minute heartbeat uses exactly
            # the same terminal reversal path.
            final_fix = timestamp + timedelta(minutes=2)
            _update_active_trip_from_vehicle(
                database_session,
                {
                    "latitude": end.latitude,
                    "longitude": end.longitude,
                    "speed_kmh": 0.0,
                    "accuracy": 8.0,
                    "fix_time": final_fix,
                    "valid": True,
                    "ignition": False,
                },
                bus.id,
                final_fix,
            )
            database_session.commit()
            database_session.refresh(trip)
            self.assertEqual(trip.route_direction, "reverse")
            self.assertEqual(trip.terminal_stop_id, end.id)
            self.assertIsNone(trip.ended_at)

            # A recent ignition-off heartbeat is a valid vehicle position,
            # not an offline/missing-GPS condition.
            self.assertTrue(
                vehicle_gps_is_authoritative(
                    type("GPSState", (), {
                        "ignition": False,
                        "fix_time": final_fix,
                        "received_at": final_fix,
                    })(),
                    now=final_fix,
                )
            )

            # Simulate a restart after the final coordinate was saved but
            # before its route transition committed. The first repeated
            # ignition-off heartbeat must reconcile immediately; it must not
            # wait for a second/newer coordinate.
            trip.route_direction = "forward"
            trip.terminal_reached_at = None
            trip.terminal_stop_id = None
            trip.current_route_stop_id = route.route_stops[-1].id
            trip.current_stop_status = "Arrived"
            trip.current_latitude = end.latitude
            trip.current_longitude = end.longitude
            trip.last_location_update = final_fix
            database_session.commit()
            _update_active_trip_from_vehicle(
                database_session,
                {
                    "latitude": end.latitude,
                    "longitude": end.longitude,
                    "speed_kmh": 0.0,
                    "accuracy": 8.0,
                    "fix_time": final_fix,
                    "valid": False,
                    "ignition": False,
                },
                bus.id,
                final_fix,
            )
            database_session.commit()
            database_session.refresh(trip)
            self.assertEqual(trip.route_direction, "reverse")
            self.assertEqual(trip.terminal_stop_id, end.id)

    def test_delayed_final_stop_fix_reverses_the_running_trip(self) -> None:
        """A reporting gap must not prevent the next terminal fix reversing."""

        with self.session_factory() as database_session:
            user = User(username="gap-driver", password_hash="unused", full_name="Gap Driver", role="Driver", status="Active")
            bus = Bus(bus_number="GPS-GAP", registration_number="GPS-GAP-REG", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            database_session.add_all([user, bus])
            database_session.flush()
            driver = Driver(user_id=user.id, driver_code="GPS-GAP-DRV", license_number="GPS-GAP-LIC", license_expiry=date(2030, 1, 1), status="Available", bus_id=bus.id)
            database_session.add(driver)
            database_session.flush()
            route = Route(route_code="GPS-GAP", route_name="GPS Gap Route", bus_id=bus.id, driver_id=driver.id, status="Active", total_stops=2)
            start = Stop(stop_code="GPS-GAP-A", stop_name="Gap Start", latitude=10.0, longitude=76.0, radius=100, status="Active")
            end = Stop(stop_code="GPS-GAP-B", stop_name="Gap End", latitude=10.1, longitude=76.1, radius=100, status="Active")
            database_session.add_all([route, start, end])
            database_session.flush()
            database_session.add_all([
                RouteStop(route_id=route.id, stop_id=start.id, sequence=1),
                RouteStop(route_id=route.id, stop_id=end.id, sequence=2),
            ])
            database_session.commit()

            first_fix = datetime(2026, 8, 24, 8, 30, tzinfo=timezone.utc)
            trip_id = _update_active_trip_from_vehicle(
                database_session,
                {"latitude": start.latitude, "longitude": start.longitude, "speed_kmh": 0.0, "accuracy": 8.0, "fix_time": first_fix, "valid": True, "ignition": True},
                bus.id,
                first_fix,
            )
            database_session.commit()

            # Five minutes later, the next valid module coordinate arrives at
            # the final stop. Its age does not affect route progression.
            final_fix = first_fix + timedelta(minutes=5)
            _update_active_trip_from_vehicle(
                database_session,
                {"latitude": end.latitude, "longitude": end.longitude, "speed_kmh": 0.0, "accuracy": 8.0, "fix_time": final_fix, "valid": True, "ignition": False},
                bus.id,
                final_fix,
            )
            database_session.commit()

            trip = database_session.get(LiveTrip, trip_id)
            self.assertEqual(trip.route_direction, "reverse")
            self.assertEqual(trip.terminal_stop_id, end.id)
            self.assertEqual(
                trip.last_location_update.replace(tzinfo=timezone.utc),
                final_fix,
            )
            self.assertIsNone(trip.ended_at)


if __name__ == "__main__":
    unittest.main()
