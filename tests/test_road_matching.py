import unittest
from datetime import datetime, timedelta, timezone

from backend.services.road_matching import _clean, road_geometry


class RoadMatchingMovementTest(unittest.TestCase):
    def point(self, latitude, second, accuracy=5, speed=0):
        return {
            "latitude": latitude, "longitude": 76.0, "accuracy": accuracy,
            "speed": speed,
            "recorded_at": (datetime(2026, 11, 6, tzinfo=timezone.utc)
                            + timedelta(seconds=second)).isoformat(),
        }

    def test_stationary_drift_does_not_create_a_route(self):
        fixes = [self.point(10, 0), self.point(10.00012, 5),
                 self.point(9.99991, 10), self.point(10.00019, 15),
                 self.point(10.00003, 20)]
        self.assertEqual(_clean(fixes), [fixes[0]])
        self.assertEqual(road_geometry(fixes)[0], [[76.0, 10.0]])

    def test_zero_speed_needs_consistent_movement(self):
        fixes = [self.point(10, 0), self.point(10.0002, 5),
                 self.point(10.0004, 10)]
        self.assertEqual(_clean(fixes), fixes)

    def test_precise_moving_fix_is_accepted_and_jump_is_ignored(self):
        fixes = [self.point(10, 0), self.point(10.01, 3, speed=10),
                 self.point(10.0005, 10, speed=7)]
        self.assertEqual(_clean(fixes), [fixes[0], fixes[2]])

    def test_weak_fix_cannot_move_road_line(self):
        fixes = [self.point(10, 0), self.point(10.0004, 10, accuracy=60, speed=7),
                 self.point(10.0006, 15, speed=7)]
        self.assertEqual(_clean(fixes), [fixes[0], fixes[2]])


if __name__ == "__main__":
    unittest.main()
