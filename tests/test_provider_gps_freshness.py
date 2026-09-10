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
from backend.models import Bus, Route, RouteStop, Stop, Student, User
from fastapi import Response

from backend.routes.gps_provider import (
    _serialize_state,
    get_provider_health,
    ingest_positions,
    list_provider_positions,
)
from backend.routes.models_tracking import BusGPSState, GPSIngestToken, LiveTrip, ProviderGPSPosition
from backend.routes.student import get_student_live_tracking
from backend.services.gps_timestamp import repair_future_gps_states


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

    def test_provider_health_compares_latest_and_previous_accepted_fixes(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="GAP-01", registration_number="GAP-REG", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active", device_id="GAP-DEVICE")
            token = GPSIngestToken(label="gap", token_hash=hashlib.sha256(b"gap-token").hexdigest(), is_active=True)
            database_session.add_all([bus, token])
            database_session.commit()

            current_time = datetime.now(timezone.utc)
            previous_time = current_time - timedelta(seconds=290)
            latest_time = current_time - timedelta(seconds=120)
            previous = self._payload(10.0, previous_time)
            previous["uniqueId"] = "GAP-DEVICE"
            latest = self._payload(10.1, latest_time)
            latest["uniqueId"] = "GAP-DEVICE"
            ingest_positions(self._request(), previous, "gap-token", database_session)
            ingest_positions(self._request(), latest, "gap-token", database_session)

            health = get_provider_health(
                response=Response(),
                bus_id=bus.id,
                db=database_session,
                _technician=SimpleNamespace(),
            )["buses"][0]
            self.assertEqual(health["device_update_gap_seconds"], 170)
            self.assertEqual(health["device_update_delay_seconds"], 50)
            self.assertEqual(
                health["previous_device_time"].replace(tzinfo=timezone.utc),
                previous_time,
            )
            self.assertIsNotNone(health["latest_accepted_received_at"])
            self.assertGreaterEqual(health["latest_delivery_delay_seconds"], 120)

    def test_provider_heartbeats_drive_student_map_and_track_through_return_leg(self) -> None:
        """The student response keeps the same stop state for map and railway views."""

        with self.session_factory() as database_session:
            student_user = User(username="heartbeat-student", password_hash="unused", full_name="Heartbeat Student", role="User", status="Active")
            bus = Bus(bus_number="HEART-01", registration_number="HEART-REG", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active", device_id="HEART-DEVICE")
            token = GPSIngestToken(label="heartbeat", token_hash=hashlib.sha256(b"heartbeat-token").hexdigest(), is_active=True)
            database_session.add_all([student_user, bus, token])
            database_session.flush()
            route = Route(route_code="HEART-R", route_name="Heartbeat Route", bus_id=bus.id, driver_id=None, status="Active", total_stops=3)
            stops = [
                Stop(stop_code="HEART-A", stop_name="Start", latitude=10.0, longitude=76.0, radius=120, status="Active"),
                Stop(stop_code="HEART-B", stop_name="Middle", latitude=10.01, longitude=76.01, radius=120, status="Active"),
                Stop(stop_code="HEART-C", stop_name="Terminal", latitude=10.02, longitude=76.02, radius=120, status="Active"),
            ]
            database_session.add_all([route, *stops])
            database_session.flush()
            database_session.add_all([
                RouteStop(route_id=route.id, stop_id=stop.id, sequence=index)
                for index, stop in enumerate(stops, start=1)
            ])
            database_session.add(Student(user_id=student_user.id, student_code="HEART-STUDENT", route_id=route.id, bus_id=bus.id, stop_id=stops[0].id))
            database_session.commit()

            first_fix = datetime.now(timezone.utc)

            def send(latitude: float, longitude: float, fix_time: datetime) -> None:
                ingest_positions(
                    self._request(),
                    {
                        "uniqueId": "HEART-DEVICE",
                        "latitude": latitude,
                        "longitude": longitude,
                        "speed": 0,
                        "fixTime": fix_time.isoformat().replace("+00:00", "Z"),
                        "valid": True,
                        "attributes": {"ignition": False, "motion": False},
                    },
                    "heartbeat-token",
                    database_session,
                )

            send(stops[0].latitude, stops[0].longitude, first_fix)
            at_start = get_student_live_tracking(student_user, database_session)
            self.assertEqual(at_start["trip"]["route_direction"], "forward")
            self.assertEqual([item["tracking_status"] for item in at_start["stops"]], ["reached", "pending", "pending"])

            # An ignition-off heartbeat at the terminal must still update the
            # tracker and immediately reverse the live route order.
            send(stops[2].latitude, stops[2].longitude, first_fix + timedelta(minutes=2))
            at_terminal = get_student_live_tracking(student_user, database_session)
            self.assertEqual(at_terminal["trip"]["route_direction"], "reverse")
            self.assertEqual([item["stop_code"] for item in at_terminal["stops"]], ["HEART-C", "HEART-B", "HEART-A"])
            self.assertEqual([item["tracking_status"] for item in at_terminal["stops"]], ["terminal_completed", "pending", "pending"])

            # The next accepted provider coordinate is consumed in the return
            # direction, rather than being ignored after the reversal.
            send(stops[1].latitude, stops[1].longitude, first_fix + timedelta(minutes=4))
            at_return_stop = get_student_live_tracking(student_user, database_session)
            self.assertEqual(at_return_stop["trip"]["route_direction"], "reverse")
            self.assertEqual([item["tracking_status"] for item in at_return_stop["stops"]], ["completed", "reached", "pending"])

            # If the provider subsequently goes quiet, the student response
            # retains the last accepted location and geofence state instead of
            # removing the bus or resetting the railway tracker.
            trip = database_session.query(LiveTrip).filter(LiveTrip.bus_id == bus.id).one()
            state = database_session.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).one()
            stale_time = datetime.now(timezone.utc) - timedelta(hours=1)
            trip.last_location_update = stale_time
            state.fix_time = stale_time
            state.received_at = stale_time
            database_session.commit()
            last_known = get_student_live_tracking(student_user, database_session)
            self.assertFalse(last_known["trip"]["telemetry"]["is_fresh"])
            self.assertEqual((last_known["trip"]["latitude"], last_known["trip"]["longitude"]), (stops[1].latitude, stops[1].longitude))
            self.assertEqual([item["tracking_status"] for item in last_known["stops"]], ["completed", "reached", "pending"])

    def test_future_webhook_fix_is_quarantined_without_replacing_live_state(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="CLOCK-01", registration_number="CLOCK-REG", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active", device_id="CLOCK-DEVICE")
            token = GPSIngestToken(label="clock", token_hash=hashlib.sha256(b"clock-token").hexdigest(), is_active=True)
            database_session.add_all([bus, token])
            database_session.commit()

            current_time = datetime.now(timezone.utc)
            accepted_time = current_time - timedelta(minutes=1)
            accepted = self._payload(10.0, accepted_time)
            accepted["uniqueId"] = "CLOCK-DEVICE"
            ingest_positions(self._request(), accepted, "clock-token", database_session)

            future_time = current_time + timedelta(days=2)
            future = self._payload(12.0, future_time)
            future["uniqueId"] = "CLOCK-DEVICE"
            result = ingest_positions(self._request(), future, "clock-token", database_session)

            state = database_session.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).one()
            rows = database_session.query(ProviderGPSPosition).filter(
                ProviderGPSPosition.bus_id == bus.id,
            ).order_by(ProviderGPSPosition.id.desc()).all()
            self.assertEqual(result["accepted"], [])
            self.assertTrue(result["ignored"][0]["quarantined"])
            self.assertEqual(state.latitude, 10.0)
            self.assertEqual(state.fix_time.replace(tzinfo=timezone.utc), accepted_time)
            self.assertIsNotNone(rows[0].quarantine_reason)

            response = Response()
            health = get_provider_health(
                response=response,
                bus_id=bus.id,
                db=database_session,
                _technician=SimpleNamespace(),
            )["buses"][0]
            self.assertEqual(health["health_status"], "clock_error")
            self.assertIsNotNone(health["timestamp_warning"])
            self.assertGreater(health["device_clock_ahead_seconds"], 24 * 60 * 60)
            self.assertEqual(
                health["latest_device_time"].replace(tzinfo=timezone.utc),
                accepted_time,
            )

            history = list_provider_positions(
                response=Response(),
                bus_id=bus.id,
                limit=100,
                offset=0,
                db=database_session,
                _technician=SimpleNamespace(),
            )
            self.assertTrue(history["positions"][0]["quarantined"])
            self.assertFalse(history["positions"][0]["applied_to_current_state"])

    def test_startup_repair_restores_newest_nonfuture_provider_state(self) -> None:
        with self.session_factory() as database_session:
            current_time = datetime.now(timezone.utc)
            valid_time = current_time - timedelta(minutes=2)
            future_time = current_time + timedelta(days=3)
            bus = Bus(bus_number="REPAIR-01", registration_number="REPAIR-REG", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            database_session.add(bus)
            database_session.flush()
            route = Route(route_code="REPAIR-R", route_name="Repair Route", bus_id=bus.id, driver_id=None, status="Active", total_stops=1)
            stop = Stop(stop_code="REPAIR-A", stop_name="Repair Start", latitude=10.0, longitude=76.0, radius=100, status="Active")
            database_session.add_all([route, stop])
            database_session.flush()
            route_stop = RouteStop(route_id=route.id, stop_id=stop.id, sequence=1)
            valid = ProviderGPSPosition(bus_id=bus.id, external_device_id="REPAIR-DEVICE", latitude=10.0, longitude=76.0, speed_kmh=0, fix_time=valid_time, received_at=valid_time + timedelta(seconds=1), protocol="test", raw_payload="{}")
            poisoned = ProviderGPSPosition(bus_id=bus.id, external_device_id="REPAIR-DEVICE", latitude=12.0, longitude=78.0, speed_kmh=50, fix_time=future_time, received_at=current_time, protocol="test", raw_payload="{}")
            database_session.add_all([route_stop, valid, poisoned])
            database_session.flush()
            state = BusGPSState(bus_id=bus.id, provider_position_id=poisoned.id, external_device_id="REPAIR-DEVICE", latitude=poisoned.latitude, longitude=poisoned.longitude, speed_kmh=poisoned.speed_kmh, fix_time=future_time, received_at=current_time, protocol="test", raw_payload="{}")
            trip = LiveTrip(bus_id=bus.id, route_id=route.id, driver_id=None, status="Running", route_direction="forward", current_route_stop_id=route_stop.id, current_stop_status="Approaching", current_latitude=poisoned.latitude, current_longitude=poisoned.longitude, current_speed=poisoned.speed_kmh, last_location_update=future_time, current_location_source="vehicle_gps", started_at=future_time, route_reset_at=current_time - timedelta(minutes=1), reset_waiting_for_start=True, reset_version=1)
            database_session.add_all([state, trip])
            database_session.commit()

            repair_result = repair_future_gps_states(database_session, now=current_time)
            database_session.commit()

            database_session.refresh(state)
            database_session.refresh(trip)
            database_session.refresh(poisoned)
            self.assertGreaterEqual(repair_result["quarantined_positions"], 1)
            self.assertEqual(repair_result["repaired_states"], 1)
            self.assertEqual(state.provider_position_id, valid.id)
            self.assertEqual((state.latitude, state.longitude), (10.0, 76.0))
            self.assertEqual(trip.last_location_update.replace(tzinfo=timezone.utc), valid_time)
            self.assertTrue(trip.reset_waiting_for_start)
            self.assertEqual(trip.current_route_stop_id, route_stop.id)
            self.assertIsNotNone(poisoned.quarantine_reason)


if __name__ == "__main__":
    unittest.main()
