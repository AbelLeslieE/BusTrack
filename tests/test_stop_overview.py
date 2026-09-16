"""Regression coverage for Stops Management KPI calculations."""

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
from backend.models import Route, RouteStop, Stop
from backend.routes.stops import get_stops_overview


class StopOverviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = (
            Path(tempfile.gettempdir())
            / f"bus_tracker_stop_overview_{uuid4().hex}.db"
        )
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_overview_uses_route_assignments_for_kpis(self) -> None:
        with self.session_factory() as database_session:
            routes = [
                Route(route_code="R-01", route_name="Route One", status="Active"),
                Route(route_code="R-02", route_name="Route Two", status="Active"),
                Route(route_code="R-03", route_name="Empty Route", status="Active"),
            ]
            stops = [
                Stop(stop_code="ST001", stop_name="Shared Stop", status="Active"),
                Stop(stop_code="ST002", stop_name="Second Stop", status="Active"),
                Stop(stop_code="ST003", stop_name="Unmapped Stop", status="Active"),
            ]
            database_session.add_all([*routes, *stops])
            database_session.flush()
            assigned_route_ids = [routes[0].id, routes[1].id]
            database_session.add_all([
                RouteStop(route_id=routes[0].id, stop_id=stops[0].id, sequence=1),
                RouteStop(route_id=routes[0].id, stop_id=stops[1].id, sequence=2),
                RouteStop(route_id=routes[1].id, stop_id=stops[0].id, sequence=1),
            ])
            database_session.commit()

            result = get_stops_overview(database_session, object())

        self.assertEqual(result["statistics"], {
            "total_stops": 3,
            "total_routes": 3,
            "average_stops_per_route": 1.0,
            "mapped_stops": 2,
            "route_stop_assignments": 3,
        })
        shared_stop = next(
            stop for stop in result["stops"] if stop["stop_code"] == "ST001"
        )
        self.assertEqual(shared_stop["route_ids"], assigned_route_ids)


if __name__ == "__main__":
    unittest.main()
