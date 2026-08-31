"""Provider timestamps must be strict when selecting the visible GPS state."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Bus
from backend.routes.gps_provider import ingest_positions
from backend.routes.models_tracking import BusGPSState, GPSIngestToken, ProviderGPSPosition


class ProviderGpsFreshnessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database = Path(tempfile.gettempdir()) / f"bus_tracker_provider_freshness_{uuid4().hex}.db"
        cls.engine = create_engine(f"sqlite:///{cls.test_database.as_posix()}")
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.test_database.unlink(missing_ok=True)

    @staticmethod
    def _request() -> SimpleNamespace:
        return SimpleNamespace(state=SimpleNamespace())

    @staticmethod
    def _payload(latitude: float, fix_time: datetime) -> dict:
        return {
            "uniqueId": "FRESHNESS-DEVICE",
            "latitude": latitude,
            "longitude": 76.0,
            "speed": 0,
            "fixTime": fix_time.isoformat().replace("+00:00", "Z"),
            "valid": True,
            "attributes": {"ignition": False, "motion": False},
        }

    def test_equal_or_older_provider_fix_cannot_replace_visible_state(self) -> None:
        with self.session_factory() as database_session:
            bus = Bus(bus_number="FRESH-01", registration_number="FRESH-REG-01", capacity=40, manufacturer="Test", model="Coach", year=2026, fuel_type="Diesel", status="Active", device_id="FRESHNESS-DEVICE")
            token = GPSIngestToken(label="freshness", token_hash=hashlib.sha256(b"freshness-token").hexdigest(), is_active=True)
            database_session.add_all([bus, token])
            database_session.commit()

            recorded_at = datetime(2026, 8, 24, 8, 30, tzinfo=timezone.utc)
            first = ingest_positions(self._request(), self._payload(10.0, recorded_at), "freshness-token", database_session)
            equal = ingest_positions(self._request(), self._payload(11.0, recorded_at), "freshness-token", database_session)
            older = ingest_positions(
                self._request(),
                self._payload(12.0, recorded_at.replace(minute=29)),
                "freshness-token",
                database_session,
            )

            state = database_session.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).one()
            self.assertEqual(first["accepted"][0]["applied_to_current_state"], True)
            self.assertEqual(equal["accepted"][0]["applied_to_current_state"], False)
            self.assertEqual(older["accepted"][0]["applied_to_current_state"], False)
            self.assertEqual(state.latitude, 10.0)
            self.assertEqual(database_session.query(ProviderGPSPosition).filter(ProviderGPSPosition.bus_id == bus.id).count(), 3)


if __name__ == "__main__":
    unittest.main()
