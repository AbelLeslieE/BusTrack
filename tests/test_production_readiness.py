"""Production configuration and health-probe regression tests."""

import asyncio
import json
import unittest
from unittest.mock import patch

from backend.database import validate_database_configuration
from backend.main import health_check, readiness_check


class _HealthySession:
    def __enter__(self):
        return self

    def __exit__(self, _exception_type, _exception, _traceback):
        return False

    def execute(self, statement):
        if str(statement) != "SELECT 1":
            raise AssertionError(f"Unexpected readiness query: {statement}")


class ProductionReadinessTest(unittest.TestCase):
    def test_production_requires_postgresql(self):
        with self.assertRaisesRegex(RuntimeError, "Production requires a PostgreSQL"):
            validate_database_configuration(
                environment="production",
                database_url="sqlite:///temporary.db",
                reset_database=False,
            )

    def test_production_forbids_destructive_startup_reset(self):
        with self.assertRaisesRegex(RuntimeError, "RESET_DATABASE=true is forbidden"):
            validate_database_configuration(
                environment="production",
                database_url="postgresql://example.invalid/bustrack",
                reset_database=True,
            )

    def test_valid_production_database_configuration_passes(self):
        validate_database_configuration(
            environment="production",
            database_url="postgresql://example.invalid/bustrack",
            reset_database=False,
        )

    def test_health_is_process_only_and_not_cached(self):
        response = asyncio.run(health_check())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body), {"status": "ok", "service": "bustrack"})
        self.assertEqual(response.headers["cache-control"], "no-store")

    @patch("backend.main.restore_in_progress", return_value=False)
    @patch("backend.main.SessionLocal", return_value=_HealthySession())
    def test_ready_checks_database(self, session_factory, _restore_state):
        response = readiness_check()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body)["status"], "ready")
        session_factory.assert_called_once_with()

    @patch("backend.main.restore_in_progress", return_value=False)
    @patch("backend.main.SessionLocal", side_effect=OSError("database offline"))
    def test_ready_fails_closed_without_leaking_exception(self, _session_factory, _restore_state):
        response = readiness_check()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            json.loads(response.body),
            {"status": "unavailable", "reason": "database_unavailable"},
        )
        self.assertNotIn(b"database offline", response.body)

    @patch("backend.main.restore_in_progress", return_value=True)
    def test_ready_pauses_during_database_restore(self, _restore_state):
        response = readiness_check()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            json.loads(response.body)["reason"],
            "database_restore_in_progress",
        )


if __name__ == "__main__":
    unittest.main()
