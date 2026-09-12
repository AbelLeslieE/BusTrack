"""Kingstrack and Airotrack must coexist on the canonical route engine."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Bus, Route, RouteStop, Stop, Student, User
from backend.routes.gps_provider import get_provider_health, list_provider_positions
from backend.routes.models_tracking import BusGPSState, LiveTrip, ProviderGPSPosition
from backend.routes.student import get_student_live_tracking
from backend.services.airotrack import refresh_airotrack
from backend.services.kingstrack import _store_position, refresh_kingstrack
from backend.services.gps_providers import refresh_gps_providers


class KingstrackIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.database_path = Path(tempfile.gettempdir()) / f"kingstrack_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.database_path.as_posix()}")
        cls.sessions = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.database_path.unlink(missing_ok=True)

    def setUp(self) -> None:
        with self.sessions() as db:
            for table in reversed(Base.metadata.sorted_tables):
                db.execute(table.delete())
            db.commit()

    @staticmethod
    def record(plate: str, imei: str, latitude: float, longitude: float, moment: datetime) -> dict:
        return {
            "address": "Test location",
            "odometer": 12345,
            "plate_no": plate,
            "imei_no": imei,
            "latitude": latitude,
            "longitude": longitude,
            "gps": "ON",
            "ignition": False,
            "speed": 0,
            "timestamp": moment.isoformat(timespec="milliseconds"),
            "status": "Stop",
        }

    def _route_fixture(self, db):
        student_user = User(
            username="king-student",
            password_hash="unused",
            full_name="King Student",
            role="User",
            status="Active",
        )
        bus = Bus(
            bus_number="KING-01",
            registration_number="KL 64 P 4797",
            capacity=40,
            manufacturer="Test",
            model="Coach",
            year=2026,
            fuel_type="Diesel",
            status="Active",
        )
        db.add_all([student_user, bus])
        db.flush()
        route = Route(
            route_code="KING-R",
            route_name="Kingstrack Route",
            bus_id=bus.id,
            driver_id=None,
            status="Active",
            total_stops=3,
        )
        stops = [
            Stop(stop_code="KING-A", stop_name="Start", latitude=10.0, longitude=76.0, radius=120, status="Active"),
            Stop(stop_code="KING-B", stop_name="Middle", latitude=10.01, longitude=76.01, radius=120, status="Active"),
            Stop(stop_code="KING-C", stop_name="Terminal", latitude=10.02, longitude=76.02, radius=120, status="Active"),
        ]
        db.add_all([route, *stops])
        db.flush()
        db.add_all([
            RouteStop(route_id=route.id, stop_id=stop.id, sequence=index)
            for index, stop in enumerate(stops, start=1)
        ])
        db.add(Student(
            user_id=student_user.id,
            student_code="KING-STUDENT",
            route_id=route.id,
            bus_id=bus.id,
            stop_id=stops[0].id,
        ))
        db.commit()
        return student_user, bus, stops

    def test_plate_only_matching_and_route_reversal_use_canonical_progression(self) -> None:
        with self.sessions() as db:
            student_user, bus, stops = self._route_fixture(db)
            first_fix = datetime.now(timezone.utc) - timedelta(minutes=1)

            _store_position(db, bus, self.record("KL64P4797", "KING-IMEI", 10.0, 76.0, first_fix))
            db.commit()
            outbound = get_student_live_tracking(student_user, db)
            self.assertEqual(bus.gps_provider, "kingstrack")
            self.assertEqual(outbound["trip"]["route_direction"], "forward")
            self.assertEqual([item["tracking_status"] for item in outbound["stops"]], ["reached", "pending", "pending"])

            _store_position(db, bus, self.record("KL64P4797", "KING-IMEI", 10.02, 76.02, first_fix + timedelta(seconds=20)))
            db.commit()
            terminal = get_student_live_tracking(student_user, db)
            self.assertEqual(terminal["trip"]["route_direction"], "reverse")
            self.assertEqual([item["stop_code"] for item in terminal["stops"]], ["KING-C", "KING-B", "KING-A"])
            self.assertEqual([item["tracking_status"] for item in terminal["stops"]], ["terminal_completed", "pending", "pending"])

            _store_position(db, bus, self.record("KL64P4797", "KING-IMEI", 10.01, 76.01, first_fix + timedelta(seconds=40)))
            db.commit()
            returning = get_student_live_tracking(student_user, db)
            self.assertEqual(returning["trip"]["route_direction"], "reverse")
            self.assertEqual([item["tracking_status"] for item in returning["stops"]], ["completed", "reached", "pending"])
            self.assertEqual(db.query(BusGPSState).filter_by(bus_id=bus.id).one().protocol, "kingstrack")

    def test_fleet_poll_claims_matching_plate_and_airotrack_does_not_query_it(self) -> None:
        with self.sessions() as db:
            king_bus = Bus(bus_number="KING-02", registration_number="KL64M9190", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            airo_bus = Bus(bus_number="AIRO-02", registration_number="KL01AIRO2", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            db.add_all([king_bus, airo_bus])
            db.commit()
            moment = datetime.now(timezone.utc) - timedelta(seconds=10)

            with patch.dict(os.environ, {"KINGSTRACK_ACCOUNTS": "1:1"}), patch(
                "backend.services.kingstrack._request_account",
                return_value=[self.record("KL64M9190", "KING-IMEI-2", 10.3, 76.2, moment)],
            ):
                result = refresh_kingstrack(db)

            self.assertEqual(result["provider_requests"], 1)
            self.assertEqual(result["updated"][0]["bus_id"], king_bus.id)
            self.assertEqual(db.get(Bus, king_bus.id).gps_provider, "kingstrack")

            airo_response = {
                "status": "success",
                "data": {
                    "vehicle_registration": airo_bus.registration_number,
                    "latitude": 10.4,
                    "longitude": 76.3,
                    "imei_no": "AIRO-IMEI-2",
                    "source_date": datetime.now().astimezone().strftime("%d-%m-%Y %I:%M:%S %p"),
                    "speed": 0,
                    "ignition": "OFF",
                },
            }
            with patch.dict(os.environ, {"AIROTRACK_API_TOKEN": "test-token"}), patch(
                "backend.services.airotrack._request_vehicle",
                return_value=airo_response,
            ) as request_vehicle:
                airo_result = refresh_airotrack(db)

            self.assertEqual(request_vehicle.call_count, 1)
            self.assertEqual(airo_result["updated"][0]["bus_id"], airo_bus.id)
            self.assertEqual(db.get(Bus, airo_bus.id).gps_provider, "airotrack")

    def test_future_time_is_quarantined_and_provider_filters_are_exact(self) -> None:
        with self.sessions() as db:
            king_bus = Bus(bus_number="KING-CLOCK", registration_number="KL64P5484", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            airo_bus = Bus(bus_number="AIRO-HISTORY", registration_number="KL01HISTORY", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active", gps_provider="airotrack")
            db.add_all([king_bus, airo_bus])
            db.commit()
            future = datetime.now(timezone.utc) + timedelta(days=2)
            stored = _store_position(db, king_bus, self.record("KL64P5484", "KING-CLOCK-IMEI", 12.0, 78.0, future))
            db.add(ProviderGPSPosition(
                bus_id=airo_bus.id,
                external_device_id="AIRO-HISTORY-IMEI",
                latitude=10.0,
                longitude=76.0,
                fix_time=datetime.now(timezone.utc) - timedelta(seconds=5),
                received_at=datetime.now(timezone.utc),
                protocol="airotrack",
                raw_payload="{}",
            ))
            db.commit()

            self.assertTrue(stored["quarantined"])
            self.assertIsNone(db.query(BusGPSState).filter_by(bus_id=king_bus.id).first())
            self.assertIsNone(db.query(LiveTrip).filter_by(bus_id=king_bus.id).first())

            health = get_provider_health(
                response=Response(),
                bus_id=None,
                provider="kingstrack",
                db=db,
                _technician=SimpleNamespace(),
            )
            self.assertEqual([item["bus_id"] for item in health["buses"]], [king_bus.id])
            self.assertEqual(health["buses"][0]["protocol"], "kingstrack")

            positions = list_provider_positions(
                response=Response(),
                bus_id=None,
                provider="kingstrack",
                limit=100,
                offset=0,
                db=db,
                _technician=SimpleNamespace(),
            )
            self.assertEqual(positions["total"], 1)
            self.assertEqual(positions["positions"][0]["protocol"], "kingstrack")

    def test_one_provider_failure_does_not_suppress_the_other(self) -> None:
        with self.sessions() as db, patch.dict(
            os.environ,
            {
                "AIROTRACK_API_TOKEN": "test-token",
                "KINGSTRACK_ACCOUNTS": "malformed-account",
            },
        ), patch(
            "backend.services.airotrack.refresh_airotrack",
            return_value={
                "provider": "airotrack",
                "updated": [{"bus_id": 9}],
                "skipped": [],
                "errors": [],
            },
        ) as refresh_airotrack_mock:
            result = refresh_gps_providers(db)

        refresh_airotrack_mock.assert_called_once_with(db, bus_id=None)
        self.assertEqual(result["updated"], [{"provider": "airotrack", "bus_id": 9}])
        self.assertEqual(result["errors"][0]["provider"], "kingstrack")
        self.assertIn("company_id:user_id", result["errors"][0]["reason"])


if __name__ == "__main__":
    unittest.main()
