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
from backend.models import Bus, Route, RouteStop, Stop
from backend.routes.stops import get_bus_route_stops, get_stops_overview


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

    def setUp(self) -> None:
        with self.session_factory() as database_session:
            database_session.query(RouteStop).delete()
            database_session.query(Route).delete()
            database_session.query(Stop).delete()
            database_session.query(Bus).delete()
            database_session.commit()

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

    def test_bus_workspace_groups_every_bus_and_orders_route_stops(self) -> None:
        with self.session_factory() as database_session:
            buses = [
                Bus(bus_number="BUS-001", registration_number="KL01AA0001", capacity=40, manufacturer="Tata", model="Starbus", year=2025, fuel_type="Diesel", status="Active"),
                Bus(bus_number="BUS-002", registration_number="KL01AA0002", capacity=40, manufacturer="Tata", model="Starbus", year=2025, fuel_type="Diesel", status="Active"),
            ]
            database_session.add_all(buses)
            database_session.flush()
            routes = [
                Route(route_code="R-01", route_name="Assigned Route", bus_id=buses[0].id, status="Active"),
                Route(route_code="R-02", route_name="Awaiting Bus", status="Active"),
            ]
            stops = [
                Stop(stop_code="ST001", stop_name="First", latitude=10.1, longitude=76.1, radius=250, status="Active"),
                Stop(stop_code="ST002", stop_name="Second", latitude=10.2, longitude=76.2, radius=300, status="Active"),
            ]
            database_session.add_all([*routes, *stops])
            database_session.flush()
            database_session.add_all([
                RouteStop(route_id=routes[0].id, stop_id=stops[1].id, sequence=2),
                RouteStop(route_id=routes[0].id, stop_id=stops[0].id, sequence=1),
                RouteStop(route_id=routes[1].id, stop_id=stops[0].id, sequence=1),
            ])
            database_session.commit()

            result = get_bus_route_stops(database_session, object())

        self.assertEqual([bus["bus_number"] for bus in result["buses"]], ["BUS-001", "BUS-002"])
        assigned_route = result["buses"][0]["routes"][0]
        self.assertEqual([stop["stop_name"] for stop in assigned_route["stops"]], ["First", "Second"])
        self.assertEqual([stop["sequence"] for stop in assigned_route["stops"]], [1, 2])
        self.assertEqual(assigned_route["stops"][0]["route_usage_count"], 2)
        self.assertEqual(result["buses"][1]["routes"], [])
        self.assertEqual(result["unassigned_routes"][0]["route_name"], "Awaiting Bus")
        self.assertEqual(result["statistics"], {
            "total_buses": 2,
            "assigned_buses": 1,
            "routes_with_stops": 2,
            "ordered_stop_entries": 3,
        })


if __name__ == "__main__":
    unittest.main()
