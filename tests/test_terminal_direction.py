"""Terminal geofence direction-state regression coverage."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
import unittest

from backend.routes.gps import update_route_stop_progression


class TerminalDirectionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.start = SimpleNamespace(
            id=101,
            stop_code="START",
            stop_name="Start terminal",
            latitude=10.0,
            longitude=76.0,
            radius=200,
        )
        self.end = SimpleNamespace(
            id=102,
            stop_code="END",
            stop_name="End terminal",
            latitude=10.1,
            longitude=76.1,
            radius=200,
        )
        self.forward_stops = [
            SimpleNamespace(id=1, sequence=1, stop=self.start),
            SimpleNamespace(id=2, sequence=2, stop=self.end),
        ]
        self.trip = SimpleNamespace(
            id=99,
            route_direction="forward",
            current_route_stop_id=2,
            current_stop_status="Arrived",
            current_stop_arrived_at=None,
            current_stop_departed_at=None,
            terminal_reached_at=None,
            terminal_stop_id=None,
        )
        self.events: list[object] = []
        self.database = SimpleNamespace(add=self.events.append)
        self.now = datetime(2026, 8, 21, 12, tzinfo=timezone.utc)

    def test_terminal_heartbeat_reverses_once_then_return_terminal_restores_forward(self) -> None:
        # A parked, ignition-off provider heartbeat inside the terminal can
        # reconcile a persisted Arrived state after a restart.
        terminal_event = update_route_stop_progression(
            self.trip,
            self.forward_stops,
            self.end.latitude,
            self.end.longitude,
            previous_location=None,
            current_timestamp=self.now,
            db=self.database,
        )
        self.assertTrue(terminal_event["terminal_reached"])
        self.assertEqual(terminal_event["completed_direction"], "forward")
        self.assertEqual(terminal_event["next_direction"], "reverse")
        self.assertEqual(self.trip.route_direction, "reverse")
        self.assertEqual(self.trip.terminal_stop_id, self.end.id)

        # The next parked heartbeat is still at the same stop, now index 0
        # in reverse order. It must not flip direction a second time.
        duplicate_event = update_route_stop_progression(
            self.trip,
            list(reversed(self.forward_stops)),
            self.end.latitude,
            self.end.longitude,
            previous_location=None,
            current_timestamp=self.now,
            db=self.database,
        )
        self.assertIsNone(duplicate_event)
        self.assertEqual(self.trip.route_direction, "reverse")

        # A later device fix at the opposite terminal completes the return
        # leg and automatically restores the normal morning direction.
        return_event = update_route_stop_progression(
            self.trip,
            list(reversed(self.forward_stops)),
            self.start.latitude,
            self.start.longitude,
            previous_location=None,
            current_timestamp=self.now,
            db=self.database,
        )
        self.assertTrue(return_event["terminal_reached"])
        self.assertEqual(return_event["completed_direction"], "reverse")
        self.assertEqual(return_event["next_direction"], "forward")
        self.assertEqual(self.trip.route_direction, "forward")
        self.assertEqual(self.trip.terminal_stop_id, self.start.id)


if __name__ == "__main__":
    unittest.main()
