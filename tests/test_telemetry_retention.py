"""Regression coverage for bounded GPS-coordinate retention."""

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
from backend.routes.models_tracking import (
    BusGPSState,
    LiveLocation,
    LiveTrip,
    ProviderGPSPosition,
    TripStopEvent,
)
from backend.services.telemetry_retention import (
    discard_completed_trip_coordinates,
    purge_provider_position_history,
    trim_active_trip_location_history,
)


class TelemetryRetentionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / (
            f"bus_tracker_retention_{uuid4().hex}.db"
        )
        cls.test_engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.test_engine, autoflush=False)
        Base.metadata.create_all(bind=cls.test_engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.test_engine)
        cls.test_engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_completed_trip_keeps_stop_times_but_not_coordinates(self) -> None:
        now = datetime.now(timezone.utc)
        with self.session_factory() as database_session:
            user = User(
                username="retention-driver",
                password_hash="not-used-by-direct-test",
                full_name="Retention Driver",
                role="Driver",
                status="Active",
            )
            bus = Bus(
                bus_number="RET-001", registration_number="RET-REG-001", capacity=40,
                manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active",
            )
            database_session.add_all([user, bus])
            database_session.flush()
            driver = Driver(
                user_id=user.id, driver_code="RETDRV", license_number="RET-LIC",
                license_expiry=date(2030, 1, 1), status="Available", bus_id=bus.id,
            )
            route = Route(
                route_code="RET-ROUTE", route_name="Retention Route", bus_id=bus.id,
                driver_id=driver.id, status="Active", total_stops=1,
            )
            stop = Stop(stop_code="RET-STOP", stop_name="Retention Stop", radius=50, status="Active")
            database_session.add_all([driver, route, stop])
            database_session.flush()
            route_stop = RouteStop(route_id=route.id, stop_id=stop.id, sequence=1)
            database_session.add(route_stop)
            database_session.flush()

            active_trip = LiveTrip(driver_id=driver.id, bus_id=bus.id, route_id=route.id)
            database_session.add(active_trip)
            database_session.flush()
            for source in ("mobile", "mobile", "mobile", "vehicle_gps", "vehicle_gps", "vehicle_gps"):
                database_session.add(LiveLocation(
                    trip_id=active_trip.id, latitude=10.0, longitude=76.0,
                    recorded_at=now, source=source,
                ))
            database_session.flush()
            self.assertEqual(trim_active_trip_location_history(database_session, active_trip.id), 2)
            self.assertEqual(
                database_session.query(LiveLocation).filter(LiveLocation.trip_id == active_trip.id).count(),
                4,
            )

            active_trip.status = "Completed"
            active_trip.ended_at = now
            active_trip.current_latitude = 10.0
            active_trip.current_longitude = 76.0
            database_session.add(TripStopEvent(
                trip_id=active_trip.id, route_stop_id=route_stop.id, stop_id=stop.id,
                event_type="Arrived", occurred_at=now, stop_code_snapshot=stop.stop_code,
                stop_name_snapshot=stop.stop_name, route_sequence_snapshot=route_stop.sequence,
                latitude=10.0, longitude=76.0, distance_meters=4.0, radius_meters=50.0,
            ))

            expired = ProviderGPSPosition(
                bus_id=bus.id, external_device_id="RET-GPS", latitude=10.0, longitude=76.0,
                received_at=now - timedelta(days=2), raw_payload="{}",
            )
            protected = ProviderGPSPosition(
                bus_id=bus.id, external_device_id="RET-GPS", latitude=10.1, longitude=76.1,
                received_at=now - timedelta(days=2), raw_payload="{}",
            )
            database_session.add_all([expired, protected])
            database_session.flush()
            database_session.add(BusGPSState(
                bus_id=bus.id, provider_position_id=protected.id, external_device_id="RET-GPS",
                latitude=protected.latitude, longitude=protected.longitude, received_at=now,
                raw_payload="{}",
            ))
            discard_completed_trip_coordinates(database_session, active_trip)
            self.assertEqual(purge_provider_position_history(database_session, now=now), 1)
            database_session.commit()

            self.assertEqual(
                database_session.query(LiveLocation).filter(LiveLocation.trip_id == active_trip.id).count(),
                0,
            )
            event = database_session.query(TripStopEvent).one()
            self.assertEqual(
                event.occurred_at.replace(tzinfo=timezone.utc),
                now,
            )
            self.assertEqual(event.stop_name_snapshot, "Retention Stop")
            self.assertIsNone(event.latitude)
            self.assertIsNone(event.distance_meters)
            self.assertIsNone(active_trip.current_latitude)
            self.assertIsNone(active_trip.current_longitude)
            self.assertEqual(database_session.query(ProviderGPSPosition).count(), 1)
            self.assertEqual(database_session.query(BusGPSState).one().provider_position_id, protected.id)


if __name__ == "__main__":
    unittest.main()
