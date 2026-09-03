"""Provider timestamps must be strict when selecting the visible GPS state."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Bus, Route, RouteStop, Stop
from fastapi import Response

from backend.routes.gps_provider import (
    _serialize_state,
    get_provider_health,
    ingest_positions,
    list_provider_positions,
)
from backend.routes.models_tracking import BusGPSState, GPSIngestToken, LiveTrip, ProviderGPSPosition


class ProviderGpsFreshnessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / f"bus_tracker_provider_freshness_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    @staticmethod
    def _request() -> SimpleNamespace:
        return SimpleNamespace(state=SimpleNamespace())

    @staticmethod
    def _payload(latitude: float, fix_time: datetime) -> dict:
        return {
            "uniqueId": "FRESHNESS-DEVICE",
            "latitude": latitude,
            "longitude": 76.0,
            "speed": 0,
            "fixTime": fix_time.isoformat().replace("+00:00", "Z"),
            "valid": True,
            "attributes": {"ignition": False, "motion": False},
        }

    def test_equal_or_older_provider_fix_cannot_replace_visible_state(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="FRESH-01", registration_number="FRESH-REG-01", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active", device_id="FRESHNESS-DEVICE")
            token = GPSIngestToken(label="freshness", token_hash=hashlib.sha256(b"freshness-token").hexdigest(), is_active=True)
            database_session.add_all([bus, token])
            database_session.commit()

            recorded_at = datetime(2026, 8, 24, 8, 30, tzinfo=timezone.utc)
            first = ingest_positions(self._request(), self._payload(10.0, recorded_at), "freshness-token", database_session)
            equal = ingest_positions(self._request(), self._payload(11.0, recorded_at), "freshness-token", database_session)
            older = ingest_positions(
                self._request(),
                self._payload(12.0, recorded_at.replace(minute=29)),
                "freshness-token",
                database_session,
            )

            state = database_session.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).one()
            self.assertEqual(first["accepted"][0]["applied_to_current_state"], True)
            self.assertEqual(equal["accepted"][0]["applied_to_current_state"], False)
            self.assertEqual(equal["accepted"][0]["route_progression_reconciled"], False)
            self.assertEqual(older["accepted"][0]["applied_to_current_state"], False)
            self.assertEqual(state.latitude, 10.0)
            self.assertEqual(database_session.query(ProviderGPSPosition).filter(ProviderGPSPosition.bus_id == bus.id).count(), 3)

    def test_stale_provider_state_remains_available_as_last_known_location(self) -> None:
        old_fix = datetime(2020, 1, 1, tzinfo=timezone.utc)
        state = SimpleNamespace(
            external_device_id="LAST-KNOWN-DEVICE",
            latitude=10.0,
            longitude=76.0,
            speed_kmh=0.0,
            course=None,
            altitude=None,
            accuracy=8.0,
            fix_time=old_fix,
            received_at=old_fix,
            status="Parked",
            ignition=False,
            motion=False,
            valid=True,
            protocol="test",
        )
        bus = SimpleNamespace(
            id=1,
            bus_number="LAST-01",
            registration_number="LAST-REG",
        )

        payload = _serialize_state(state, bus)

        self.assertFalse(payload["is_fresh"])
        self.assertEqual(payload["tracking_source"], "vehicle_gps_last_known")
        self.assertEqual((payload["latitude"], payload["longitude"]), (10.0, 76.0))

    def test_vendor_validity_flag_does_not_discard_a_usable_coordinate(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="VALID-FLAG-01", registration_number="VALID-FLAG-REG", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active", device_id="VALID-FLAG-DEVICE")
            token = GPSIngestToken(label="valid-flag", token_hash=hashlib.sha256(b"valid-flag-token").hexdigest(), is_active=True)
            database_session.add_all([bus, token])
            database_session.commit()

            fix_time = datetime(2026, 8, 24, 8, 30, tzinfo=timezone.utc)
            payload = self._payload(10.5, fix_time)
            payload["uniqueId"] = "VALID-FLAG-DEVICE"
            payload["valid"] = False
            result = ingest_positions(self._request(), payload, "valid-flag-token", database_session)

            state = database_session.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).one()
            self.assertTrue(result["accepted"][0]["applied_to_current_state"])
            self.assertFalse(state.valid)
            self.assertEqual((state.latitude, state.longitude), (10.5, 76.0))

    def test_missing_device_timestamp_uses_receipt_time(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="NO-TIME-01", registration_number="NO-TIME-REG", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active", device_id="NO-TIME-DEVICE")
            token = GPSIngestToken(label="no-time", token_hash=hashlib.sha256(b"no-time-token").hexdigest(), is_active=True)
            database_session.add_all([bus, token])
            database_session.commit()

            payload = self._payload(10.25, datetime(2026, 8, 24, 8, 30, tzinfo=timezone.utc))
            payload["uniqueId"] = "NO-TIME-DEVICE"
            payload.pop("fixTime")
            payload["valid"] = False
            result = ingest_positions(self._request(), payload, "no-time-token", database_session)

            state = database_session.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).one()
            self.assertTrue(result["accepted"][0]["applied_to_current_state"])
            self.assertIsNone(state.fix_time)
            self.assertEqual((state.latitude, state.longitude), (10.25, 76.0))

    def test_equal_poll_recovers_trip_after_route_is_assigned(self) -> None:
        """A saved provider fix must seed route state after a late assignment."""

        with self.session_factory() as database_session:
            bus = Bus(bus_number="RECOVER-01", registration_number="RECOVER-REG-01", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active", device_id="RECOVER-DEVICE")
            token = GPSIngestToken(label="recover", token_hash=hashlib.sha256(b"recover-token").hexdigest(), is_active=True)
            database_session.add_all([bus, token])
            database_session.commit()

            fix_time = datetime(2026, 8, 24, 8, 30, tzinfo=timezone.utc)
            first_payload = self._payload(10.0, fix_time)
            first_payload["uniqueId"] = "RECOVER-DEVICE"
            first = ingest_positions(self._request(), first_payload, "recover-token", database_session)
            self.assertIsNone(first["accepted"][0]["active_trip_id"])

            route = Route(route_code="RECOVER-R", route_name="Recovered Route", bus_id=bus.id, driver_id=None, status="Active", total_stops=2)
            start = Stop(stop_code="RECOVER-A", stop_name="Recovered Start", latitude=10.0, longitude=76.0, radius=100, status="Active")
            end = Stop(stop_code="RECOVER-B", stop_name="Recovered End", latitude=10.1, longitude=76.1, radius=100, status="Active")
            database_session.add_all([route, start, end])
            database_session.flush()
            database_session.add_all([
                RouteStop(route_id=route.id, stop_id=start.id, sequence=1),
                RouteStop(route_id=route.id, stop_id=end.id, sequence=2),
            ])
            database_session.commit()

            repeated_payload = self._payload(11.0, fix_time)
            repeated_payload["uniqueId"] = "RECOVER-DEVICE"
            repeated = ingest_positions(self._request(), repeated_payload, "recover-token", database_session)

            state = database_session.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).one()
            trip = database_session.query(LiveTrip).filter(LiveTrip.bus_id == bus.id).one()
            self.assertFalse(repeated["accepted"][0]["applied_to_current_state"])
            self.assertTrue(repeated["accepted"][0]["route_progression_reconciled"])
            self.assertEqual(repeated["accepted"][0]["active_trip_id"], trip.id)
            self.assertEqual(state.latitude, 10.0)
            self.assertEqual(trip.current_latitude, 10.0)
            self.assertIsNone(trip.driver_id)
            self.assertEqual(trip.current_route_stop_id, route.route_stops[0].id)

    def test_provider_health_separates_recent_contact_from_delayed_device_fix(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="HEALTH-01", registration_number="HEALTH-REG-01", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active", device_id="HEALTH-DEVICE")
            token = GPSIngestToken(label="health", token_hash=hashlib.sha256(b"health-token").hexdigest(), is_active=True)
            database_session.add_all([bus, token])
            database_session.commit()

            old_fix = datetime.now(timezone.utc) - timedelta(minutes=22)
            payload = self._payload(10.75, old_fix)
            payload["uniqueId"] = "HEALTH-DEVICE"
            payload["providerExtra"] = {"heartbeat": "20-second"}
            ingest_positions(self._request(), payload, "health-token", database_session)

            health_response = Response()
            result = get_provider_health(
                response=health_response,
                bus_id=bus.id,
                db=database_session,
                _technician=SimpleNamespace(),
            )
            self.assertEqual(health_response.headers["cache-control"], "no-store")
            self.assertEqual(len(result["buses"]), 1)
            self.assertEqual(result["buses"][0]["health_status"], "delayed")
            self.assertLess(result["buses"][0]["provider_contact_age_seconds"], 5)
            self.assertGreater(result["buses"][0]["device_data_age_seconds"], 20 * 60)

            history_response = Response()
            history = list_provider_positions(
                response=history_response,
                bus_id=bus.id,
                limit=100,
                offset=0,
                db=database_session,
                _technician=SimpleNamespace(),
            )
            self.assertEqual(history_response.headers["cache-control"], "no-store")
            self.assertEqual(history["total"], 1)
            self.assertEqual(history["positions"][0]["bus_id"], bus.id)
            self.assertEqual(history["positions"][0]["provider_payload"]["providerExtra"]["heartbeat"], "20-second")


if __name__ == "__main__":
    unittest.main()
