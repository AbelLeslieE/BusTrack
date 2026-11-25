"""Regression coverage for the operational Assignments workspace."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Route
from backend.routes.assignments import get_assignments


class AssignmentVisibilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = (
            Path(tempfile.gettempdir())
            / f"bus_tracker_assignments_{uuid4().hex}.db"
        )
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_assignments_returns_only_active_routes(self) -> None:
        with self.session_factory() as database_session:
            database_session.add_all([
                Route(
                    route_code="R-ACTIVE",
                    route_name="Active Route",
                    status="Active",
                ),
                Route(
                    route_code="R-INACTIVE",
                    route_name="Inactive Route",
                    status="Inactive",
                ),
            ])
            database_session.commit()

            result = get_assignments(database_session, object())

        self.assertEqual(
            [route["route_code"] for route in result["routes"]],
            ["R-ACTIVE"],
        )
        self.assertEqual(result["routes"][0]["status"], "Active")


if __name__ == "__main__":
    unittest.main()
