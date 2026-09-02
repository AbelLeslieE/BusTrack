"""Phone GPS can create the same live route state as the installed module."""

from __future__ import annotations

from datetime import date, timedelta
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
from backend.routes.gps import start_trip, update_location
from backend.routes.gps_provider import _update_active_trip_from_vehicle, get_driver_tracking_source
from backend.routes.models_tracking import LiveLocation, LiveTrip
from backend.schemas_tracking import TripStartRequest


class MobileGpsFallbackTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / f"bus_tracker_mobile_fallback_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_phone_gps_creates_and_updates_a_live_trip_without_provider_data(self) -> None:
        with self.session_factory() as db:
            user = User(username="phone-driver", password_hash="unused", full_name="Phone Driver", role="Driver", status="Active")
            bus = Bus(bus_number="PHONE-01", registration_number="PHONE-REG", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            db.add_all([user, bus])
            db.flush()
            driver = Driver(user_id=user.id, driver_code="PHONE-DRV", license_number="PHONE-LIC", license_expiry=date(2030, 1, 1), status="Available", bus_id=bus.id)
            db.add(driver)
            db.flush()
            route = Route(route_code="PHONE-R", route_name="Phone GPS Route", bus_id=bus.id, driver_id=driver.id, status="Active", total_stops=2)
            start = Stop(stop_code="PHONE-A", stop_name="Start", latitude=10.0, longitude=76.0, radius=100, status="Active")
            end = Stop(stop_code="PHONE-B", stop_name="End", latitude=10.1, longitude=76.1, radius=100, status="Active")
            db.add_all([route, start, end])
            db.flush()
            db.add_all([
                RouteStop(route_id=route.id, stop_id=start.id, sequence=1),
                RouteStop(route_id=route.id, stop_id=end.id, sequence=2),
            ])
            db.commit()

            response = start_trip(
                TripStartRequest(latitude=start.latitude, longitude=start.longitude, accuracy=8.0),
                user,
                db,
            )
            trip = db.get(LiveTrip, response["id"])
            self.assertEqual(trip.current_location_source, "mobile")
            self.assertEqual(trip.current_route_stop_id, route.route_stops[0].id)
            self.assertEqual(trip.current_stop_status, "Arrived")
            self.assertEqual(
                db.query(LiveLocation).filter(LiveLocation.trip_id == trip.id).one().source,
                "mobile",
            )

            source = get_driver_tracking_source(user, db)
            self.assertEqual(source["tracking_source"], "mobile")
            self.assertEqual(source["active_trip_id"], trip.id)

            # A newer coordinate from the installed provider must take over
            # the same trip rather than creating a competing route state.
            provider_timestamp = trip.last_location_update + timedelta(seconds=20)
            _update_active_trip_from_vehicle(
                db,
                {
                    "latitude": end.latitude,
                    "longitude": end.longitude,
                    "speed_kmh": 0.0,
                    "accuracy": 8.0,
                    "fix_time": provider_timestamp,
                    "valid": True,
                    "ignition": True,
                },
                bus.id,
                provider_timestamp,
            )
            db.commit()
            db.refresh(trip)
            self.assertEqual(trip.route_direction, "reverse")
            self.assertEqual(trip.current_location_source, "vehicle_gps")


if __name__ == "__main__":
    unittest.main()
