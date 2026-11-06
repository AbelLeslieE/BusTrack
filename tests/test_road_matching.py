import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

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

    def test_multiple_impossible_spikes_are_dropped_before_good_points_resume(self):
        fixes = [self.point(10, 0, speed=8), self.point(10.0001, 1, speed=8),
                 self.point(11, 2, speed=8), self.point(15, 3, speed=8),
                 self.point(10.0002, 4, speed=8)]
        self.assertEqual(_clean(fixes), [fixes[0], fixes[1], fixes[4]])

    def test_osrm_map_matching_is_retained_after_filtering(self):
        fixes = [self.point(10, 0, speed=8), self.point(10.0001, 1, speed=8),
                 self.point(10.0002, 2, speed=8)]
        matched = [[76.0, 10.0], [76.0, 10.0001], [76.0, 10.0002]]
        with patch.dict('os.environ', {'ROUTE_STUDIO_ROAD_MATCHING_ENABLED': 'true'}), \
             patch('backend.services.road_matching._request', return_value=matched) as request:
            self.assertEqual(road_geometry(fixes), (matched, True))
        request.assert_called_once()
        self.assertEqual(request.call_args.args[0], 'match')

    def test_implausible_osrm_detour_falls_back_to_filtered_gps(self):
        fixes = [self.point(10, 0, speed=8), self.point(10.0001, 1, speed=8),
                 self.point(10.0002, 2, speed=8)]
        detour = [[76.0, 10.0], [77.0, 11.0], [76.0, 10.0002]]
        expected = [[point['longitude'], point['latitude']] for point in fixes]
        with patch.dict('os.environ', {'ROUTE_STUDIO_ROAD_MATCHING_ENABLED': 'true'}), \
             patch('backend.services.road_matching._request', return_value=detour):
            self.assertEqual(road_geometry(fixes), (expected, False))


if __name__ == "__main__":
    unittest.main()
