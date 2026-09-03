"""Airotrack polling must recover a missing provider-owned route session."""

from __future__ import annotations

from datetime import datetime, timedelta
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Bus, Route, RouteStop, Stop
from backend.routes.models_tracking import BusGPSState, GPSProviderHealthState, LiveTrip, ProviderGPSPosition
from backend.services.airotrack import _store_position, refresh_airotrack


class AirotrackReconciliationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / f"bus_tracker_airotrack_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    def test_repeated_poll_recovers_trip_after_late_route_assignment(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="AIRO-01", registration_number="KL-08-AIRO-01", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            database_session.add(bus)
            database_session.commit()

            source_date = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d-%m-%Y %I:%M:%S %p")
            vendor_data = {
                "vehicle_registration": bus.registration_number,
                "latitude": 10.0,
                "longitude": 76.0,
                "imei_no": "AIRO-IMEI-01",
                "source_date": source_date,
                "speed": 0,
                "ignition": "OFF",
            }
            first = _store_position(database_session, bus, vendor_data)
            database_session.commit()
            self.assertIsNone(first["active_trip_id"])

            route = Route(route_code="AIRO-R", route_name="Airotrack Route", bus_id=bus.id, driver_id=None, status="Active", total_stops=2)
            start = Stop(stop_code="AIRO-A", stop_name="Airotrack Start", latitude=10.0, longitude=76.0, radius=100, status="Active")
            end = Stop(stop_code="AIRO-B", stop_name="Airotrack End", latitude=10.1, longitude=76.1, radius=100, status="Active")
            database_session.add_all([route, start, end])
            database_session.flush()
            database_session.add_all([
                RouteStop(route_id=route.id, stop_id=start.id, sequence=1),
                RouteStop(route_id=route.id, stop_id=end.id, sequence=2),
            ])
            database_session.commit()

            repeated = _store_position(database_session, bus, vendor_data)
            database_session.commit()

            state = database_session.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).one()
            trip = database_session.query(LiveTrip).filter(LiveTrip.bus_id == bus.id).one()
            self.assertFalse(repeated["applied"])
            self.assertEqual(repeated["active_trip_id"], trip.id)
            self.assertEqual((trip.current_latitude, trip.current_longitude), (state.latitude, state.longitude))
            self.assertIsNone(trip.driver_id)
            self.assertEqual(trip.current_route_stop_id, route.route_stops[0].id)

    def test_stale_poll_catches_up_until_provider_timestamp_stops_advancing(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="AIRO-CATCHUP", registration_number="KL-08-CATCHUP", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            database_session.add(bus)
            database_session.commit()

            now = datetime.now(ZoneInfo("Asia/Kolkata"))
            first_time = now - timedelta(minutes=20)
            newest_time = now - timedelta(minutes=19)

            def response(latitude: float, source_time: datetime) -> dict:
                return {
                    "status": "success",
                    "data": {
                        "vehicle_registration": bus.registration_number,
                        "latitude": latitude,
                        "longitude": 76.0,
                        "imei_no": "AIRO-CATCHUP-IMEI",
                        "source_date": source_time.strftime("%d-%m-%Y %I:%M:%S %p"),
                        "speed": 0,
                        "ignition": "ON",
                    },
                }

            responses = [
                response(10.0, first_time),
                response(11.0, newest_time),
                response(12.0, newest_time),
            ]
            with patch.dict(os.environ, {
                "AIROTRACK_API_TOKEN": "test-token",
                "AIROTRACK_CATCHUP_MAX_REQUESTS": "8",
            }), patch("backend.services.airotrack._request_vehicle", side_effect=responses) as vendor_request:
                result = refresh_airotrack(database_session, bus_id=bus.id)

            state = database_session.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).one()
            health = database_session.query(GPSProviderHealthState).filter(GPSProviderHealthState.bus_id == bus.id).one()
            self.assertEqual(vendor_request.call_count, 3)
            self.assertEqual(result["updated"][0]["provider_requests"], 3)
            self.assertEqual(result["updated"][0]["source_date"], newest_time.astimezone(ZoneInfo("UTC")).replace(microsecond=0))
            self.assertEqual(state.latitude, 11.0)
            self.assertEqual(database_session.query(ProviderGPSPosition).filter(ProviderGPSPosition.bus_id == bus.id).count(), 3)
            self.assertEqual(health.consecutive_errors, 0)

    def test_delayed_but_newer_fix_still_advances_provider_route_state(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="AIRO-DELAYED", registration_number="KL-08-DELAYED", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active")
            database_session.add(bus)
            database_session.flush()
            route = Route(route_code="AIRO-DELAYED-R", route_name="Delayed Route", bus_id=bus.id, driver_id=None, status="Active", total_stops=2)
            start = Stop(stop_code="AIRO-D-A", stop_name="Delayed Start", latitude=10.0, longitude=76.0, radius=100, status="Active")
            end = Stop(stop_code="AIRO-D-B", stop_name="Delayed End", latitude=10.1, longitude=76.1, radius=100, status="Active")
            database_session.add_all([route, start, end])
            database_session.flush()
            database_session.add_all([
                RouteStop(route_id=route.id, stop_id=start.id, sequence=1),
                RouteStop(route_id=route.id, stop_id=end.id, sequence=2),
            ])
            database_session.commit()

            delayed_time = datetime.now(ZoneInfo("Asia/Kolkata")) - timedelta(minutes=22)
            result = _store_position(database_session, bus, {
                "vehicle_registration": bus.registration_number,
                "latitude": 10.0,
                "longitude": 76.0,
                "imei_no": "AIRO-DELAYED-IMEI",
                "source_date": delayed_time.strftime("%d-%m-%Y %I:%M:%S %p"),
                "speed": 0,
                "ignition": "OFF",
            })
            database_session.commit()

            trip = database_session.query(LiveTrip).filter(LiveTrip.bus_id == bus.id).one()
            self.assertEqual(result["active_trip_id"], trip.id)
            self.assertEqual(trip.current_route_stop_id, route.route_stops[0].id)
            self.assertEqual((trip.current_latitude, trip.current_longitude), (10.0, 76.0))


if __name__ == "__main__":
    unittest.main()
