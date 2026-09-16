"""Regression coverage for server-generated BusTrack identifiers."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Bus, Driver, Route, Student, User
from backend.routes.buses import create_bus, get_next_bus_number, update_bus
from backend.routes.driver import update_driver
from backend.routes.routes import create_route, get_next_route_code, update_route
from backend.routes.users import create_user, get_next_user_codes, update_user
from backend.schemas import (
    BusCreate,
    BusUpdate,
    DriverUpdate,
    RouteCreate,
    RouteUpdate,
    UserCreate,
    UserUpdate,
)


class GeneratedCodesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.database_path = Path(tempfile.gettempdir()) / f"generated_codes_{uuid4().hex}.db"
        cls.engine = create_engine(
            f"sqlite:///{cls.database_path.as_posix()}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.database_path.unlink(missing_ok=True)

    def setUp(self) -> None:
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    @staticmethod
    def _bus(number: str, registration: str) -> Bus:
        return Bus(
            bus_number=number,
            registration_number=registration,
            capacity=40,
            manufacturer="Test",
            model="Coach",
            year=2026,
            fuel_type="Diesel",
            status="Active",
        )

    def _seed_profile_codes(self, db) -> None:
        driver_user = User(
            username="existing.driver",
            password_hash="unused",
            full_name="Existing Driver",
            role="Driver",
            status="Active",
        )
        student_user = User(
            username="existing.student",
            password_hash="unused",
            full_name="Existing Student",
            role="User",
            status="Active",
        )
        db.add_all([driver_user, student_user])
        db.flush()
        db.add_all([
            Driver(
                user_id=driver_user.id,
                driver_code="DRV004",
                license_number="EXISTING-LIC",
                license_expiry=date(2030, 1, 1),
                status="Available",
            ),
            Student(user_id=student_user.id, student_code="STU006"),
        ])

    def test_previews_follow_the_highest_matching_number(self) -> None:
        with self.session_factory() as db:
            db.add_all([
                self._bus("BUS-005", "REG-005"),
                self._bus("CAMPUS", "REG-CUSTOM"),
                Route(route_code="RT009", route_name="Nine", status="Active"),
                Route(route_code="CUSTOM", route_name="Custom", status="Active"),
            ])
            self._seed_profile_codes(db)
            db.commit()

            self.assertEqual(get_next_bus_number(db, object()), {"bus_number": "BUS-006"})
            self.assertEqual(get_next_route_code(db, object()), {"route_code": "RT010"})
            self.assertEqual(
                get_next_user_codes(db, object()),
                {"driver_code": "DRV005", "student_code": "STU007"},
            )

    def test_create_ignores_stale_or_duplicate_client_codes(self) -> None:
        with self.session_factory() as db:
            db.add_all([
                self._bus("BUS-005", "REG-005"),
                Route(route_code="RT009", route_name="Nine", status="Active"),
            ])
            self._seed_profile_codes(db)
            db.commit()

            bus = create_bus(
                BusCreate(
                    bus_number="BUS-001",
                    registration_number="REG-NEW",
                    capacity=40,
                    manufacturer="Test",
                    model="Coach",
                    year=2026,
                    fuel_type="Diesel",
                ),
                db,
                object(),
            )
            route = create_route(
                RouteCreate(route_code="RT001", route_name="Generated Route"),
                db,
                object(),
            )
            student = asyncio.run(create_user(
                UserCreate(
                    full_name="Generated Student",
                    username="generated.student",
                    password="student-password",
                    role="User",
                    student_code="STU001",
                ),
                db,
                object(),
            ))
            driver = asyncio.run(create_user(
                UserCreate(
                    full_name="Generated Driver",
                    username="generated.driver",
                    password="driver-password",
                    role="Driver",
                    driver_code="DRV001",
                    license_number="GENERATED-LIC",
                    license_expiry=date(2031, 1, 1),
                ),
                db,
                object(),
            ))

            self.assertEqual(bus.bus_number, "BUS-006")
            self.assertEqual(route.route_code, "RT010")
            self.assertEqual(student["student_code"], "STU007")
            self.assertEqual(driver["driver_code"], "DRV005")

    def test_existing_codes_are_immutable_during_edits(self) -> None:
        with self.session_factory() as db:
            bus = self._bus("BUS-003", "REG-003")
            route = Route(route_code="RT003", route_name="Original Route", status="Active")
            driver_user = User(
                username="edit.driver",
                password_hash="unused",
                full_name="Edit Driver",
                role="Driver",
                status="Active",
            )
            student_user = User(
                username="edit.student",
                password_hash="unused",
                full_name="Edit Student",
                role="User",
                status="Active",
            )
            db.add_all([bus, route, driver_user, student_user])
            db.flush()
            driver = Driver(
                user_id=driver_user.id,
                driver_code="DRV003",
                license_number="EDIT-LIC",
                license_expiry=date(2030, 1, 1),
                status="Available",
            )
            student = Student(user_id=student_user.id, student_code="STU003")
            db.add_all([driver, student])
            db.commit()

            updated_bus = update_bus(
                bus.id,
                BusUpdate(
                    bus_number="BUS-999",
                    registration_number="REG-003",
                    capacity=45,
                    manufacturer="Test",
                    model="Coach",
                    year=2026,
                    fuel_type="Diesel",
                    status="Active",
                ),
                db,
                object(),
            )
            updated_route = update_route(
                route.id,
                RouteUpdate(
                    route_code="RT999",
                    route_name="Renamed Route",
                    status="Active",
                ),
                db,
                object(),
            )
            updated_driver = update_driver(
                driver.id,
                DriverUpdate(
                    driver_code="DRV999",
                    license_number="EDIT-LIC",
                    license_expiry=date(2031, 1, 1),
                    status="Available",
                ),
                db,
                object(),
            )
            updated_student = update_user(
                student_user.id,
                UserUpdate(
                    full_name="Edited Student",
                    role="User",
                    status="Active",
                    student_code="STU999",
                ),
                db,
                object(),
            )

            self.assertEqual(updated_bus.bus_number, "BUS-003")
            self.assertEqual(updated_route.route_code, "RT003")
            self.assertEqual(updated_driver.driver_code, "DRV003")
            self.assertEqual(updated_student["student_code"], "STU003")

    def test_concurrent_bus_creates_receive_distinct_codes(self) -> None:
        with self.session_factory() as db:
            db.add(self._bus("BUS-005", "REG-005"))
            db.commit()

        def create_named_bus(index: int) -> str:
            with self.session_factory() as db:
                created = create_bus(
                    BusCreate(
                        bus_number="BUS-006",
                        registration_number=f"REG-CONCURRENT-{index}",
                        capacity=40,
                        manufacturer="Test",
                        model="Coach",
                        year=2026,
                        fuel_type="Diesel",
                    ),
                    db,
                    object(),
                )
                return created.bus_number

        with ThreadPoolExecutor(max_workers=2) as executor:
            codes = set(executor.map(create_named_bus, [1, 2]))

        self.assertEqual(codes, {"BUS-006", "BUS-007"})


if __name__ == "__main__":
    unittest.main()
