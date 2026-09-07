"""Manual reset must survive delayed telemetry, navigation and process restart."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import tempfile
from threading import Event
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base, get_db, _add_trip_reset_columns
from backend.models import AuditEvent, Bus, Driver, Route, RouteStop, Stop, Student, User
from backend.routes.gps import update_location, change_trip_direction
from backend.routes.gps_provider import (
    get_trip_reset_options, reset_provider_trip, ingest_positions,
    get_driver_tracking_source, override_provider_trip_direction, router,
)
from backend.routes.models_tracking import BusGPSState, GPSIngestToken, LiveLocation, LiveTrip, TripStopEvent
from backend.routes.student import get_student_live_tracking
from backend.schemas_gps_provider import GPSProviderTripReset, GPSProviderTripDirectionUpdate
from backend.schemas_tracking import LocationUpdateRequest, TripDirectionRequest
from backend.security import require_authenticated
from backend.services.airotrack import _store_position
from backend.services.trip_reset import as_utc, lock_tracking_bus


class TripResetTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bus-reset-tests-")
        self.url = f"sqlite:///{Path(self.temp.name).as_posix()}/test.db"
        self.engine = create_engine(self.url, connect_args={"check_same_thread": False, "timeout": 10})
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, autoflush=False)
        self.db = self.sessions()
        self.now = datetime.now(timezone.utc) - timedelta(seconds=30)
        self.old = self.now - timedelta(hours=35)
        self.tech = User(username="tech", full_name="Tech", password_hash="unused", role="Technician", status="Active")
        self.user = User(username="student", full_name="Student", password_hash="unused", role="User", status="Active")
        self.driver_user = User(username="driver", full_name="Driver", password_hash="unused", role="Driver", status="Active")
        self.bus = Bus(bus_number="RESET", registration_number="RESET-REG", device_id="RESET-DEVICE", capacity=40, manufacturer="Test", model="Test", year=2026, fuel_type="Diesel", status="Active")
        self.db.add_all([self.tech, self.user, self.driver_user, self.bus]); self.db.flush()
        self.driver = Driver(user_id=self.driver_user.id, driver_code="DRV", license_number="LIC", license_expiry=date(2030,1,1), status="Available", bus_id=self.bus.id)
        self.db.add(self.driver); self.db.flush()
        self.route = Route(route_code="R", route_name="Reset route", bus_id=self.bus.id, driver_id=self.driver.id, status="Active", total_stops=3)
        self.stops = [Stop(stop_code=f"S{i}", stop_name=f"Stop {i}", latitude=10+i*.01, longitude=76, radius=50, status="Active") for i in range(3)]
        self.db.add_all([self.route, *self.stops]); self.db.flush()
        self.route_stops = [RouteStop(route_id=self.route.id, stop_id=stop.id, sequence=i+1) for i,stop in enumerate(self.stops)]
        self.db.add_all(self.route_stops); self.db.flush()
        self.trip = LiveTrip(driver_id=self.driver.id, bus_id=self.bus.id, route_id=self.route.id, status="Running", route_direction="forward", current_route_stop_id=self.route_stops[1].id, current_stop_status="Arrived", current_stop_arrived_at=self.old, current_latitude=10.01, current_longitude=76, current_speed=10, last_location_update=self.old, current_location_source="vehicle_gps", terminal_reached_at=self.old, terminal_stop_id=self.stops[1].id)
        self.db.add(self.trip); self.db.flush()
        self.db.add_all([
            Student(user_id=self.user.id, student_code="ST", route_id=self.route.id, bus_id=self.bus.id, stop_id=self.stops[0].id),
            GPSIngestToken(label="test", token_hash=hashlib.sha256(b"test-token").hexdigest(), is_active=True),
            BusGPSState(bus_id=self.bus.id, external_device_id="RESET-DEVICE", latitude=10.01, longitude=76, fix_time=self.old, received_at=self.old, speed_kmh=10, ignition=True, valid=True, raw_payload="{}"),
            LiveLocation(trip_id=self.trip.id, latitude=10.01, longitude=76, recorded_at=self.old, source="vehicle_gps"),
            TripStopEvent(trip_id=self.trip.id, route_stop_id=self.route_stops[1].id, stop_id=self.stops[1].id, event_type="Arrived", occurred_at=self.old),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close(); self.engine.dispose(); self.temp.cleanup()

    def payload(self, direction="forward", **overrides):
        return GPSProviderTripReset(**{**dict(direction=direction, trip_id=self.trip.id,
            expected_reset_version=self.trip.reset_version or 0, request_id=uuid4()), **overrides})

    def reset(self, direction="forward", payload=None):
        with patch("backend.routes.gps_provider._utc_now", return_value=self.now):
            return reset_provider_trip(self.bus.id, payload or self.payload(direction), None, self.db, self.tech)

    def ingest(self, stop_index, seconds, db=None):
        return ingest_positions(SimpleNamespace(state=SimpleNamespace()), {
            "uniqueId":"RESET-DEVICE", "latitude":10+stop_index*.01, "longitude":76,
            "speed":10, "fixTime":(self.now+timedelta(seconds=seconds)).isoformat(),
            "attributes":{"ignition":True},
        }, "test-token", db or self.db)

    def test_outbound_reset_preserves_physical_location_history_and_assignments(self):
        result = self.reset()
        tracking = get_student_live_tracking(self.user, self.db)
        self.assertEqual([s["tracking_status"] for s in tracking["stops"]], ["approaching","pending","pending"])
        self.assertEqual(tracking["trip"]["latitude"], 10.01)
        self.assertFalse(tracking["telemetry"]["is_fresh"])
        self.assertEqual(as_utc(self.trip.last_location_update), self.old)
        self.assertIsNone(self.trip.terminal_stop_id)
        self.assertIsNone(self.trip.current_stop_arrived_at)
        self.assertTrue(result["reset_waiting_for_start"])
        self.assertEqual(self.db.query(LiveLocation).count(),1)
        self.assertEqual(self.db.query(TripStopEvent).count(),1)
        self.assertEqual([s.sequence for s in self.route_stops],[1,2,3])
        self.assertEqual(self.db.query(AuditEvent).filter_by(action="trip_progression_reset").count(),1)
        self.assertTrue(get_driver_tracking_source(self.driver_user,self.db)["reset_waiting_for_start"])

    def test_return_preview_and_reset_use_original_last_stop(self):
        options = get_trip_reset_options(self.bus.id,self.db,self.tech)
        self.assertEqual(options["starts"]["forward"]["name"],"Stop 0")
        self.assertEqual(options["starts"]["reverse"]["name"],"Stop 2")
        self.reset("reverse")
        self.assertEqual(self.trip.current_route_stop_id,self.route_stops[2].id)
        tracking = get_student_live_tracking(self.user,self.db)
        self.assertEqual([s["stop_name"] for s in tracking["stops"]],["Stop 2","Stop 1","Stop 0"])
        self.assertEqual([s["tracking_status"] for s in tracking["stops"]],["approaching","pending","pending"])

    def test_old_replayed_and_fresh_away_packets_cannot_undo_reset(self):
        self.reset()
        for stop_index,seconds in [(2,-10),(2,-10),(0,-11),(0,0),(2,1)]:
            self.ingest(stop_index,seconds)
            self.db.refresh(self.trip)
            self.assertTrue(self.trip.reset_waiting_for_start)
            self.assertEqual(self.trip.current_route_stop_id,self.route_stops[0].id)
            self.assertEqual(self.trip.route_direction,"forward")
        self.ingest(0,2)
        self.db.refresh(self.trip)
        self.assertFalse(self.trip.reset_waiting_for_start)
        self.assertEqual(self.trip.current_stop_status,"Arrived")
        self.ingest(2,1)  # older observation after the reset has unlocked
        self.db.refresh(self.trip)
        self.assertEqual(self.trip.current_route_stop_id,self.route_stops[0].id)

    def test_new_journey_still_advances_skips_and_reverses_once(self):
        self.reset()
        self.ingest(0,1)
        self.ingest(2,2)  # legitimate shortcut once start was confirmed
        self.db.refresh(self.trip)
        self.assertEqual(self.trip.route_direction,"reverse")
        self.ingest(2,2)
        self.ingest(2,3)
        self.db.refresh(self.trip)
        self.assertEqual(self.trip.route_direction,"reverse")
        self.ingest(1,4)
        self.ingest(0,5)
        self.db.refresh(self.trip)
        self.assertEqual(self.trip.route_direction,"forward")

    def test_return_reset_unlocks_then_finishes_at_original_first_stop(self):
        self.reset("reverse")
        self.ingest(0,1)
        self.assertTrue(self.trip.reset_waiting_for_start)
        self.ingest(2,2)
        self.ingest(1,3)
        self.ingest(0,4)
        self.db.refresh(self.trip)
        self.assertEqual(self.trip.route_direction,"forward")

    def test_phone_rejects_old_callbacks_and_unlocks_only_at_first_stop(self):
        self.reset()
        for seconds,version in [(-1,1),(1,0),(None,1)]:
            response = update_location(LocationUpdateRequest(trip_id=self.trip.id,latitude=10,longitude=76,
                recorded_at=self.now+timedelta(seconds=seconds) if seconds is not None else None,
                reset_version=version),self.driver_user,self.db)
            self.assertFalse(response["applied"])
        for lat,seconds in [(10.02,2),(10.0,3)]:
            update_location(LocationUpdateRequest(trip_id=self.trip.id,latitude=lat,longitude=76,
                recorded_at=self.now+timedelta(seconds=seconds),reset_version=1),self.driver_user,self.db)
        self.assertFalse(self.trip.reset_waiting_for_start)
        self.assertEqual(self.trip.current_stop_status,"Arrived")

    def test_airotrack_repeats_do_not_reconcile_old_progress(self):
        self.reset()
        packet = {"vehicle_registration":"RESET-REG", "imei_no":"RESET-DEVICE", "latitude":10.02,
                  "longitude":76,"speed":10,"ignition":"ON","source_date":"06-09-2026 01:00:00 AM"}
        with patch("backend.services.airotrack._as_vendor_time", return_value=self.now-timedelta(seconds=1)):
            _store_position(self.db,self.bus,packet)
            self.db.commit()
        self.assertTrue(self.trip.reset_waiting_for_start)
        self.assertEqual(self.trip.current_route_stop_id,self.route_stops[0].id)

    def test_receipt_time_alone_cannot_unlock_reset(self):
        self.reset()
        ingest_positions(SimpleNamespace(state=SimpleNamespace()), {
            "uniqueId":"RESET-DEVICE", "latitude":10, "longitude":76, "speed":0,
        }, "test-token", self.db)
        self.db.refresh(self.trip)
        self.assertTrue(self.trip.reset_waiting_for_start)
        self.assertEqual(self.trip.current_stop_status,"Approaching")

    def test_duplicate_and_obsolete_reset_requests_do_not_reset_twice(self):
        payload=self.payload()
        self.reset(payload=payload)
        self.ingest(0,1)
        response=self.reset(payload=payload)
        self.assertTrue(response["already_applied"])
        self.assertFalse(self.trip.reset_waiting_for_start)
        with self.assertRaises(HTTPException) as error:
            self.reset(payload=self.payload(expected_reset_version=0))
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.db.query(AuditEvent).filter_by(action="trip_progression_reset").count(),1)

    def test_reset_survives_new_engine_and_session(self):
        self.reset("reverse")
        trip_id=self.trip.id
        self.db.close(); self.engine.dispose()
        restarted=create_engine(self.url)
        try:
            with sessionmaker(bind=restarted,autoflush=False)() as db:
                self.ingest(0,1,db)
                trip=db.get(LiveTrip,trip_id)
                self.assertTrue(trip.reset_waiting_for_start)
                self.assertEqual(trip.route_direction,"reverse")
                self.assertEqual(trip.reset_version,1)
        finally:
            restarted.dispose()

    def test_compatibility_migration_preserves_existing_rows_and_is_repeatable(self):
        legacy = create_engine("sqlite:///:memory:")
        try:
            with legacy.begin() as connection:
                connection.exec_driver_sql("CREATE TABLE live_trips (id INTEGER PRIMARY KEY, current_latitude FLOAT)")
                connection.exec_driver_sql("INSERT INTO live_trips VALUES (1, 10.01)")
            _add_trip_reset_columns(legacy)
            _add_trip_reset_columns(legacy)
            with legacy.connect() as connection:
                row = connection.exec_driver_sql("SELECT current_latitude, reset_version, reset_waiting_for_start, route_reset_at FROM live_trips").one()
                self.assertEqual(tuple(row), (10.01, 0, 0, None))
        finally:
            legacy.dispose()

    def test_assignment_no_trip_and_no_stops_validation(self):
        self.route.status="Inactive"; self.db.commit()
        with self.assertRaises(HTTPException): self.reset()
        self.route.status="Active"; self.trip.status="Stopped"; self.db.commit()
        with self.assertRaises(HTTPException): self.reset()
        self.trip.status="Running"; self.stops[0].latitude=None; self.db.commit()
        with self.assertRaises(HTTPException): self.reset()
        self.assertEqual(self.db.query(AuditEvent).count(),0)

    def test_direction_controls_cannot_bypass_waiting_reset(self):
        self.reset()
        with self.assertRaises(HTTPException):
            override_provider_trip_direction(self.bus.id,GPSProviderTripDirectionUpdate(direction="reverse"),None,self.db,self.tech)
        with self.assertRaises(HTTPException):
            change_trip_direction(TripDirectionRequest(trip_id=self.trip.id,direction="reverse"),db=self.db,current_user=self.driver_user)
        self.assertEqual(self.trip.route_direction,"forward")

    def test_concurrent_provider_waits_for_reset_transaction(self):
        # Hold the same transaction lock used by reset while a provider worker
        # has already loaded the pre-reset trip into its identity map.
        bus_id,trip_id=self.bus.id,self.trip.id
        loaded,attempting,finished=Event(),Event(),Event()
        def provider():
            with self.sessions() as db:
                db.get(LiveTrip,trip_id)
                loaded.set(); attempting.wait(5)
                self.ingest(2,1,db)
                finished.set()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(provider)
            self.assertTrue(loaded.wait(5))
            lock_tracking_bus(self.db,bus_id)
            attempting.set()
            self.assertFalse(finished.wait(.15))
            self.reset()  # commits the reset and releases the lock
            future.result(timeout=10)
        self.db.refresh(self.trip)
        self.assertTrue(self.trip.reset_waiting_for_start)
        self.assertEqual(self.trip.current_route_stop_id,self.route_stops[0].id)

    def test_http_permission_and_validated_endpoint(self):
        app=FastAPI(); app.include_router(router)
        def database():
            with self.sessions() as db: yield db
        app.dependency_overrides[get_db]=database
        async def call(method,path,body=None):
            messages=[]
            async def receive(): return {"type":"http.request","body":json.dumps(body or {}).encode(),"more_body":False}
            async def send(message): messages.append(message)
            await app({"type":"http","asgi":{"version":"3.0"},"http_version":"1.1","scheme":"http",
                "method":method,"path":path,"raw_path":path.encode(),"query_string":b"",
                "headers":[(b"content-type",b"application/json")],"client":("127.0.0.1",1),"server":("test",80),"root_path":""},receive,send)
            return next(m["status"] for m in messages if m["type"]=="http.response.start")
        path=f"/api/integrations/gps/provider-health/buses/{self.bus.id}"
        body=self.payload().model_dump(mode="json")
        # Use the real authorization dependency, replacing only authentication.
        app.dependency_overrides[require_authenticated]=lambda:self.user
        self.assertEqual(asyncio.run(call("POST",path+"/reset",body)),403)
        self.assertEqual(asyncio.run(call("GET",path+"/reset-options")),403)
        app.dependency_overrides[require_authenticated]=lambda:self.tech
        self.assertEqual(asyncio.run(call("GET",path+"/reset-options")),200)
        self.assertEqual(asyncio.run(call("POST",path+"/reset",body)),200)


if __name__ == "__main__":
    unittest.main()
