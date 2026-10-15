"""Regression coverage for driver feedback and notification ownership."""

from datetime import date, datetime, timezone
from pathlib import Path
import tempfile
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
from backend.database import Base
from backend.models import Bus, Driver, FleetNotification, Route, User
from backend.routes.models_tracking import LiveTrip
from backend.routes.notifications import (
    create_driver_feedback, list_notifications, update_notification_status,
)
from backend.schemas import NotificationFeedbackCreate, NotificationStatusUpdate


class DriverFeedbackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="driver-feedback-")
        self.engine = create_engine(f"sqlite:///{(Path(self.temp.name) / 'test.db').as_posix()}")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, autoflush=False)()
        self.admin = User(username="admin", full_name="Admin", password_hash="unused", role="Admin", status="Active")
        self.driver_user = User(username="driver", full_name="Driver", password_hash="unused", role="Driver", status="Active")
        self.bus = Bus(bus_number="FB1", registration_number="FB1", capacity=40,
                       manufacturer="Test", model="Test", year=2026, fuel_type="Diesel", status="Active")
        self.db.add_all([self.admin, self.driver_user, self.bus])
        self.db.flush()
        self.driver = Driver(user_id=self.driver_user.id, driver_code="FB1", license_number="FB1",
                             license_expiry=date(2030, 1, 1), bus_id=self.bus.id)
        self.db.add(self.driver)
        self.db.flush()
        self.bus.driver_id = self.driver.id
        self.route = Route(route_code="FB1", route_name="Feedback Route", bus_id=self.bus.id,
                           driver_id=self.driver.id, status="Active", total_stops=0)
        self.db.add(self.route)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def feedback(self):
        return create_driver_feedback(NotificationFeedbackCreate(feedback_type="delay", message="Traffic ahead"),
                                      self.driver_user, self.db)["notification"]

    def test_running_trip_attaches_exact_route_and_admin_can_acknowledge(self):
        trip = LiveTrip(driver_id=self.driver.id, bus_id=self.bus.id, route_id=self.route.id,
                        status="Running", route_direction="forward")
        self.db.add(trip)
        self.db.commit()
        result = self.feedback()
        self.assertEqual((result["trip_id"], result["route_id"], result["bus_id"]),
                         (trip.id, self.route.id, self.bus.id))
        self.assertEqual(result["message"], "Traffic ahead")
        self.assertEqual(list_notifications(100, None, self.admin, self.db)["total"], 1)
        acknowledged = update_notification_status(result["id"], NotificationStatusUpdate(status="Acknowledged"),
                                                   self.admin, self.db)
        self.assertEqual(acknowledged["status"], "Acknowledged")
        self.assertEqual(list_notifications(100, None, self.driver_user, self.db)["notifications"][0]["status"],
                         "Acknowledged")

    def test_stopped_trip_does_not_claim_current_trip(self):
        self.db.add(LiveTrip(driver_id=self.driver.id, bus_id=self.bus.id, route_id=self.route.id,
                             status="Stopped", ended_at=None))
        self.db.commit()
        result = self.feedback()
        self.assertIsNone(result["trip_id"])
        self.assertEqual(result["route_id"], self.route.id)

    def test_ambiguous_routes_do_not_pick_an_arbitrary_route(self):
        self.db.add(Route(route_code="FB2", route_name="Second Feedback Route", bus_id=self.bus.id,
                          driver_id=self.driver.id, status="Active", total_stops=0))
        self.db.commit()
        result = self.feedback()
        self.assertIsNone(result["route_id"])
        self.assertEqual(result["bus_id"], self.bus.id)

    def test_bus_assigned_driver_and_document_reminder_do_not_block_feedback(self):
        self.route.driver_id = None
        self.db.add(FleetNotification(feedback_type="document_expiry", title="Permit due",
                                      driver_id=self.driver.id, bus_id=self.bus.id,
                                      created_at=datetime.now(timezone.utc)))
        self.db.commit()
        result = self.feedback()
        self.assertEqual(result["route_id"], self.route.id)
        driver_list = list_notifications(100, None, self.driver_user, self.db)
        self.assertEqual(driver_list["total"], 1)
        self.assertEqual(driver_list["notifications"][0]["feedback_type"], "delay")
        self.assertEqual(list_notifications(100, None, self.admin, self.db)["total"], 2)

    def test_recent_feedback_is_throttled(self):
        self.feedback()
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as error:
            self.feedback()
        self.assertEqual(error.exception.status_code, 429)


if __name__ == "__main__":
    unittest.main()
