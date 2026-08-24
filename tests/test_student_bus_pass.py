"""Regression coverage for the authenticated Student Bus Pass response."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
from backend.database import Base
from backend.models import Bus, BusPass, Route, Stop, Student, User
from backend.routes.bus_passes import delete_bus_pass, issue_bus_pass, update_bus_pass
from backend.routes.student import get_current_student_bus_pass
from backend.schemas import BusPassIssue, BusPassUpdate


class StudentBusPassTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / f"bus_tracker_bus_pass_{uuid4().hex}.db"
        cls.test_engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.test_engine, autoflush=False)
        Base.metadata.create_all(bind=cls.test_engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.test_engine)
        cls.test_engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_pass_uses_authenticated_student_and_authoritative_assignment(self) -> None:
        with self.session_factory() as database_session:
            user_one = User(username="pass-owner", password_hash="unused", full_name="Pass Owner", role="User", status="Active")
            user_two = User(username="other-student", password_hash="unused", full_name="Other Student", role="User", status="Active")
            bus = Bus(bus_number="PASS-01", registration_number="PASS-REG-01", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            stop = Stop(stop_code="PASS-STOP", stop_name="Pass Stop", status="Active")
            database_session.add_all([user_one, user_two, bus, stop])
            database_session.flush()
            route = Route(route_code="PASS-R", route_name="Pass Route", bus_id=bus.id, status="Active", total_stops=0)
            database_session.add(route)
            database_session.flush()
            owner = Student(user_id=user_one.id, student_code="PASS-OWNER", route_id=route.id, bus_id=bus.id, stop_id=stop.id)
            other = Student(user_id=user_two.id, student_code="PASS-OTHER", route_id=None, bus_id=None, stop_id=None)
            database_session.add_all([owner, other])
            database_session.flush()
            database_session.add_all([
                BusPass(student_id=owner.id, pass_number="BP-OWNER", status="Active", valid_from=date.today() - timedelta(days=1), valid_until=date.today() + timedelta(days=30)),
                BusPass(student_id=other.id, pass_number="BP-OTHER", status="Active", valid_until=date.today() - timedelta(days=1)),
            ])
            database_session.commit()

            owner_result = get_current_student_bus_pass(user_one, database_session)
            other_result = get_current_student_bus_pass(user_two, database_session)

            self.assertEqual(owner_result["student"]["id"], owner.id)
            self.assertEqual(owner_result["bus_pass"]["pass_number"], "BP-OWNER")
            self.assertTrue(owner_result["bus_pass"]["is_valid"])
            self.assertEqual(owner_result["alerts"][0]["type"], "bus_pass_expiring")
            self.assertEqual(owner_result["transport"]["bus"]["bus_number"], "PASS-01")
            self.assertEqual(other_result["bus_pass"]["pass_number"], "BP-OTHER")
            self.assertEqual(other_result["bus_pass"]["effective_status"], "Expired")
            self.assertIsNone(other_result["transport"]["bus"])

    def test_admin_issues_yearly_pass_using_existing_assignment(self) -> None:
        with self.session_factory() as database_session:
            admin = User(username="pass-admin", password_hash="unused", full_name="Pass Admin", role="Admin", status="Active")
            student_user = User(username="issue-student", password_hash="unused", full_name="Issue Student", role="User", status="Active")
            bus = Bus(bus_number="ISSUE-01", registration_number="ISSUE-REG-01", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            database_session.add_all([admin, student_user, bus])
            database_session.flush()
            route = Route(route_code="ISSUE-R", route_name="Issue Route", bus_id=bus.id, status="Active", total_stops=0)
            database_session.add(route)
            database_session.flush()
            student = Student(user_id=student_user.id, student_code="ISSUE-STUDENT", route_id=route.id, bus_id=bus.id, stop_id=None)
            database_session.add(student)
            database_session.commit()

            issued = issue_bus_pass(
                BusPassIssue(student_id=student.id, valid_from=date(2026, 8, 15), validity_period="Two Semesters", academic_year="2026-2027"),
                database_session,
                admin,
            )
            self.assertEqual(issued["bus_pass"]["valid_until"], date(2027, 8, 15))
            self.assertEqual(issued["bus_pass"]["validity_period"], "Two Semesters")
            self.assertEqual(issued["transport"]["bus_number"], "ISSUE-01")

            suspended = update_bus_pass(
                issued["bus_pass"]["id"],
                BusPassUpdate(status="Suspended", academic_year="2026-2027"),
                database_session,
                admin,
            )
            self.assertEqual(suspended["bus_pass"]["effective_status"], "Suspended")

            day_pass = update_bus_pass(
                issued["bus_pass"]["id"],
                BusPassUpdate(
                    valid_from=date(2026, 9, 1),
                    valid_until=date(2026, 9, 1),
                    validity_period="One Day",
                    academic_year=None,
                    status="Active",
                ),
                database_session,
                admin,
            )
            self.assertEqual(day_pass["bus_pass"]["valid_from"], date(2026, 9, 1))
            self.assertEqual(day_pass["bus_pass"]["valid_until"], date(2026, 9, 1))
            self.assertEqual(day_pass["bus_pass"]["validity_period"], "One Day")

            delete_bus_pass(issued["bus_pass"]["id"], database_session, admin)
            self.assertIsNone(database_session.get(BusPass, issued["bus_pass"]["id"]))
            self.assertEqual(database_session.get(Student, student.id).route_id, route.id)


if __name__ == "__main__":
    unittest.main()
