"""Regression coverage for finite IST GPS collection workers."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from backend.gps_worker import (
    IST,
    active_peak_window,
    midnight_maintenance_due,
    peak_poll_interval_seconds,
    refresh_providers_once,
    run_peak_worker,
    run_standby_worker,
    standby_refresh_allowed,
)


def ist(day: int, hour: int, minute: int = 0, second: int = 0) -> datetime:
    return datetime(2026, 11, day, hour, minute, second, tzinfo=IST)


class GPSWorkerScheduleTest(unittest.TestCase):
    def test_peak_windows_have_exact_exclusive_boundaries(self) -> None:
        self.assertIsNone(active_peak_window(ist(6, 6, 59, 59)))
        self.assertIsNotNone(active_peak_window(ist(6, 7, 0)))
        self.assertIsNotNone(active_peak_window(ist(6, 9, 14, 59)))
        self.assertIsNone(active_peak_window(ist(6, 9, 15)))
        self.assertIsNotNone(active_peak_window(ist(6, 16, 15)))
        self.assertIsNotNone(active_peak_window(ist(6, 19, 14, 59)))
        self.assertIsNone(active_peak_window(ist(6, 19, 15)))

    def test_standby_polling_skips_both_peak_windows(self) -> None:
        self.assertFalse(standby_refresh_allowed(ist(6, 9, 0)))
        self.assertTrue(standby_refresh_allowed(ist(6, 9, 30)))
        self.assertTrue(standby_refresh_allowed(ist(6, 16, 0)))
        self.assertFalse(standby_refresh_allowed(ist(6, 16, 30)))
        self.assertTrue(standby_refresh_allowed(ist(6, 19, 30)))
        self.assertTrue(standby_refresh_allowed(ist(6, 20, 5)))
        self.assertFalse(standby_refresh_allowed(ist(6, 20, 15)))

    def test_peak_interval_is_always_within_requested_range(self) -> None:
        cases = (("2", 5), ("5", 5), ("8", 8), ("10", 10), ("60", 10), ("bad", 10))
        for configured, expected in cases:
            with self.subTest(configured=configured):
                with patch.dict(os.environ, {"GPS_PEAK_POLL_INTERVAL_SECONDS": configured}):
                    self.assertEqual(peak_poll_interval_seconds(), expected)

    def test_both_worker_modes_use_shared_live_tracking_refresh(self) -> None:
        database_session = object()

        @contextmanager
        def provider_session():
            yield database_session

        provider_result = {
            "updated": [{"active_trip_id": 42}],
            "errors": [],
            "skipped": [],
        }
        with (
            patch("backend.gps_worker.restore_in_progress", return_value=False),
            patch("backend.gps_worker.provider_polling_configured", return_value=True),
            patch("backend.gps_worker._provider_session", side_effect=provider_session),
            patch(
                "backend.gps_worker.refresh_gps_providers",
                return_value=provider_result,
            ) as refresh,
        ):
            self.assertTrue(refresh_providers_once("peak"))
            self.assertTrue(refresh_providers_once("standby"))

        self.assertEqual(refresh.call_count, 2)
        self.assertTrue(all(call.args == (database_session,) for call in refresh.call_args_list))

    @patch("backend.gps_worker.refresh_providers_once")
    @patch("backend.gps_worker.run_direction_recovery")
    def test_peak_worker_stops_at_window_end(self, direction, refresh) -> None:
        current = [ist(6, 9, 14, 50)]

        def clock() -> datetime:
            return current[0]

        def advance(seconds: float) -> None:
            current[0] += timedelta(seconds=seconds)

        with (
            patch.dict(os.environ, {"GPS_PEAK_POLL_INTERVAL_SECONDS": "10"}),
            patch("backend.gps_worker.time.monotonic", return_value=0),
        ):
            self.assertEqual(run_peak_worker(now_fn=clock, sleep_fn=advance), 0)

        direction.assert_called_once_with()
        refresh.assert_called_once_with("peak")
        self.assertEqual(current[0], ist(6, 9, 15))

    @patch("backend.gps_worker.refresh_providers_once")
    @patch("backend.gps_worker.run_document_expiry_reminders")
    @patch("backend.gps_worker.run_retention")
    @patch("backend.gps_worker.run_direction_recovery")
    def test_daytime_standby_runs_one_poll_and_maintenance(
        self, direction, retention, documents, refresh
    ) -> None:
        self.assertEqual(run_standby_worker(now=ist(6, 10, 0)), 0)
        direction.assert_called_once_with()
        retention.assert_called_once_with()
        documents.assert_not_called()
        refresh.assert_called_once_with("standby")

    @patch("backend.gps_worker.refresh_providers_once")
    @patch("backend.gps_worker.run_document_expiry_reminders")
    @patch("backend.gps_worker.run_retention")
    @patch("backend.gps_worker.run_direction_recovery")
    def test_midnight_trigger_preserves_direction_and_document_jobs(
        self, direction, retention, documents, refresh
    ) -> None:
        current = ist(6, 0, 1)
        self.assertTrue(midnight_maintenance_due(current))
        self.assertEqual(run_standby_worker(now=current), 0)
        direction.assert_called_once_with()
        retention.assert_called_once_with()
        documents.assert_called_once_with()
        refresh.assert_not_called()

    @patch("backend.gps_worker.refresh_providers_once")
    @patch("backend.gps_worker.run_document_expiry_reminders")
    @patch("backend.gps_worker.run_retention")
    @patch("backend.gps_worker.run_direction_recovery")
    def test_2030_scheduler_boundary_exits_without_database_work(
        self, direction, retention, documents, refresh
    ) -> None:
        self.assertEqual(run_standby_worker(now=ist(6, 20, 30)), 0)
        direction.assert_not_called()
        retention.assert_not_called()
        documents.assert_not_called()
        refresh.assert_not_called()


class GPSWorkerDeploymentTest(unittest.TestCase):
    def test_cloud_run_uses_two_finite_jobs_and_removes_legacy_service(self) -> None:
        root = Path(__file__).resolve().parents[1]
        deployment = (root / "deploy" / "gcp" / "deploy-cloud-run.ps1").read_text(encoding="utf-8")
        self.assertIn("run jobs deploy $PeakWorkerJobName", deployment)
        self.assertIn("run jobs deploy $StandbyWorkerJobName", deployment)
        self.assertIn("--args=-m,backend.gps_worker,--mode,peak", deployment)
        self.assertIn("--args=-m,backend.gps_worker,--mode,standby", deployment)
        self.assertIn('GPS_PEAK_POLL_INTERVAL_SECONDS=10', deployment)
        self.assertIn('--time-zone "Asia/Kolkata"', deployment)
        self.assertIn('-Schedule "0 7 * * *"', deployment)
        self.assertIn('-Schedule "15 16 * * *"', deployment)
        self.assertIn('-Schedule "0,30 9-20 * * *"', deployment)
        self.assertIn('-Schedule "1 0 * * *"', deployment)
        self.assertIn("run services delete $WorkerServiceName", deployment)
        self.assertNotIn("--min-instances 1", deployment)


if __name__ == "__main__":
    unittest.main()
