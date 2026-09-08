"""Existing progression must be identical with absent or expired documents."""
from datetime import timedelta
from types import SimpleNamespace
import unittest

import test_trip_reset as tracking_fixture
from backend.models_documents import BusDocument
from backend.routes.gps_provider import ingest_positions, get_driver_tracking_source
from backend.routes.student import get_student_live_tracking


class DocumentTrackingTest(unittest.TestCase):
    def test_provider_ignition_heartbeats_student_stops_and_terminal_reversal(self):
        for with_expired_document in (False, True):
            with self.subTest(expired_document=with_expired_document):
                fixture = tracking_fixture.TripResetTest()
                fixture.setUp()
                try:
                    if with_expired_document:
                        fixture.db.add(BusDocument(bus_id=fixture.bus.id, document_type="insurance",
                                                   valid_until=fixture.now.date()-timedelta(days=10)))
                        fixture.db.commit()
                    fixture.reset()
                    # The fixture's clock is 30 seconds behind real time. Keep
                    # observations in the past: future fixes cannot progress
                    # a reset journey under the existing tracking rules.
                    for stop, seconds, ignition, direction in [(0,1,True,"forward"),(2,2,False,"reverse"),(1,3,False,"reverse"),(0,4,True,"forward")]:
                        ingest_positions(SimpleNamespace(state=SimpleNamespace()), {
                            "uniqueId":"RESET-DEVICE", "latitude":10+stop*.01,"longitude":76,
                            "speed":0,"fixTime":(fixture.now+timedelta(seconds=seconds)).isoformat(),
                            "attributes":{"ignition":ignition},
                        },"test-token",fixture.db)
                        tracking=get_student_live_tracking(fixture.user,fixture.db)
                        self.assertEqual(tracking['trip']['route_direction'],direction)
                        self.assertAlmostEqual(tracking['trip']['latitude'],10+stop*.01)
                        self.assertEqual(len(tracking['stops']),3)
                        self.assertEqual(get_driver_tracking_source(fixture.driver_user,fixture.db)['active_trip_id'],fixture.trip.id)
                    self.assertEqual(fixture.bus.device_id,'RESET-DEVICE')
                    self.assertEqual(fixture.route.bus_id,fixture.bus.id)
                finally:
                    fixture.tearDown()

    def test_expired_document_does_not_block_mobile_progression(self):
        fixture=tracking_fixture.TripResetTest()
        fixture.setUp()
        try:
            fixture.db.add(BusDocument(bus_id=fixture.bus.id,document_type='fitness',valid_until=fixture.now.date()-timedelta(days=1)))
            fixture.db.commit()
            fixture.test_phone_rejects_old_callbacks_and_unlocks_only_at_first_stop()
        finally:
            fixture.tearDown()
