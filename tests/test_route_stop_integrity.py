"""Regression coverage for safe route-stop editing and payload validation."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Bus, Driver, Route, RouteStop, Stop, User
from backend.routes.buses import get_buses
from backend.routes.models_tracking import LiveTrip, TripStopEvent
from backend.routes.gps import get_live_tracking
from backend.routes.route_import import import_routes
from backend.routes.route_stops import (
    clear_route_stops,
    remove_stop_from_route,
    update_stop_sequence,
)
from backend.routes.routes import get_routes
from backend.schemas import RouteStopUpdate, StopCreate, StopUpdate


class RouteStopIntegrityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.database_path = (
            Path(tempfile.gettempdir())
            / f"bus_tracker_route_stop_integrity_{uuid4().hex}.db"
        )
        cls.engine = create_engine(f"sqlite:///{cls.database_path.as_posix()}")
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

    def _seed_route(self, db):
        bus = Bus(
            bus_number="SAFE-01",
            registration_number="SAFE-REG-01",
            capacity=40,
            manufacturer="Test",
            model="Coach",
            year=2026,
            fuel_type="Diesel",
            status="Active",
        )
        route = Route(
            route_code="SAFE-R1",
            route_name="Safe Route",
            status="Active",
            total_stops=3,
        )
        stops = [
            Stop(stop_code=f"SAFE-{index}", stop_name=f"Safe Stop {index}", status="Active")
            for index in range(1, 4)
        ]
        db.add_all([bus, route, *stops])
        db.flush()
        route.bus_id = bus.id
        route_stops = [
            RouteStop(route_id=route.id, stop_id=stop.id, sequence=index)
            for index, stop in enumerate(stops, start=1)
        ]
        db.add_all(route_stops)
        db.flush()
        trip = LiveTrip(
            bus_id=bus.id,
            route_id=route.id,
            status="Running",
            current_route_stop_id=route_stops[1].id,
            current_stop_status="Arrived",
            current_stop_arrived_at=datetime.now(timezone.utc),
        )
        db.add(trip)
        db.commit()
        return route, stops, route_stops, trip

    def test_remove_clears_transient_trip_pointer_and_resequences(self) -> None:
        with self.session_factory() as db:
            route, _stops, route_stops, trip = self._seed_route(db)
            result = remove_stop_from_route(route_stops[1].id, db, object())

            db.expire_all()
            remaining = db.query(RouteStop).filter(
                RouteStop.route_id == route.id
            ).order_by(RouteStop.sequence).all()
            refreshed_trip = db.get(LiveTrip, trip.id)
            refreshed_route = db.get(Route, route.id)

            self.assertTrue(result["success"])
            self.assertEqual([item.stop_id for item in remaining], [route_stops[0].stop_id, route_stops[2].stop_id])
            self.assertEqual([item.sequence for item in remaining], [1, 2])
            self.assertEqual(refreshed_route.total_stops, 2)
            self.assertIsNone(refreshed_trip.current_route_stop_id)
            self.assertEqual(refreshed_trip.current_stop_status, "Approaching")
            self.assertIsNone(refreshed_trip.current_stop_arrived_at)

    def test_history_blocks_single_remove_and_clear(self) -> None:
        with self.session_factory() as db:
            route, stops, route_stops, trip = self._seed_route(db)
            db.add(TripStopEvent(
                trip_id=trip.id,
                route_stop_id=route_stops[0].id,
                stop_id=stops[0].id,
                event_type="Arrived",
                occurred_at=datetime.now(timezone.utc),
                stop_code_snapshot=stops[0].stop_code,
                stop_name_snapshot=stops[0].stop_name,
                route_sequence_snapshot=1,
            ))
            db.commit()

            with self.assertRaises(HTTPException) as remove_error:
                remove_stop_from_route(route_stops[0].id, db, object())
            self.assertEqual(remove_error.exception.status_code, 409)

            with self.assertRaises(HTTPException) as clear_error:
                clear_route_stops(route.id, db, object())
            self.assertEqual(clear_error.exception.status_code, 409)
            self.assertEqual(
                db.query(RouteStop).filter(RouteStop.route_id == route.id).count(),
                3,
            )

    def test_clear_without_history_updates_route_and_live_trip(self) -> None:
        with self.session_factory() as db:
            route, _stops, _route_stops, trip = self._seed_route(db)
            clear_route_stops(route.id, db, object())

            db.expire_all()
            self.assertEqual(db.get(Route, route.id).total_stops, 0)
            self.assertEqual(
                db.query(RouteStop).filter(RouteStop.route_id == route.id).count(),
                0,
            )
            self.assertIsNone(db.get(LiveTrip, trip.id).current_route_stop_id)

    def test_reorder_is_bounded_and_can_update_metadata(self) -> None:
        with self.session_factory() as db:
            route, _stops, route_stops, _trip = self._seed_route(db)
            update_stop_sequence(
                route_stops[0].id,
                RouteStopUpdate(sequence=3, fare=25),
                db,
                object(),
            )
            db.expire_all()
            reordered = db.query(RouteStop).filter(
                RouteStop.route_id == route.id
            ).order_by(RouteStop.sequence).all()
            self.assertEqual([item.id for item in reordered], [route_stops[2].id, route_stops[1].id, route_stops[0].id])
            self.assertEqual(db.get(RouteStop, route_stops[0].id).fare, 25)

            with self.assertRaises(HTTPException) as error:
                update_stop_sequence(
                    route_stops[0].id,
                    RouteStopUpdate(sequence=4),
                    db,
                    object(),
                )
            self.assertEqual(error.exception.status_code, 422)

    def test_route_import_preserves_referenced_route_stop_ids(self) -> None:
        with self.session_factory() as db:
            route, stops, route_stops, trip = self._seed_route(db)
            db.add(TripStopEvent(
                trip_id=trip.id,
                route_stop_id=route_stops[0].id,
                stop_id=stops[0].id,
                event_type="Arrived",
                occurred_at=datetime.now(timezone.utc),
                stop_code_snapshot=stops[0].stop_code,
                stop_name_snapshot=stops[0].stop_name,
                route_sequence_snapshot=1,
            ))
            db.commit()

            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["BUS STOP NO", "ROUTE", "TIME", "BUS STOP", "2026-27", "BUS NAME"])
            sheet.append([1, route.route_name, "08:00", stops[0].stop_name, 10, ""])
            sheet.append([2, route.route_name, "08:15", stops[1].stop_name, 15, ""])
            content = BytesIO()
            workbook.save(content)
            content.seek(0)

            result = asyncio.run(import_routes(
                UploadFile(filename="routes.xlsx", file=content),
                db,
                object(),
            ))

            db.expire_all()
            imported = db.query(RouteStop).filter(
                RouteStop.route_id == route.id
            ).order_by(RouteStop.sequence).all()
            self.assertEqual(result["routes_updated"], 1)
            self.assertEqual([item.id for item in imported], [route_stops[0].id, route_stops[1].id])
            self.assertEqual([item.fare for item in imported], [10, 15])
            self.assertEqual(db.get(Route, route.id).total_stops, 2)

    def test_route_import_uses_the_shared_generated_code_families(self) -> None:
        with self.session_factory() as db:
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["BUS STOP NO", "ROUTE", "TIME", "BUS STOP", "2026-27", "BUS NAME"])
            sheet.append([1, "Imported Route", "08:00", "Imported Stop", 10, ""])
            content = BytesIO()
            workbook.save(content)
            content.seek(0)

            result = asyncio.run(import_routes(
                UploadFile(filename="routes.xlsx", file=content),
                db,
                object(),
            ))

            self.assertEqual(result["routes_created"], 1)
            self.assertEqual(result["stops_created"], 1)
            self.assertEqual(db.query(Route).one().route_code, "RT001")
            self.assertEqual(db.query(Stop).one().stop_code, "ST001")

    def test_admin_live_tracking_excludes_unended_nonrunning_rows(self) -> None:
        with self.session_factory() as db:
            _route, _stops, _route_stops, trip = self._seed_route(db)
            trip.status = "Stopped"
            trip.ended_at = None
            db.commit()

            self.assertEqual(get_live_tracking(db, object()), [])

            trip.status = "Running"
            db.commit()
            result = get_live_tracking(db, object())
            self.assertEqual([item["trip_id"] for item in result], [trip.id])

    def test_management_lists_batch_related_records(self) -> None:
        with self.session_factory() as db:
            route, _stops, _route_stops, _trip = self._seed_route(db)
            bus = db.get(Bus, route.bus_id)
            user = User(
                username="batch.driver",
                password_hash="unused",
                full_name="Batch Driver",
                role="Driver",
                status="Active",
            )
            db.add(user)
            db.flush()
            driver = Driver(
                user_id=user.id,
                driver_code="BATCH-DRV",
                license_number="BATCH-LIC",
                license_expiry=date(2030, 1, 1),
                status="Available",
                bus_id=bus.id,
            )
            db.add(driver)
            db.flush()
            bus.driver_id = driver.id
            route.driver_id = driver.id
            db.commit()

            statements: list[str] = []
            def record_statement(_connection, _cursor, statement, _parameters, _context, _many):
                statements.append(statement)

            event.listen(self.engine, "before_cursor_execute", record_statement)
            try:
                bus_result = get_buses(db, object())
                bus_statement_count = len(statements)
                statements.clear()
                route_result = get_routes(db, object())
                route_statement_count = len(statements)
            finally:
                event.remove(self.engine, "before_cursor_execute", record_statement)

            self.assertEqual(bus_result[0].driver_name, "Batch Driver")
            self.assertEqual(route_result[0].driver_name, "Batch Driver")
            self.assertEqual(route_result[0].bus_number, bus.bus_number)
            self.assertEqual(route_result[0].total_stops, 3)
            self.assertLessEqual(bus_statement_count, 2)
            self.assertLessEqual(route_statement_count, 4)

    def test_stop_payloads_validate_geofence_bounds_and_keep_codes_optional(self) -> None:
        created = StopCreate.model_validate({"stop_name": "Validated Stop"})
        updated = StopUpdate.model_validate({"stop_name": "Updated Stop"})
        self.assertIsNone(created.stop_code)
        self.assertIsNone(updated.stop_code)

        with self.assertRaises(ValidationError):
            StopCreate.model_validate({"stop_name": "Bad Latitude", "latitude": 91})
        with self.assertRaises(ValidationError):
            StopUpdate.model_validate({"stop_name": "Bad Radius", "radius": 5})


if __name__ == "__main__":
    unittest.main()
