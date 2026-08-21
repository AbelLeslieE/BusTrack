"""Regression coverage for PostgreSQL-safe driver deletion."""

from __future__ import annotations

from datetime import date
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: E402, F401
import backend.routes.models_tracking  # noqa: E402, F401
from backend.database import Base  # noqa: E402
from backend.models import Bus, Driver, FleetNotification, Route, User  # noqa: E402
from backend.routes.driver import delete_driver  # noqa: E402
from backend.routes.models_tracking import LiveLocation, LiveTrip  # noqa: E402


class DriverDeletionIntegrityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / (
            f"bus_tracker_driver_delete_{uuid4().hex}.db"
        )
        cls.test_engine = create_engine(
            f"sqlite:///{cls.test_database.as_posix()}",
            connect_args={"check_same_thread": False},
        )
        cls.session_factory = sessionmaker(bind=cls.test_engine, autoflush=False)
        Base.metadata.create_all(bind=cls.test_engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.test_engine)
        cls.test_engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_driver_delete_removes_required_tracking_rows_and_keeps_feedback(self) -> None:
        with self.session_factory() as database_session:
            user = User(
                username="delete-driver-test",
                password_hash="not-used-by-this-direct-route-test",
                full_name="Delete Driver Test",
                role="Driver",
                status="Active",
            )
            bus = Bus(
                bus_number="DEL-001",
                registration_number="DEL-REG-001",
                capacity=40,
                manufacturer="Test",
                model="Coach",
                year=2026,
                fuel_type="Diesel",
                status="Active",
            )
            database_session.add_all([user, bus])
            database_session.flush()

            driver = Driver(
                user_id=user.id,
                driver_code="DELDRV",
                license_number="DEL-LIC",
                license_expiry=date(2030, 1, 1),
                status="Available",
                bus_id=bus.id,
            )
            database_session.add(driver)
            database_session.flush()
            bus.driver_id = driver.id

            route = Route(
                route_code="DEL-ROUTE",
                route_name="Delete Driver Route",
                bus_id=bus.id,
                driver_id=driver.id,
                status="Active",
                total_stops=0,
            )
            database_session.add(route)
            database_session.flush()

            trip = LiveTrip(driver_id=driver.id, bus_id=bus.id, route_id=route.id)
            database_session.add(trip)
            database_session.flush()
            database_session.add_all([
                LiveLocation(trip_id=trip.id, latitude=10.0, longitude=76.0),
                FleetNotification(
                    feedback_type="Safety",
                    title="Retain feedback",
                    driver_id=driver.id,
                    bus_id=bus.id,
                    route_id=route.id,
                    trip_id=trip.id,
                ),
            ])
            database_session.commit()

            driver_id = driver.id
            trip_id = trip.id
            response = delete_driver(driver.id, database_session, object())
            self.assertEqual(response["message"], "Driver deleted successfully.")

        with self.session_factory() as database_session:
            self.assertIsNone(database_session.get(Driver, driver_id))
            self.assertEqual(
                database_session.query(LiveTrip).filter(LiveTrip.id == trip_id).count(),
                0,
            )
            self.assertEqual(
                database_session.query(LiveLocation)
                .filter(LiveLocation.trip_id == trip_id)
                .count(),
                0,
            )
            feedback = database_session.query(FleetNotification).one()
            self.assertIsNone(feedback.driver_id)
            self.assertIsNone(feedback.trip_id)


if __name__ == "__main__":
    unittest.main()
