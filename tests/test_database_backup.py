"""Regression coverage for portable compressed database backup and restore."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from io import BytesIO
import json
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from fastapi import Request, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models  # noqa: F401
import backend.routes.models_tracking  # noqa: F401
from backend.database import Base
from backend.models import AuditEvent, Bus, User
from backend.routes.settings import download_database_backup, restore_database_backup
from backend.services.database_backup import (
    BACKUP_FORMAT_VERSION,
    DATA_MEMBER,
    MANIFEST_MEMBER,
    create_database_backup_archive,
    restore_database_backup_archive,
)


def _request(method: str, path: str) -> Request:
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "headers": [],
        "client": ("127.0.0.1", 12345),
    })


class _DatabaseTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{self.temporary_directory.name}/bus_tracker.sqlite3")
        self.Session = sessionmaker(bind=self.engine, autoflush=False)
        Base.metadata.create_all(bind=self.engine)

    def tearDown(self) -> None:
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()
        self.temporary_directory.cleanup()

    def add_baseline_data(self) -> None:
        with self.Session() as db:
            db.add_all([
                User(
                    username="backup-admin",
                    password_hash="unused",
                    full_name="Backup Administrator",
                    role="Admin",
                    status="Active",
                ),
                Bus(
                    bus_number="BUS-001",
                    registration_number="KL-01-AA-0001",
                    capacity=40,
                    manufacturer="Test",
                    model="Coach",
                    year=2026,
                    fuel_type="Diesel",
                    status="Active",
                ),
            ])
            db.commit()


class DatabaseBackupTest(_DatabaseTestCase):
    def test_archive_is_portable_and_restore_replaces_mutated_data(self) -> None:
        self.add_baseline_data()
        archive = create_database_backup_archive(
            self.engine,
            created_at=datetime(2026, 9, 1, 12, tzinfo=timezone.utc),
        )

        with zipfile.ZipFile(BytesIO(archive)) as zip_file:
            self.assertEqual(set(zip_file.namelist()), {MANIFEST_MEMBER, DATA_MEMBER})
            manifest = json.loads(zip_file.read(MANIFEST_MEMBER))
            self.assertEqual(manifest["source_database_dialect"], "sqlite")
            self.assertEqual(manifest["format_version"], BACKUP_FORMAT_VERSION)
            payload = json.loads(zip_file.read(DATA_MEMBER))
            self.assertEqual(payload["buses"][0]["bus_number"], "BUS-001")

        with self.Session() as db:
            db.query(Bus).delete()
            db.add(Bus(
                bus_number="BUS-CHANGED",
                registration_number="KL-01-AA-9999",
                capacity=50,
                manufacturer="Changed",
                model="Changed",
                year=2026,
                fuel_type="Electric",
                status="Maintenance",
            ))
            db.commit()

        restore_database_backup_archive(self.engine, archive)

        with self.Session() as db:
            self.assertEqual([bus.bus_number for bus in db.query(Bus).all()], ["BUS-001"])
            self.assertEqual(db.query(User).filter_by(username="backup-admin").count(), 1)

    def test_invalid_archive_does_not_change_existing_data(self) -> None:
        self.add_baseline_data()
        corrupted = BytesIO()
        with zipfile.ZipFile(corrupted, "w") as archive:
            archive.writestr(MANIFEST_MEMBER, "{}")
            archive.writestr(DATA_MEMBER, "{}")

        with self.assertRaises(ValueError):
            restore_database_backup_archive(self.engine, corrupted.getvalue())

        with self.Session() as db:
            self.assertEqual([bus.bus_number for bus in db.query(Bus).all()], ["BUS-001"])


class DatabaseBackupEndpointTest(_DatabaseTestCase):
    def test_admin_download_creates_a_zip_and_audit_event(self) -> None:
        self.add_baseline_data()
        with self.Session() as db:
            administrator = db.query(User).filter_by(username="backup-admin").one()
            with patch("backend.routes.settings.engine", self.engine):
                response = download_database_backup(
                    _request("GET", "/api/settings/backup/download"), db, administrator,
                )
                archive = asyncio.run(self._read_response(response))

            self.assertEqual(db.query(AuditEvent).count(), 1)
            with zipfile.ZipFile(BytesIO(archive)) as zip_file:
                payload = json.loads(zip_file.read(DATA_MEMBER))
            self.assertEqual(payload["buses"][0]["bus_number"], "BUS-001")

    def test_admin_restore_replaces_data_and_writes_audit_event(self) -> None:
        self.add_baseline_data()
        archive = create_database_backup_archive(self.engine)
        with self.Session() as db:
            administrator = db.query(User).filter_by(username="backup-admin").one()
            db.add(Bus(
                bus_number="BUS-CHANGED",
                registration_number="KL-01-AA-9999",
                capacity=50,
                manufacturer="Changed",
                model="Changed",
                year=2026,
                fuel_type="Electric",
                status="Maintenance",
            ))
            db.commit()
            upload = UploadFile(filename="BusTrack-backup.zip", file=BytesIO(archive))
            with patch("backend.routes.settings.engine", self.engine):
                result = asyncio.run(restore_database_backup(
                    _request("POST", "/api/settings/backup/restore"),
                    upload,
                    "RESTORE",
                    db,
                    administrator,
                ))
            self.assertTrue(result["success"])

        with self.Session() as db:
            self.assertEqual([bus.bus_number for bus in db.query(Bus).all()], ["BUS-001"])
            self.assertEqual(db.query(AuditEvent).filter_by(action="database_backup_restored").count(), 1)

    @staticmethod
    async def _read_response(response) -> bytes:
        return b"".join([chunk async for chunk in response.body_iterator])


if __name__ == "__main__":
    unittest.main()
