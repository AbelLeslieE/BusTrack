"""Regression coverage for atomic, role-aware account deletion."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.models_documents  # noqa: F401
import backend.models_route_studio  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import (
    APIRequestLog,
    AuditEvent,
    Bus,
    BusPass,
    Driver,
    FleetNotification,
    PassIdentity,
    Route,
    Student,
    User,
    UserSession,
)
from backend.models_documents import BusDocument
from backend.models_route_studio import TraceSession, TracerAssignment
from backend.routes.models_tracking import (
    GPSProviderTranslationConfig,
    LiveLocation,
    LiveTrip,
)
from backend.routes.users import delete_user
from backend.services.user_deletion import lock_user_account_writes


class UserDeletionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.database_path = Path(tempfile.gettempdir()) / f"bustrack_user_delete_{uuid4().hex}.db"
        self.engine = create_engine(
            f"sqlite:///{self.database_path.as_posix()}",
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(self.engine, "connect")
        def enable_foreign_keys(connection, _record):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, autoflush=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()
        self.database_path.unlink(missing_ok=True)

    @staticmethod
    def user(username: str, role: str = "Technician", status: str = "Active") -> User:
        return User(
            username=username,
            password_hash="not-used-by-direct-route-test",
            full_name=username.replace("-", " ").title(),
            role=role,
            status=status,
        )

    @staticmethod
    def bus(number: str) -> Bus:
        return Bus(
            bus_number=number,
            registration_number=f"REG-{number}",
            capacity=40,
            manufacturer="Test",
            model="Coach",
            year=2026,
            fuel_type="Diesel",
            status="Active",
        )

    def add_admin(self, db, username: str = "delete-admin") -> User:
        admin = self.user(username, "Admin")
        db.add(admin)
        db.flush()
        return admin

    def test_deletion_detaches_shared_history_and_is_idempotent(self) -> None:
        with self.sessions() as db:
            admin = self.add_admin(db)
            target = self.user("linked-technician")
            bus = self.bus("USR-001")
            db.add_all([target, bus])
            db.flush()
            route = Route(
                route_code="USR-R01", route_name="User delete route", bus_id=bus.id,
                status="Active", total_stops=0,
            )
            db.add(route)
            db.flush()
            trip = LiveTrip(bus_id=bus.id, route_id=route.id, ended_by_user_id=target.id)
            db.add(trip)
            db.flush()
            db.add_all([
                UserSession(
                    session_id="delete-session", user_id=target.id,
                    expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
                ),
                AuditEvent(category="test", action="before_delete", actor_user_id=target.id),
                APIRequestLog(
                    method="DELETE", path="/test", status_code=200, duration_ms=1,
                    actor_user_id=target.id,
                ),
                BusDocument(bus_id=bus.id, document_type="Permit", updated_by=target.id),
                FleetNotification(
                    feedback_type="Safety", title="Keep history", acknowledged_by=target.id,
                ),
                GPSProviderTranslationConfig(
                    id=1, field_paths_json="{}", updated_by_user_id=target.id,
                ),
            ])
            db.commit()
            target_id = target.id

            result = delete_user(target_id, db, admin)
            self.assertTrue(result["deleted"])
            self.assertEqual(result["cleanup"]["sessions_deleted"], 1)
            retry = delete_user(target_id, db, admin)
            self.assertTrue(retry["already_deleted"])

        with self.sessions() as db:
            self.assertIsNone(db.get(User, target_id))
            self.assertEqual(db.query(UserSession).filter_by(user_id=target_id).count(), 0)
            self.assertIsNone(db.query(AuditEvent).filter_by(action="before_delete").one().actor_user_id)
            self.assertIsNone(db.query(APIRequestLog).one().actor_user_id)
            self.assertIsNone(db.query(BusDocument).one().updated_by)
            self.assertIsNone(db.query(FleetNotification).one().acknowledged_by)
            self.assertIsNone(db.query(GPSProviderTranslationConfig).one().updated_by_user_id)
            self.assertIsNone(db.query(LiveTrip).one().ended_by_user_id)
            self.assertEqual(db.query(AuditEvent).filter_by(action="user_deleted").count(), 1)

    def test_driver_deletion_detaches_and_preserves_tracking_history(self) -> None:
        with self.sessions() as db:
            admin = self.add_admin(db)
            target = self.user("linked-driver", "Driver")
            bus = self.bus("USR-002")
            db.add_all([target, bus])
            db.flush()
            driver = Driver(
                user_id=target.id, driver_code="USRDRV", license_number="USR-LIC",
                license_expiry=date(2032, 1, 1), status="Available", bus_id=bus.id,
            )
            db.add(driver)
            db.flush()
            bus.driver_id = driver.id
            route = Route(
                route_code="USR-R02", route_name="Driver delete route", bus_id=bus.id,
                driver_id=driver.id, status="Active", total_stops=0,
            )
            db.add(route)
            db.flush()
            trip = LiveTrip(driver_id=driver.id, bus_id=bus.id, route_id=route.id)
            db.add(trip)
            db.flush()
            db.add_all([
                LiveLocation(trip_id=trip.id, latitude=10.0, longitude=76.0),
                FleetNotification(
                    feedback_type="Safety", title="Retained feedback", driver_id=driver.id,
                    trip_id=trip.id,
                ),
            ])
            db.commit()
            target_id, driver_id = target.id, driver.id
            result = delete_user(target_id, db, admin)
            self.assertTrue(result["deleted"])

        with self.sessions() as db:
            self.assertIsNone(db.get(User, target_id))
            self.assertIsNone(db.get(Driver, driver_id))
            trip = db.query(LiveTrip).one()
            self.assertIsNone(trip.driver_id)
            self.assertEqual(db.query(LiveLocation).count(), 1)
            self.assertIsNone(db.query(Route).one().driver_id)
            feedback = db.query(FleetNotification).one()
            self.assertIsNone(feedback.driver_id)
            self.assertEqual(feedback.trip_id, trip.id)

    def test_student_deletion_removes_pass_and_identity(self) -> None:
        with self.sessions() as db:
            admin = self.add_admin(db)
            target = self.user("linked-student", "User")
            db.add(target)
            db.flush()
            student = Student(user_id=target.id, student_code="USRSTU")
            db.add(student)
            db.flush()
            db.add_all([
                BusPass(student_id=student.id, pass_number="PASS-USR", status="Active"),
                PassIdentity(
                    student_id=student.id, official_name="Linked Student",
                    department="CSE", photo_base64="AA==", updated_by=admin.id,
                ),
            ])
            db.commit()
            target_id, student_id = target.id, student.id
            delete_user(target_id, db, admin)

        with self.sessions() as db:
            self.assertIsNone(db.get(User, target_id))
            self.assertIsNone(db.get(Student, student_id))
            self.assertEqual(db.query(BusPass).count(), 0)
            self.assertEqual(db.query(PassIdentity).count(), 0)

    def test_tracer_deletion_removes_assignment_and_closes_active_trace(self) -> None:
        with self.sessions() as db:
            admin = self.add_admin(db)
            tracer = self.user("linked-tracer", "Tracer")
            bus = self.bus("USR-003")
            db.add_all([tracer, bus])
            db.flush()
            db.add_all([
                TracerAssignment(user_id=tracer.id, bus_id=bus.id, assigned_by=admin.id),
                TraceSession(
                    id=str(uuid4()), user_id=tracer.id, bus_id=bus.id,
                    status="RECORDING", name="Keep completed geometry",
                ),
            ])
            db.commit()
            tracer_id = tracer.id
            delete_user(tracer_id, db, admin)

        with self.sessions() as db:
            self.assertIsNone(db.get(User, tracer_id))
            self.assertEqual(db.query(TracerAssignment).count(), 0)
            trace = db.query(TraceSession).one()
            self.assertEqual(trace.status, "DISCARDED")
            self.assertIsNotNone(trace.ended_at)

    def test_self_and_last_active_admin_are_protected_but_inactive_admin_can_be_deleted(self) -> None:
        with self.sessions() as db:
            admin = self.add_admin(db)
            inactive = self.user("inactive-admin", "Admin", "Inactive")
            db.add(inactive)
            db.commit()

            with self.assertRaisesRegex(HTTPException, "own account"):
                delete_user(admin.id, db, admin)
            db.rollback()

            inactive_id = inactive.id
            result = delete_user(inactive_id, db, admin)
            self.assertTrue(result["deleted"])
            self.assertIsNone(db.get(User, inactive_id))

            other_active = self.add_admin(db, "other-active-admin")
            db.commit()
            delete_user(other_active.id, db, admin)
            with self.assertRaisesRegex(HTTPException, "last active administrator"):
                # Use a detached stand-in so the self-delete guard does not
                # hide the last-admin invariant under test.
                delete_user(admin.id, db, self.user("external-admin", "Admin"))

    def test_account_write_lock_is_safe_inside_an_existing_transaction(self) -> None:
        with self.sessions() as db:
            admin = self.add_admin(db)
            db.flush()
            lock_user_account_writes(db)
            lock_user_account_writes(db)
            self.assertIsNotNone(db.get(User, admin.id))


if __name__ == "__main__":
    unittest.main()
