"""Regression coverage for driver-management KPI assignment state."""

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
from backend.models import Driver, Route, User
from backend.routes.driver import get_drivers


class DriverKpiAssignmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / (
            f"bus_tracker_driver_kpis_{uuid4().hex}.db"
        )
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_driver_list_marks_route_assignment_without_bus(self) -> None:
        suffix = uuid4().hex[:8]
        with self.session_factory() as database_session:
            user = User(
                username=f"kpi-driver-{suffix}",
                full_name="KPI Driver",
                email=f"kpi-driver-{suffix}@example.com",
                password_hash="not-used",
                role="Driver",
                status="Active",
            )
            database_session.add(user)
            database_session.flush()
            driver = Driver(
                user_id=user.id,
                driver_code=f"KPI-{suffix}",
                license_number=f"KPI-LIC-{suffix}",
                license_expiry=date(2030, 1, 1),
                status="Available",
            )
            database_session.add(driver)
            database_session.flush()
            database_session.add(Route(
                route_code=f"KPI-RT-{suffix}",
                route_name=f"KPI Route {suffix}",
                driver_id=driver.id,
                status="Active",
            ))
            database_session.commit()

            drivers = get_drivers(db=database_session, _current_user=object())
            result = next(item for item in drivers if item.id == driver.id)

        self.assertTrue(result.is_assigned)
        self.assertIsNone(result.bus_id)


if __name__ == "__main__":
    unittest.main()
