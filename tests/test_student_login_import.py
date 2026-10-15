"""Student CSV onboarding and first-sign-in boundaries."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from fastapi import HTTPException, Request, Response, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.auth import authenticate_user, get_current_user, get_password_hash, verify_password
from backend.database import Base
from backend.models import Student, User, UserSession
from backend.routes.settings import change_account_password
from backend.routes.student import _student_stream_key, import_student_logins, reset_student_login
from backend.schemas import PasswordChangeRequest
from backend.utils.jwt_handler import create_access_token
from datetime import datetime, timedelta, timezone


def _request(path: str, method: str = "GET", cookie: str | None = None) -> Request:
    headers = [(b"cookie", f"bus_tracker_session={cookie}".encode())] if cookie else []
    return Request({"type": "http", "method": method, "path": path, "headers": headers,
                    "client": ("127.0.0.1", 12345), "scheme": "http", "server": ("testserver", 80)})


class StudentLoginImportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.database_path = Path(tempfile.gettempdir()) / f"student_import_{uuid4().hex}.db"
        self.engine = create_engine(f"sqlite:///{self.database_path.as_posix()}", connect_args={"check_same_thread": False})
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.session_factory()
        self.admin = User(username="admin", full_name="Admin", password_hash=get_password_hash("AdminPassword12!"), role="Admin", status="Active")
        self.db.add(self.admin)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.database_path.unlink(missing_ok=True)

    def _import(self, contents: str):
        file = UploadFile(file=BytesIO(contents.encode()), filename="students.csv")
        return import_student_logins(_request("/api/students/import-logins", "POST"), Response(), file, self.db, self.admin)

    def test_creates_unique_email_logins_and_skips_existing_without_reset(self) -> None:
        existing = User(username="old.student", email="existing@example.edu", full_name="Existing Student",
                        password_hash=get_password_hash("ExistingPassword12!"), role="User", status="Active")
        self.db.add(existing)
        self.db.flush()
        self.db.add(Student(user_id=existing.id, student_code="STU006"))
        self.db.commit()

        csv_text = "full_name,email\nAlice Example,ALICE@example.edu\nExisting Student,existing@example.edu\nBob Example,bob@example.edu\n"
        result = self._import(csv_text)
        self.assertEqual((result["created_count"], result["existing_count"]), (2, 1))
        self.assertEqual([entry["student_code"] for entry in result["credentials"]], ["STU007", "STU008"])
        alice = self.db.query(User).filter(User.email == "alice@example.edu").one()
        self.assertEqual(alice.username, alice.email)
        self.assertTrue(alice.must_change_password)
        self.assertTrue(verify_password(result["credentials"][0]["temporary_password"], alice.password_hash))
        self.assertIsNotNone(authenticate_user(self.db, "ALICE@example.edu", result["credentials"][0]["temporary_password"]))
        self.assertTrue(verify_password("ExistingPassword12!", existing.password_hash))
        self.assertEqual(authenticate_user(self.db, "existing@example.edu", "ExistingPassword12!").id, existing.id)
        repeated = self._import(csv_text)
        self.assertEqual((repeated["created_count"], repeated["existing_count"]), (0, 3))

    def test_bad_rows_and_non_student_collisions_make_no_accounts(self) -> None:
        with self.assertRaises(HTTPException) as invalid:
            self._import("full_name,email\nAlice,alice@example.edu\nBob,alice@example.edu\n")
        self.assertEqual(invalid.exception.status_code, 422)
        self.assertEqual(self.db.query(Student).count(), 0)

        staff = User(username="staff", email="staff@example.edu", full_name="Staff",
                     password_hash=get_password_hash("StaffPassword12!"), role="Admin", status="Active")
        self.db.add(staff)
        self.db.commit()
        self.assertIsNone(authenticate_user(self.db, "staff@example.edu", "StaffPassword12!"))
        with self.assertRaises(HTTPException) as conflict:
            self._import("full_name,email\nAlice,alice@example.edu\nStaff,staff@example.edu\n")
        self.assertEqual(conflict.exception.status_code, 409)
        self.assertEqual(self.db.query(Student).count(), 0)

    def test_temporary_login_is_limited_until_password_change(self) -> None:
        result = self._import("full_name,email\nAlice,alice@example.edu\n")
        password = result["credentials"][0]["temporary_password"]
        user = self.db.query(User).filter(User.email == "alice@example.edu").one()
        expiry = datetime.now(timezone.utc) + timedelta(hours=1)
        session = UserSession(session_id="test-student-session", user_id=user.id, expires_at=expiry)
        self.db.add(session)
        self.db.commit()
        token = create_access_token(user.username, expires_at=expiry, auth_version=user.auth_version, session_id=session.session_id)

        self.assertEqual(get_current_user(_request("/api/auth/me"), token, self.db).id, user.id)
        with self.assertRaises(HTTPException) as blocked:
            get_current_user(_request("/api/students/me"), token, self.db)
        self.assertEqual(blocked.exception.status_code, 403)
        self.assertEqual(get_current_user(_request("/api/settings/account/password", "PUT"), token, self.db).id, user.id)

        change_account_password(
            PasswordChangeRequest(current_password=password, new_password="MyNewPassword12!"),
            Response(), _request("/api/settings/account/password", "PUT", token), self.db, user,
        )
        self.assertFalse(user.must_change_password)
        self.assertTrue(verify_password("MyNewPassword12!", user.password_hash))
        new_token = create_access_token(user.username, expires_at=expiry, auth_version=user.auth_version, session_id=session.session_id)
        self.assertEqual(get_current_user(_request("/api/students/me"), new_token, self.db).id, user.id)

    def test_unassigned_student_uses_private_stream_key(self) -> None:
        self.assertEqual(_student_stream_key({"route": None, "bus": None}, 42), ("student", 42, 0))

    def test_explicit_reset_replaces_password_and_revokes_sessions(self) -> None:
        original = self._import("full_name,email\nAlice,alice@example.edu\n")["credentials"][0]
        student = self.db.query(Student).filter(Student.student_code == original["student_code"]).one()
        user = student.user
        user.must_change_password = False
        session = UserSession(session_id="old-session", user_id=user.id,
                              expires_at=datetime.now(timezone.utc) + timedelta(hours=1))
        self.db.add(session)
        self.db.commit()

        response = Response()
        replacement = reset_student_login(student.id, _request(f"/api/students/{student.id}/reset-login", "POST"),
                                          response, self.db, self.admin)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(replacement["login"], "alice@example.edu")
        self.assertTrue(verify_password(replacement["temporary_password"], user.password_hash))
        self.assertFalse(verify_password(original["temporary_password"], user.password_hash))
        self.assertTrue(user.must_change_password)
        self.assertEqual(user.auth_version, 2)
        self.assertIsNotNone(session.revoked_at)


if __name__ == "__main__":
    unittest.main()
