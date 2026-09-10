"""Regression coverage for automatic master-stop codes."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import Stop
from backend.routes.stops import create_stop, get_next_stop_code, update_stop


class StopCodeGenerationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.database_path = Path(tempfile.gettempdir()) / f"stop_codes_{uuid4().hex}.db"
        cls.engine = create_engine(
            f"sqlite:///{cls.database_path.as_posix()}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(bind=cls.engine)
        cls.engine.dispose()
        cls.database_path.unlink(missing_ok=True)

    def setUp(self) -> None:
        with self.session_factory() as db:
            db.query(Stop).delete()
            db.commit()

    def _seed(self, code: str, name: str) -> None:
        with self.session_factory() as db:
            db.add(Stop(stop_code=code, stop_name=name, radius=50, status="Active"))
            db.commit()

    def test_preview_and_create_follow_highest_numeric_code(self) -> None:
        self._seed("ST008", "Eight")
        self._seed("ST029", "Twenty Nine")
        self._seed("CAMPUS", "Custom")

        with self.session_factory() as db:
            self.assertEqual(get_next_stop_code(db, object()), {"stop_code": "ST030"})
            result = create_stop(
                {
                    "stop_code": "MANUAL-VALUE-MUST-NOT-WIN",
                    "stop_name": "Thirty",
                    "latitude": 10.1,
                    "longitude": 76.2,
                },
                db,
                object(),
            )

        self.assertEqual(result["stop"]["stop_code"], "ST030")

    def test_edit_keeps_automatic_code_immutable(self) -> None:
        self._seed("ST029", "Original")
        with self.session_factory() as db:
            stop = db.query(Stop).filter(Stop.stop_code == "ST029").one()
            result = update_stop(
                stop.id,
                {
                    "stop_code": "ST999",
                    "stop_name": "Renamed",
                    "latitude": 10.0,
                    "longitude": 76.0,
                    "radius": 50,
                    "status": "Active",
                },
                db,
                object(),
            )

        self.assertEqual(result["stop"]["stop_code"], "ST029")
        self.assertEqual(result["stop"]["stop_name"], "Renamed")

    def test_concurrent_creates_receive_distinct_sequential_codes(self) -> None:
        self._seed("ST029", "Existing")

        def create_named_stop(name: str) -> str:
            with self.session_factory() as db:
                result = create_stop({"stop_name": name}, db, object())
                return result["stop"]["stop_code"]

        with ThreadPoolExecutor(max_workers=2) as executor:
            codes = set(executor.map(create_named_stop, ["Concurrent A", "Concurrent B"]))

        self.assertEqual(codes, {"ST030", "ST031"})
        with self.session_factory() as db:
            self.assertEqual(db.query(Stop).count(), 3)


if __name__ == "__main__":
    unittest.main()
