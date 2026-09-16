"""Regression coverage for production request-volume safeguards."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import asyncio
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.main import FrontendStaticFiles, background_jobs_enabled
from backend.models import APIRequestLog
from backend.request_audit import RequestAuditMiddleware
from backend.services.telemetry_retention import purge_api_request_history
from backend.routes.student import stream_student_live_tracking
from backend.routes import student as student_routes
from backend.routes.gps_provider import stream_driver_tracking_source
from backend.routes.gps import stream_admin_live_tracking


async def _unused_app(scope, receive, send) -> None:
    del scope, receive, send


class RequestOptimizationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.database_path = Path(tempfile.gettempdir()) / f"bus_tracker_request_policy_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.database_path.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.database_path.unlink(missing_ok=True)

    def test_production_samples_successful_reads_but_keeps_mutations_and_errors(self) -> None:
        with patch.dict(
            os.environ,
            {"APP_ENV": "production", "REQUEST_AUDIT_SUCCESS_GET_SAMPLE_RATE": "0"},
        ):
            middleware = RequestAuditMiddleware(_unused_app)

        self.assertFalse(middleware._should_save(method="GET", status_code=200))
        self.assertTrue(middleware._should_save(method="GET", status_code=500))
        self.assertTrue(middleware._should_save(method="POST", status_code=200))

        with patch.dict(
            os.environ,
            {"APP_ENV": "production", "REQUEST_AUDIT_SUCCESS_GET_SAMPLE_RATE": "1"},
        ):
            full_middleware = RequestAuditMiddleware(_unused_app)
        self.assertTrue(full_middleware._should_save(method="GET", status_code=200))

    def test_background_jobs_can_be_disabled_only_by_explicit_setting(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(background_jobs_enabled())
        for disabled_value in ("false", "0", "no", "off"):
            with self.subTest(disabled_value=disabled_value):
                with patch.dict(os.environ, {"BACKGROUND_JOBS_ENABLED": disabled_value}):
                    self.assertFalse(background_jobs_enabled())

    def test_static_assets_receive_a_bounded_browser_cache(self) -> None:
        static_files = FrontendStaticFiles(directory=Path(__file__).resolve().parents[1] / "frontend")

        async def load_asset():
            return await static_files.get_response(
                "common/auth.js",
                {"type": "http", "method": "GET", "path": "/static/common/auth.js", "headers": []},
            )

        with patch.dict(os.environ, {"STATIC_ASSET_CACHE_SECONDS": "3600"}):
            response = asyncio.run(load_asset())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "public, max-age=3600, must-revalidate")

    def test_request_log_retention_keeps_recent_rows(self) -> None:
        now = datetime.now(timezone.utc)
        with self.session_factory() as database_session:
            database_session.add_all([
                APIRequestLog(
                    method="GET", path="/api/old", status_code=200, duration_ms=5,
                    created_at=now - timedelta(days=31),
                ),
                APIRequestLog(
                    method="POST", path="/api/recent", status_code=200, duration_ms=8,
                    created_at=now - timedelta(days=2),
                ),
            ])
            database_session.flush()
            with patch.dict(os.environ, {"REQUEST_AUDIT_RETENTION_DAYS": "30"}):
                self.assertEqual(purge_api_request_history(database_session, now=now), 1)
            database_session.commit()
            remaining = database_session.query(APIRequestLog).one()
            self.assertEqual(remaining.path, "/api/recent")

    def test_student_stream_sends_existing_tracking_contract(self) -> None:
        payload = {
            "tracking_available": True,
            "reason": None,
            "student": {"id": 4, "student_code": "ST-4"},
            "bus": {"id": 2, "bus_number": "BUS-2"},
            "route": {"id": 3, "route_name": "Route 3"},
            "assigned_stop": {"id": 5, "stop_name": "Stop 5"},
            "trip": {"id": 9, "latitude": 10.1, "longitude": 76.2},
            "telemetry": {"is_fresh": True},
            "stops": [],
        }

        class RequestStub:
            cookies = {"bus_tracker_session": "test-token"}
            headers = {}

            async def is_disconnected(self) -> bool:
                return False

        class UserStub:
            id = 7

        async def first_data_event() -> str:
            response = await stream_student_live_tracking(RequestStub(), UserStub())
            iterator = response.body_iterator
            self.assertEqual(await anext(iterator), "retry: 5000\n\n")
            return await anext(iterator)

        with patch(
            "backend.routes.student._load_student_stream_identity",
            return_value=(("route", 3, 2), payload["student"], payload["assigned_stop"]),
        ), patch(
            "backend.routes.student._cached_student_stream_payload",
            return_value=payload,
        ), patch(
            "backend.routes.student.get_token_identity",
            return_value=("student", 0, "session-7"),
        ):
            event = asyncio.run(first_data_event())

        self.assertTrue(event.startswith("data: "))
        self.assertIn('"tracking_available":true', event)
        self.assertIn('"latitude":10.1', event)

    def test_student_route_snapshot_is_single_flight_during_login_spike(self) -> None:
        payload = {
            "tracking_available": True,
            "student": {"id": 1, "student_code": "ST-1"},
            "bus": {"id": 2},
            "route": {"id": 3},
            "assigned_stop": None,
            "trip": None,
            "stops": [],
        }
        calls = 0

        def load(_user_id: int) -> dict:
            nonlocal calls
            calls += 1
            return payload

        async def concurrent_loads() -> None:
            await asyncio.gather(*(
                student_routes._cached_student_stream_payload(("route", 3, 2), user_id)
                for user_id in range(1, 21)
            ))

        student_routes._student_stream_cache.clear()
        student_routes._student_stream_locks.clear()
        try:
            with patch("backend.routes.student._load_student_stream_payload", side_effect=load):
                asyncio.run(concurrent_loads())
            self.assertEqual(calls, 1)
        finally:
            student_routes._student_stream_cache.clear()
            student_routes._student_stream_locks.clear()

    def test_driver_stream_sends_existing_source_contract(self) -> None:
        payload = {
            "tracking_source": "vehicle_gps",
            "mobile_tracking_allowed": True,
            "active_trip_id": 11,
            "vehicle": {"latitude": 10.2, "longitude": 76.3},
        }

        class RequestStub:
            cookies = {"bus_tracker_session": "test-token"}
            headers = {}

            async def is_disconnected(self) -> bool:
                return False

        class UserStub:
            id = 8

        async def first_data_event(response) -> str:
            iterator = response.body_iterator
            self.assertEqual(await anext(iterator), "retry: 5000\n\n")
            return await anext(iterator)

        with patch(
            "backend.routes.gps_provider._load_driver_tracking_source",
            return_value=payload,
        ), patch(
            "backend.routes.gps_provider.get_token_identity",
            return_value=("driver", 1, "session-8"),
        ):
            response = stream_driver_tracking_source(RequestStub(), UserStub())
            event = asyncio.run(first_data_event(response))

        self.assertIn('"tracking_source":"vehicle_gps"', event)
        self.assertIn('"active_trip_id":11', event)

    def test_admin_stream_sends_existing_live_fleet_contract(self) -> None:
        payload = [{
            "trip_id": 12,
            "bus_id": 3,
            "bus_number": "BUS-3",
            "latitude": 10.3,
            "longitude": 76.4,
        }]

        class RequestStub:
            cookies = {"bus_tracker_session": "test-token"}
            headers = {}

            async def is_disconnected(self) -> bool:
                return False

        class UserStub:
            id = 9

        async def first_data_event(response) -> str:
            iterator = response.body_iterator
            self.assertEqual(await anext(iterator), "retry: 5000\n\n")
            return await anext(iterator)

        with patch(
            "backend.routes.gps._cached_admin_live_tracking",
            return_value=payload,
        ), patch(
            "backend.routes.gps.get_token_identity",
            return_value=("admin", 1, "session-9"),
        ):
            response = stream_admin_live_tracking(RequestStub(), UserStub())
            event = asyncio.run(first_data_event(response))

        self.assertIn('"bus_number":"BUS-3"', event)
        self.assertIn('"latitude":10.3', event)


if __name__ == "__main__":
    unittest.main()
