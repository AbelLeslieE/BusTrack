"""Compatibility migrations must preserve live tracking data."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from sqlalchemy import create_engine, inspect

from backend.database import (
    _add_bus_gps_provider_column,
    _add_provider_effective_time_columns,
    _make_live_trip_driver_optional,
)


class DatabaseCompatibilityTest(unittest.TestCase):
    def test_provider_clock_columns_upgrade_existing_tables(self) -> None:
        database_path = Path(tempfile.gettempdir()) / f"provider_clock_upgrade_{uuid4().hex}.db"
        database_engine = create_engine(f"sqlite:///{database_path.as_posix()}")
        try:
            with database_engine.begin() as connection:
                connection.exec_driver_sql(
                    "CREATE TABLE provider_gps_positions (id INTEGER PRIMARY KEY)"
                )
                connection.exec_driver_sql(
                    "CREATE TABLE bus_gps_states (id INTEGER PRIMARY KEY)"
                )

            _add_provider_effective_time_columns(database_engine)
            _add_provider_effective_time_columns(database_engine)

            database_inspector = inspect(database_engine)
            for table_name in ("provider_gps_positions", "bus_gps_states"):
                columns = {
                    column["name"]: column
                    for column in database_inspector.get_columns(table_name)
                }
                self.assertIn("effective_time", columns)
                self.assertIn("timestamp_basis", columns)
                self.assertFalse(columns["timestamp_basis"]["nullable"])
        finally:
            database_engine.dispose()
            database_path.unlink(missing_ok=True)

    def test_existing_bus_table_receives_persistent_provider_assignment(self) -> None:
        database_path = Path(tempfile.gettempdir()) / f"bus_provider_migration_{uuid4().hex}.db"
        database_engine = create_engine(f"sqlite:///{database_path.as_posix()}")
        try:
            with database_engine.begin() as connection:
                connection.exec_driver_sql(
                    "CREATE TABLE buses (id INTEGER NOT NULL PRIMARY KEY, bus_number VARCHAR(20))"
                )
                connection.exec_driver_sql(
                    "INSERT INTO buses (id, bus_number) VALUES (1, 'BUS-001')"
                )

            _add_bus_gps_provider_column(database_engine)
            _add_bus_gps_provider_column(database_engine)

            columns = {item["name"]: item for item in inspect(database_engine).get_columns("buses")}
            self.assertIn("gps_provider", columns)
            with database_engine.connect() as connection:
                self.assertEqual(
                    connection.exec_driver_sql("SELECT gps_provider FROM buses WHERE id = 1").scalar_one(),
                    "auto",
                )
        finally:
            database_engine.dispose()
            database_path.unlink(missing_ok=True)

    def test_existing_sqlite_live_trip_driver_becomes_optional(self) -> None:
        database_path = Path(tempfile.gettempdir()) / f"bus_tracker_migration_{uuid4().hex}.db"
        database_engine = create_engine(f"sqlite:///{database_path.as_posix()}")
        try:
            with database_engine.begin() as connection:
                connection.exec_driver_sql(
                    "CREATE TABLE live_trips ("
                    "id INTEGER NOT NULL PRIMARY KEY, "
                    "driver_id INTEGER NOT NULL, "
                    "bus_id INTEGER NOT NULL, "
                    "route_id INTEGER NOT NULL, "
                    "status VARCHAR(20) NOT NULL)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO live_trips (id, driver_id, bus_id, route_id, status) "
                    "VALUES (1, 5, 7, 9, 'Running')"
                )

            _make_live_trip_driver_optional(database_engine)

            driver_column = next(
                column
                for column in inspect(database_engine).get_columns("live_trips")
                if column["name"] == "driver_id"
            )
            self.assertTrue(driver_column["nullable"])
            with database_engine.connect() as connection:
                self.assertEqual(
                    connection.exec_driver_sql(
                        "SELECT id, driver_id, bus_id, route_id, status FROM live_trips"
                    ).one(),
                    (1, 5, 7, 9, "Running"),
                )
        finally:
            database_engine.dispose()
            database_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
