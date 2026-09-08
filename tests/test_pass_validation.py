"""Security regressions use isolated databases and generated test-only keys."""
import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from io import BytesIO
import json
import os
from pathlib import Path
import tempfile
from threading import Event
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException
import jwt
from PIL import Image
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.database import Base, get_db, _add_pass_credential_columns
from backend.models import User, Bus, Driver, Route, Student, BusPass, PassIdentity, PassVerification
from backend.routes.models_tracking import LiveTrip
from backend.routes.pass_validation import router, live_token, verify_pass, save_identity, EmptyRequest, VerifyRequest, IdentityRequest
from backend.routes.bus_passes import router as admin_router, update_bus_pass
from backend.routes.student import router as student_router, get_current_student_bus_pass
from backend.schemas import BusPassUpdate
from backend.security import require_authenticated, RequestSecurityMiddleware
from backend.services.pass_credentials import utcnow, locked_pass


class PassValidationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pass-validation-")
        self.url = f"sqlite:///{Path(self.temp.name).as_posix()}/test.db"
        self.engine = create_engine(self.url, connect_args={"check_same_thread": False, "timeout": 10})
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, autoflush=False)
        self.db = self.sessions()
        self.key = Ed25519PrivateKey.generate()
        pem = self.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        self.environment = patch.dict(os.environ, {"BUS_PASS_SIGNING_KEY_PEM": pem}); self.environment.start()
        self.admin = User(username="admin", full_name="Admin", password_hash="unused", role="Admin", status="Active")
        self.owner = User(username="owner", full_name="Self editable name", password_hash="unused", role="User", status="Active")
        self.driver_user = User(username="driver", full_name="Driver", password_hash="unused", role="Driver", status="Active")
        self.bus = Bus(bus_number="05", registration_number="TEST05", capacity=40, manufacturer="Test", model="Test", year=2026, fuel_type="Diesel", status="Active")
        self.db.add_all([self.admin, self.owner, self.driver_user, self.bus]); self.db.flush()
        self.driver = Driver(user_id=self.driver_user.id, driver_code="D1", license_number="TEST", license_expiry=date(2030,1,1), bus_id=self.bus.id)
        self.db.add(self.driver); self.db.flush(); self.bus.driver_id = self.driver.id
        self.route = Route(route_code="R05", route_name="Test route", bus_id=self.bus.id, driver_id=self.driver.id, status="Active", total_stops=0)
        self.db.add(self.route); self.db.flush()
        self.student = Student(user_id=self.owner.id, student_code="REG01", route_id=self.route.id, bus_id=self.bus.id)
        self.db.add(self.student); self.db.flush()
        self.bus_pass = BusPass(student_id=self.student.id, pass_number="BP-TEST", status="Active",
            valid_from=date.today()-timedelta(days=1), valid_until=date.today()+timedelta(days=30))
        self.trip = LiveTrip(driver_id=self.driver.id, bus_id=self.bus.id, route_id=self.route.id, status="Running", route_direction="forward")
        output = BytesIO(); Image.new("RGB", (80,100), "blue").save(output, "PNG")
        self.photo = base64.b64encode(output.getvalue()).decode()
        self.db.add_all([self.bus_pass, self.trip]); self.db.commit()
        save_identity(self.student.id, IdentityRequest(official_name="Official Owner", department="Engineering", photo_base64=self.photo), self.db, self.admin)

    def tearDown(self):
        self.environment.stop(); self.db.close(); self.engine.dispose(); self.temp.cleanup()

    def token(self):
        return json.loads(live_token(EmptyRequest(), self.db, self.owner).body)

    def verify(self, token, db=None, actor=None):
        return json.loads(verify_pass(VerifyRequest(signedToken=token), db or self.db, actor or self.driver_user).body)

    def modify(self, token, **changes):
        header, encoded, sig = token.split(".")
        data = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded)%4)))
        data.update(changes)
        return header + "." + base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=") + "." + sig

    def test_valid_outbound_and_return_and_official_photo(self):
        token = self.token()
        self.assertEqual(token["expiresAt"]-token["issuedAt"],25)
        self.assertTrue(token["qrImage"].startswith("data:image/png;base64,"))
        self.owner.full_name = "Borrower's edited profile"; self.db.commit()
        for direction in ("forward", "reverse"):
            self.trip.route_direction = direction; self.db.commit()
            result = self.verify(token["signedToken"])
            self.assertTrue(result["valid"])
            self.assertEqual(result["student"]["name"],"Official Owner")
            self.assertEqual(result["student"]["studentId"],"REG01")
            self.assertTrue(result["student"]["photo"].startswith("data:image/jpeg;base64,"))
            self.assertEqual(result["trip"]["direction"],direction)
            self.assertTrue(result["identityCheckRequired"])

    def test_every_signed_field_tamper_is_rejected(self):
        token = self.token()["signedToken"]
        for name, value in {"busId":7, "studentId":999, "routeId":999, "exp":9999999999,
                "iat":1, "passId":999, "version":999, "passNumber":"BP-FORGED", "jti":"X"*32}.items():
            with self.subTest(field=name):
                result = self.verify(self.modify(token, **{name:value}))
                self.assertEqual(result["status"],"INVALID_SIGNATURE")
                self.assertFalse(result["valid"])

    def test_fake_qr_wrong_signing_key_none_and_symmetric_algorithms(self):
        legitimate = self.token()["signedToken"]
        claims = jwt.decode(legitimate, options={"verify_signature":False})
        candidates = [json.dumps({"studentId":"REG01", "busId":5,"status":"ACTIVE","valid":True}),
            jwt.encode(claims, Ed25519PrivateKey.generate(),algorithm="EdDSA",headers={"typ":"bustrack-pass+jwt"}),
            jwt.encode(claims,"",algorithm="none"), jwt.encode(claims,"X"*32,algorithm="HS256")]
        for token in candidates:
            self.assertEqual(self.verify(token)["status"],"INVALID_SIGNATURE")

    def test_expired_screenshot_differs_from_expired_pass(self):
        token = self.token()["signedToken"]
        with patch("backend.services.pass_credentials.utcnow", return_value=utcnow()+timedelta(seconds=26)):
            self.assertEqual(self.verify(token)["status"],"QR_EXPIRED")
        self.bus_pass.valid_until = date.today()-timedelta(days=1); self.db.commit()
        self.assertEqual(self.verify(token)["status"],"PASS_EXPIRED")

    def test_current_status_is_checked_even_with_valid_signed_token(self):
        token = self.token()["signedToken"]
        for status, expected in [("Revoked","REVOKED"),("Suspended","SUSPENDED"),("Pending","PASS_INACTIVE"),("Expired","PASS_EXPIRED")]:
            self.bus_pass.status=status; self.db.commit()
            self.assertEqual(self.verify(token)["status"], expected)
            with self.assertRaises(HTTPException): self.token()
            self.db.rollback()

    def test_inactive_student_and_missing_photo_fail_closed(self):
        token = self.token()["signedToken"]
        self.owner.status="Inactive"; self.db.commit()
        self.assertEqual(self.verify(token)["status"],"STUDENT_INACTIVE")
        self.owner.status="Active"; self.db.delete(self.db.get(PassIdentity,self.student.id)); self.db.commit()
        self.assertEqual(self.verify(token)["status"],"IDENTITY_REQUIRED")
        with self.assertRaises(HTTPException): self.token()

    def other_trip(self):
        driver_user=User(username="driver7",full_name="Driver 7",password_hash="unused",role="Driver",status="Active")
        bus=Bus(bus_number="07",registration_number="TEST07",capacity=40,manufacturer="Test",model="Test",year=2026,fuel_type="Diesel",status="Active")
        self.db.add_all([driver_user,bus]); self.db.flush()
        driver=Driver(user_id=driver_user.id,driver_code="D7",license_number="L7",license_expiry=date(2030,1,1),bus_id=bus.id)
        self.db.add(driver); self.db.flush(); bus.driver_id=driver.id
        route=Route(route_code="R7",route_name="Route7",bus_id=bus.id,driver_id=driver.id,status="Active",total_stops=0)
        self.db.add(route); self.db.flush()
        trip=LiveTrip(driver_id=driver.id,bus_id=bus.id,route_id=route.id,status="Running")
        self.db.add(trip); self.db.commit()
        return driver_user,bus,route,trip

    def test_wrong_bus_and_wrong_route(self):
        other,_,_,_ = self.other_trip()
        token=self.token()["signedToken"]
        result=self.verify(token,actor=other)
        self.assertEqual(result["status"],"WRONG_BUS")
        self.assertEqual((result["assignedBus"],result["currentBus"]),("05","07"))
        extra=Route(route_code="ALT",route_name="Other route",bus_id=self.bus.id,status="Active",total_stops=0)
        self.db.add(extra); self.db.flush(); self.student.route_id=extra.id; self.db.commit()
        self.assertEqual(self.verify(self.token()["signedToken"])["status"],"WRONG_ROUTE")

    def test_no_active_trip_ambiguous_trip_and_stale_assignment(self):
        token=self.token()["signedToken"]
        self.trip.status="Ended"; self.db.commit()
        self.assertEqual(self.verify(token)["status"],"NO_ACTIVE_TRIP")
        self.trip.status="Running"; self.route.driver_id=None; self.bus.driver_id=None; self.db.commit()
        self.assertEqual(self.verify(token)["status"],"NO_ACTIVE_TRIP")
        self.route.driver_id=self.driver.id
        self.db.add(LiveTrip(driver_id=self.driver.id,bus_id=self.bus.id,route_id=self.route.id,status="Running"));self.db.commit()
        self.assertEqual(self.verify(token)["status"],"NO_ACTIVE_TRIP")

    def test_duplicate_is_idempotent_but_rechecks_revocation(self):
        token=self.token()["signedToken"]
        first=self.verify(token); second=self.verify(token)
        self.assertEqual(first["verificationId"],second["verificationId"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(self.db.query(PassVerification).count(),1)
        self.bus_pass.status="Revoked"; self.db.commit()
        self.assertEqual(self.verify(token)["status"],"REVOKED")

    def test_replay_on_other_bus_and_new_token_on_other_trip(self):
        other,bus,route,_=self.other_trip()
        token=self.token()["signedToken"]; self.assertTrue(self.verify(token)["valid"])
        self.assertEqual(self.verify(token,actor=other)["status"],"REPLAY_SUSPECTED")
        self.student.route_id=route.id; self.student.bus_id=bus.id;self.db.commit()
        self.assertEqual(self.verify(self.token()["signedToken"],actor=other)["status"],"REPLAY_SUSPECTED")

    def test_admin_changes_invalidate_previously_issued_tokens(self):
        token=self.token()["signedToken"]
        update_bus_pass(self.bus_pass.id,BusPassUpdate(status="Suspended"),self.db,self.admin)
        update_bus_pass(self.bus_pass.id,BusPassUpdate(status="Active"),self.db,self.admin)
        self.assertEqual(self.verify(token)["status"],"ASSIGNMENT_CHANGED")
        self.assertTrue(self.verify(self.token()["signedToken"])["valid"])

    def test_assignment_change_and_deleted_pass_rejected(self):
        token=self.token()["signedToken"]
        _,bus,route,_=self.other_trip()
        self.student.route_id=route.id;self.student.bus_id=bus.id;self.db.commit()
        self.assertEqual(self.verify(token)["status"],"ASSIGNMENT_CHANGED")
        self.db.delete(self.bus_pass);self.db.commit()
        self.assertEqual(self.verify(token)["status"],"UNKNOWN_PASS")

    def test_identity_enrollment_validates_images_and_invalidates_tokens(self):
        token=self.token()["signedToken"]
        with self.assertRaises(HTTPException):
            save_identity(self.student.id,IdentityRequest(official_name="Owner",department="Course",photo_base64=base64.b64encode(b"<svg onload=alert(1)>").decode()),self.db,self.admin)
        save_identity(self.student.id,IdentityRequest(official_name="Corrected Owner",department="Course"),self.db,self.admin)
        self.assertEqual(self.verify(token)["status"],"ASSIGNMENT_CHANGED")
        self.assertEqual(get_current_student_bus_pass(self.owner,self.db)["student"]["name"],"Corrected Owner")

    def test_missing_private_key_fails_closed_and_never_leaks_secrets(self):
        token=self.token()
        self.assertNotIn("PRIVATE KEY",json.dumps(token))
        with patch.dict(os.environ,{"BUS_PASS_SIGNING_KEY_PEM":"bad secret configuration"}):
            with self.assertRaises(HTTPException) as error: self.token()
            self.assertEqual(error.exception.status_code,503)
            self.assertNotIn("bad secret",error.exception.detail)
            with self.assertRaises(HTTPException): self.verify(token["signedToken"])

    def test_persistence_and_concurrent_duplicate_scans(self):
        token=self.token()["signedToken"]
        actor_id=self.driver_user.id
        self.db.close()
        def scan():
            with self.sessions() as db:
                return self.verify(token,db=db,actor=db.get(User,actor_id))
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:scan(),range(2)))
        self.assertTrue(all(r["valid"] for r in results))
        self.assertEqual(results[0]["verificationId"],results[1]["verificationId"])
        self.engine.dispose()
        restarted=create_engine(self.url)
        with sessionmaker(bind=restarted)() as db:
            result=self.verify(token,db=db,actor=db.get(User,actor_id))
            self.assertTrue(result["duplicate"])
            self.assertEqual(db.query(PassVerification).count(),1)
        restarted.dispose()

    def test_concurrent_revocation_cannot_be_overwritten_by_scan(self):
        token=self.token()["signedToken"];actor_id=self.driver_user.id;pass_id=self.bus_pass.id
        entered=Event(); finished=Event()
        locked_pass(self.db,pass_id)
        def scan():
            with self.sessions() as db:
                actor=db.get(User,actor_id);entered.set()
                result=self.verify(token,db=db,actor=actor);finished.set();return result
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(scan);self.assertTrue(entered.wait(3));self.assertFalse(finished.wait(.1))
            update_bus_pass(pass_id,BusPassUpdate(status="Revoked"),self.db,self.admin)
            self.assertEqual(future.result(timeout=10)["status"],"REVOKED")

    def http(self,method,path,body=None,actor=None):
        app=FastAPI(); app.include_router(router); app.include_router(admin_router);app.include_router(student_router)
        def database():
            with self.sessions() as db: yield db
        app.dependency_overrides[get_db]=database
        if actor: app.dependency_overrides[require_authenticated]=lambda:actor
        async def call():
            messages=[]
            async def receive(): return {"type":"http.request","body":json.dumps(body or {}).encode(),"more_body":False}
            async def send(message): messages.append(message)
            pathname,_,query=path.partition("?")
            await app({"type":"http","asgi":{"version":"3.0"},"http_version":"1.1","scheme":"http",
                "method":method,"path":pathname,"raw_path":pathname.encode(),"query_string":query.encode(),
                "headers":[(b"content-type",b"application/json")],"client":("127.0.0.1",1),"server":("test",80),"root_path":""},receive,send)
            status=next(m["status"] for m in messages if m["type"]=="http.response.start")
            return status,json.loads(b"".join(m.get("body",b"") for m in messages if m["type"]=="http.response.body") or b"{}")
        return asyncio.run(call())

    def test_http_authentication_and_role_spoofing(self):
        token=self.token()["signedToken"]
        self.assertEqual(self.http("POST","/api/driver/bus-pass/verify",{"signedToken":token})[0],401)
        self.assertEqual(self.http("POST","/api/driver/bus-pass/verify",{"signedToken":token},self.owner)[0],403)
        # An extra claimed role is schema-rejected, not used as authentication.
        self.assertNotEqual(self.http("POST","/api/driver/bus-pass/verify",{"signedToken":token,"role":"Driver"},self.owner)[0],200)
        self.assertEqual(self.http("PUT",f"/api/bus-passes/{self.bus_pass.id}",{"status":"Active"},self.owner)[0],403)
        self.assertEqual(self.http("POST","/api/bus-passes",{"student_id":self.student.id,"valid_from":str(date.today())},self.owner)[0],403)
        self.assertEqual(self.http("PUT",f"/api/bus-passes/identities/{self.student.id}",{"official_name":"Forged","department":"Forged"},self.owner)[0],403)
        self.assertEqual(self.http("GET","/api/bus-passes/verifications",actor=self.owner)[0],403)
        self.assertEqual(self.http("GET","/api/bus-passes/verifications",actor=self.admin)[0],200)

    def test_issue_endpoint_cannot_impersonate_student_or_trust_browser_storage(self):
        path="/api/students/me/bus-pass/live-token"
        for spoof in [{"studentId":999},{"busId":7},{"status":"ACTIVE"},{"valid":True},
                {"localStorage":{"role":"Driver"}},{"indexedDB":{"approved":True}}]:
            self.assertEqual(self.http("POST",path,spoof,self.owner)[0],422)
        status,data=self.http("POST",path,{},self.owner)
        self.assertEqual(status,200)
        claims=jwt.decode(data["signedToken"],options={"verify_signature":False})
        self.assertEqual(claims["studentId"],self.student.id)
        self.assertEqual(claims["busId"],self.bus.id)
        self.bus_pass.status="Expired";self.db.commit()
        self.assertEqual(self.http("POST",path,{},self.owner)[0],403)

    def test_migration_preserves_legacy_data_and_is_idempotent(self):
        engine=create_engine("sqlite://")
        with engine.begin() as c:
            c.execute(text("CREATE TABLE bus_passes (id INTEGER PRIMARY KEY, status VARCHAR(20), valid_until DATE)"))
            c.execute(text("INSERT INTO bus_passes VALUES (7, 'Active', '2030-01-01')"))
        _add_pass_credential_columns(engine);_add_pass_credential_columns(engine)
        with engine.connect() as c:
            self.assertEqual(tuple(c.execute(text("SELECT * FROM bus_passes")).one()),(7,"Active","2030-01-01",1))
        engine.dispose()

    def test_camera_policy_and_api_cache_policy(self):
        headers=dict(RequestSecurityMiddleware._security_headers("/api/driver/bus-pass/verify"))
        self.assertEqual(headers[b"cache-control"],b"no-store")
        self.assertIn(b"camera=(self)",headers[b"permissions-policy"])

    def test_key_provisioning_refuses_repository_and_overwrite(self):
        from scripts.create_bus_pass_signing_key import create_key
        destination=Path(self.temp.name)/"secret"/"test.pem"
        self.assertEqual(create_key(destination),destination.resolve())
        self.assertIsInstance(serialization.load_pem_private_key(destination.read_bytes(),None),Ed25519PrivateKey)
        with self.assertRaises(FileExistsError): create_key(destination)
        with self.assertRaises(ValueError): create_key(Path(__file__).resolve().parents[1]/"never-create.pem")


if __name__=="__main__": unittest.main()
