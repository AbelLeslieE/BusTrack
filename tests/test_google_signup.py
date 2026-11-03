"""Google Workspace student signup regression tests."""

import os
import unittest
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from fastapi import Request, Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.auth import authenticate_user, get_password_hash
from backend.database import Base
from backend.models import Student, User, UserSession
import backend.routes.models_tracking  # noqa: F401  # Register live-trip tables.
from backend.routes.auth import (
    GOOGLE_OAUTH_COOKIE,
    GOOGLE_SIGNUP_COOKIE,
    complete_google_signup,
    google_signup_callback,
    google_signup_start,
    read_google_signup,
)
from backend.schemas import GoogleSignupComplete
from backend.utils.jwt_handler import create_temporary_token


GOOGLE_ENVIRONMENT = {
    "APP_ENV": "development",
    "JWT_SECRET_KEY": "test-google-signup-secret-that-is-longer-than-thirty-two-characters",
    "GOOGLE_OAUTH_CLIENT_ID": "test-client.apps.googleusercontent.com",
    "GOOGLE_OAUTH_CLIENT_SECRET": "test-client-secret",
    "GOOGLE_OAUTH_ALLOWED_DOMAIN": "sahrdaya.ac.in",
    "GOOGLE_OAUTH_REDIRECT_URI": "http://testserver/api/auth/google/callback",
}


class GoogleSignupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.environment = patch.dict(os.environ, GOOGLE_ENVIRONMENT)
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    @staticmethod
    def _request(path: str, cookies: dict[str, str] | None = None) -> Request:
        headers = [(b"host", b"testserver"), (b"user-agent", b"signup-test")]
        if cookies:
            cookie_header = "; ".join(f"{name}={value}" for name, value in cookies.items())
            headers.append((b"cookie", cookie_header.encode("ascii")))
        return Request({
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
        })

    @staticmethod
    def _response_cookie(response: Response, name: str) -> str | None:
        cookies = SimpleCookie()
        for header, value in response.raw_headers:
            if header.lower() == b"set-cookie":
                cookies.load(value.decode("latin-1"))
        morsel = cookies.get(name)
        return morsel.value if morsel else None

    def _begin_google_flow(self) -> tuple[str, str]:
        response = google_signup_start(self._request("/api/auth/google/signup"))
        self.assertEqual(response.status_code, 302)
        authorization_url = urlparse(response.headers["location"])
        self.assertEqual(authorization_url.netloc, "accounts.google.com")
        parameters = parse_qs(authorization_url.query)
        self.assertEqual(parameters["hd"], ["sahrdaya.ac.in"])
        self.assertEqual(parameters["code_challenge_method"], ["S256"])
        flow_cookie = self._response_cookie(response, GOOGLE_OAUTH_COOKIE)
        self.assertIsNotNone(flow_cookie)
        return parameters["state"][0], flow_cookie

    @patch("backend.routes.auth._fetch_google_identity")
    def test_verified_sahrdaya_account_creates_student_with_normal_login(self, fetch_identity) -> None:
        fetch_identity.return_value = {
            "sub": "google-user-123",
            "email": "Abel@Sahrdaya.ac.in",
            "email_verified": True,
            "hd": "sahrdaya.ac.in",
            "name": "Abel Student",
        }
        state, flow_cookie = self._begin_google_flow()
        with self.session_factory() as database_session:
            callback = google_signup_callback(
                self._request("/api/auth/google/callback", {GOOGLE_OAUTH_COOKIE: flow_cookie}),
                database_session,
                code="one-time-code",
                state=state,
            )
        self.assertEqual(callback.status_code, 303)
        self.assertEqual(callback.headers["location"], "/google-signup")

        signup_cookie = self._response_cookie(callback, GOOGLE_SIGNUP_COOKIE)
        signup_request = self._request("/api/auth/google/pending", {GOOGLE_SIGNUP_COOKIE: signup_cookie})
        pending = read_google_signup(signup_request)
        self.assertEqual(pending["email"], "abel@sahrdaya.ac.in")
        with self.session_factory() as database_session:
            completed = complete_google_signup(
                GoogleSignupComplete(username="abel.student", password="StrongPassword12!"),
                signup_request,
                Response(),
                database_session,
            )
        self.assertEqual(completed["username"], "abel.student")

        with self.session_factory() as database_session:
            user = database_session.query(User).filter_by(username="abel.student").one()
            self.assertEqual(user.email, "abel@sahrdaya.ac.in")
            self.assertEqual(user.role, "User")
            self.assertFalse(user.must_change_password)
            self.assertIsNotNone(user.student)
            self.assertEqual(authenticate_user(database_session, "abel.student", "StrongPassword12!").id, user.id)

    @patch("backend.routes.auth._fetch_google_identity")
    def test_google_account_from_another_domain_is_rejected(self, fetch_identity) -> None:
        fetch_identity.return_value = {
            "sub": "outside-user",
            "email": "abel@gmail.com",
            "email_verified": True,
            "name": "Outside User",
        }
        state, flow_cookie = self._begin_google_flow()
        with self.session_factory() as database_session:
            callback = google_signup_callback(
                self._request("/api/auth/google/callback", {GOOGLE_OAUTH_COOKIE: flow_cookie}),
                database_session,
                code="one-time-code",
                state=state,
            )
        self.assertEqual(callback.status_code, 303)
        self.assertEqual(callback.headers["location"], "/?google_error=wrong_domain")
        self.assertIn(self._response_cookie(callback, GOOGLE_SIGNUP_COOKIE), {None, ""})

    @patch("backend.routes.auth._fetch_google_identity")
    def test_existing_google_account_returns_to_login_with_clear_message(self, fetch_identity) -> None:
        fetch_identity.return_value = {
            "sub": "existing-google-user",
            "email": "existing@sahrdaya.ac.in",
            "email_verified": True,
            "hd": "sahrdaya.ac.in",
            "name": "Existing Student",
        }
        with self.session_factory() as database_session:
            database_session.add(User(
                username="existing.student",
                email="existing@sahrdaya.ac.in",
                full_name="Existing Student",
                password_hash=get_password_hash("ExistingPassword12!"),
                role="User",
                status="Active",
                must_change_password=False,
            ))
            database_session.commit()

        state, flow_cookie = self._begin_google_flow()
        with self.session_factory() as database_session:
            callback = google_signup_callback(
                self._request("/api/auth/google/callback", {GOOGLE_OAUTH_COOKIE: flow_cookie}),
                database_session,
                code="one-time-code",
                state=state,
            )

        self.assertEqual(callback.status_code, 303)
        self.assertEqual(callback.headers["location"], "/?google_error=account_exists")
        self.assertIn(self._response_cookie(callback, GOOGLE_SIGNUP_COOKIE), {None, ""})

    def test_verified_email_can_claim_only_an_imported_student_account(self) -> None:
        with self.session_factory() as database_session:
            imported = User(
                username="student@sahrdaya.ac.in",
                email="student@sahrdaya.ac.in",
                full_name="Imported Student",
                password_hash=get_password_hash("TemporaryPassword12!"),
                role="User",
                status="Active",
                must_change_password=True,
            )
            database_session.add(imported)
            database_session.flush()
            database_session.add(Student(user_id=imported.id, student_code="STU001"))
            database_session.add(UserSession(
                session_id="imported-student-session",
                user_id=imported.id,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ))
            database_session.commit()
            imported_id = imported.id

        signup_token = create_temporary_token(
            "google-signup",
            {
                "email": "student@sahrdaya.ac.in",
                "full_name": "Google Name",
                "google_sub": "workspace-subject",
            },
            expires_in_minutes=15,
        )
        signup_request = self._request("/api/auth/google/complete", {GOOGLE_SIGNUP_COOKIE: signup_token})
        with self.session_factory() as database_session:
            completed = complete_google_signup(
                GoogleSignupComplete(username="student.one", password="ClaimedPassword12!"),
                signup_request,
                Response(),
                database_session,
            )
        self.assertEqual(completed["username"], "student.one")

        with self.session_factory() as database_session:
            claimed = database_session.get(User, imported_id)
            self.assertEqual(claimed.username, "student.one")
            self.assertFalse(claimed.must_change_password)
            self.assertEqual(claimed.auth_version, 2)
            self.assertEqual(database_session.query(Student).count(), 1)
            claimed_session = database_session.query(UserSession).filter_by(
                session_id="imported-student-session"
            ).one()
            self.assertIsNotNone(claimed_session.revoked_at)
            self.assertIsNotNone(authenticate_user(database_session, "student.one", "ClaimedPassword12!"))


if __name__ == "__main__":
    unittest.main()
