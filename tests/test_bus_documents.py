"""Optional documents, protected files, reminder cycles and concurrent writes."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from io import BytesIO
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from urllib.parse import urlencode, urlsplit
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from PIL import Image
from sqlalchemy import create_engine, event, inspect, select
from sqlalchemy.orm import sessionmaker

from backend.database import Base, get_db
from backend.models import Bus, User, FleetNotification
from backend.models_documents import BusDocument, BusDocumentReminder
import backend.routes.models_tracking  # noqa: F401
from backend.routes.bus_documents import router
from backend.routes.buses import router as bus_router
from backend.routes.notifications import router as notification_router
from backend.routes.trip_history import router as history_router
from backend.security import require_authenticated, RequestSecurityMiddleware
from backend.services.bus_documents import document_status, run_document_reminders
from backend.services.database_backup import create_database_backup_archive, restore_database_backup_archive


class ASGIClient:
    """Small ASGI harness matching existing tests, with no extra dependencies."""
    def __init__(self, app):
        self.app = app

    def close(self):
        pass

    def get(self, path, **kwargs): return self.request("GET", path, **kwargs)
    def post(self, path, **kwargs): return self.request("POST", path, **kwargs)
    def put(self, path, **kwargs): return self.request("PUT", path, **kwargs)

    def request(self, method, path, data=None, files=None, **kwargs):
        body=b""
        media="application/json"
        if "json" in kwargs:
            body=json.dumps(kwargs["json"]).encode()
        elif files:
            boundary="BusDocumentTestBoundary"
            chunks=[]
            for key,value in (data or {}).items():
                chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
            for key,(filename,content,mime) in files.items():
                chunks.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode(),content,b'\r\n'])
            chunks.append(f'--{boundary}--\r\n'.encode())
            body=b''.join(chunks)
            media=f'multipart/form-data; boundary={boundary}'
        elif data:
            body=urlencode(data).encode(); media='application/x-www-form-urlencoded'
        async def call():
            messages=[]
            async def receive(): return {"type":"http.request","body":body,"more_body":False}
            async def send(message): messages.append(message)
            parsed=urlsplit(path)
            await self.app({"type":"http","asgi":{"version":"3.0"},"http_version":"1.1",
                "method":method,"scheme":"http","path":parsed.path,"raw_path":parsed.path.encode(),
                "query_string":parsed.query.encode(),"headers":[(b"content-type",media.encode()),(b"content-length",str(len(body)).encode())],
                "client":("127.0.0.1",1),"server":("test",80),"root_path":""},receive,send)
            start=next(m for m in messages if m['type']=='http.response.start')
            content=b''.join(m.get('body',b'') for m in messages if m['type']=='http.response.body')
            return SimpleNamespace(status_code=start['status'],content=content,text=content.decode(errors='replace'),
                headers={k.decode():v.decode() for k,v in start['headers']},json=lambda:json.loads(content))
        return asyncio.run(call())


class BusDocumentsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{Path(self.temp.name).as_posix()}/test.db", connect_args={"check_same_thread":False, "timeout":15})
        @event.listens_for(self.engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, autoflush=False)
        with self.sessions() as db:
            admin = User(username="admin", full_name="Admin", password_hash="unused", role="Admin", status="Active")
            self.bus_data = dict(bus_number="DOC-01", registration_number="DOC-REG", capacity=40, manufacturer="Test", model="Test", year=2026, fuel_type="Diesel", status="Active", device_id="GPS-UNCHANGED")
            bus = Bus(**self.bus_data)
            db.add_all([admin, bus]); db.commit()
            self.bus_id, self.admin_id = bus.id, admin.id
        self.app = FastAPI()
        self.app.include_router(router); self.app.include_router(bus_router); self.app.include_router(notification_router)
        self.app.include_router(history_router)
        self.app.add_middleware(RequestSecurityMiddleware)
        def get_test_db():
            with self.sessions() as db:
                yield db
        self.app.dependency_overrides[get_db] = get_test_db
        self.actor = SimpleNamespace(id=self.admin_id, role="Admin")
        self.app.dependency_overrides[require_authenticated] = lambda:self.actor
        self.client = ASGIClient(self.app)
        self.url = f"/api/buses/{self.bus_id}/documents"
        self.today = date(2026,9,8)

    def tearDown(self):
        self.client.close(); self.engine.dispose(); self.temp.cleanup()

    def save(self, kind="insurance", version=0, file=None, **values):
        return self.client.put(f"{self.url}/{kind}", data={"metadata":json.dumps({"expected_version":version, **values})}, files={"file":file} if file else None)

    def check(self, today=None):
        with self.sessions() as db:
            result=run_document_reminders(db,today or self.today)
            db.commit()
            return result

    def test_existing_bus_defaults_and_create_edit_without_documents(self):
        response=self.client.get(self.url)
        self.assertEqual(response.status_code,200)
        self.assertEqual(len(response.json()["documents"]),8)
        self.assertTrue(all(d["status"]=="NOT_ADDED" for d in response.json()["documents"]))
        data={**self.bus_data,"bus_number":"DOC-02","registration_number":"DOC-REG-2","device_id":"GPS-2"}
        created=self.client.post('/api/buses/',json=data)
        self.assertEqual(created.status_code,201,created.text)
        edited=self.client.put(f'/api/buses/{self.bus_id}',json=self.bus_data)
        self.assertEqual(edited.status_code,200,edited.text)
        self.assertEqual(edited.json()['device_id'],'GPS-UNCHANGED')
        self.assertEqual(self.save().json()['status'],'NOT_ADDED')

    def test_expiry_only_and_all_document_types(self):
        kinds=[d['document_type'] for d in self.client.get(self.url).json()['documents']]
        for kind in kinds:
            response=self.save(kind,valid_until='2030-01-01')
            self.assertEqual(response.status_code,200,response.text)
            self.assertFalse(response.json()['has_file'])
            self.assertEqual(response.json()['bus_id'],self.bus_id)

    def test_upload_without_expiry_and_protected_download(self):
        image=BytesIO(); Image.new('RGB',(10,10),'blue').save(image,'PNG')
        for kind,name,body,mime in [('insurance','scan.png',image.getvalue(),'image/png'),('rc','scan.pdf',b'%PDF-1.4\n%%EOF','application/pdf')]:
            response=self.save(kind,file=(name,body,mime))
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['status'],'ADDED')
            downloaded=self.client.get(f'{self.url}/{kind}/file')
            self.assertEqual(downloaded.content,body)
            self.assertIn('no-store',downloaded.headers['cache-control'])
        self.assertEqual(self.check(),0)
        self.actor.role='User'
        self.assertEqual(self.client.get(f'{self.url}/rc/file').status_code,403)

    def test_admin_permissions_and_missing_targets(self):
        for role in ['User','Driver','GPS Technician']:
            self.actor.role=role
            self.assertEqual(self.client.get(self.url).status_code,403)
            self.assertEqual(self.save().status_code,403)
        self.actor.role='Admin'
        self.assertEqual(self.client.get('/api/buses/999/documents').status_code,404)
        self.assertEqual(self.save('unknown').status_code,404)
        del self.app.dependency_overrides[require_authenticated]
        self.assertEqual(self.client.get(self.url).status_code,401)

    def test_bad_upload_is_atomic_and_large_supported_upload_passes_middleware(self):
        self.assertEqual(self.save(valid_until='2030-01-01',file=('bad.png',b'<html>unsafe</html>','image/png')).status_code,400)
        self.assertEqual(self.client.get(self.url).json()['documents'][2]['status'],'NOT_ADDED')
        response=self.save(file=('large.pdf',b'%PDF-1.4\n'+b'0'*(3*1024*1024),'application/pdf'))
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.save(version=1,file=('too-large.pdf',b'%PDF-'+b'0'*(5*1024*1024),'application/pdf')).status_code,413)
        self.assertEqual(self.save('rc',file=('bad.html',b'<html>','text/html')).status_code,400)
        self.assertEqual(self.save('rc',valid_until='not-a-date').status_code,422)

    def test_update_retains_file_and_explicit_removal(self):
        self.save(file=('scan.pdf',b'%PDF-1.4\n%%EOF','application/pdf'))
        result=self.save(version=1,remarks='Renewed metadata').json()
        self.assertTrue(result['has_file'])
        result=self.save(version=2,remove_file=True).json()
        self.assertFalse(result['has_file'])
        self.assertEqual(self.client.get(f'{self.url}/insurance/file').status_code,404)

    def test_status_boundaries(self):
        self.assertEqual(document_status(None,self.today),'NOT_ADDED')
        self.assertEqual(document_status(SimpleNamespace(valid_until=None),self.today),'ADDED')
        for days,status in [(31,'VALID'),(30,'EXPIRING'),(8,'EXPIRING'),(7,'EXPIRING_SOON'),(0,'EXPIRING_SOON'),(-1,'EXPIRED')]:
            self.assertEqual(document_status(SimpleNamespace(valid_until=self.today+timedelta(days=days)),self.today),status)

    def test_reminder_thresholds_deduplication_renewal_and_links(self):
        expiry=self.today+timedelta(days=30)
        self.save(valid_until=expiry.isoformat())
        self.assertEqual(self.check(self.today-timedelta(days=1)),0)
        self.assertEqual(self.check(self.today+timedelta(days=2)),1) # delayed daily check
        self.assertEqual(self.check(self.today+timedelta(days=3)),0)
        self.assertEqual(self.check(expiry-timedelta(days=6)),1)
        self.assertEqual(self.check(expiry),0)
        self.assertEqual(self.check(expiry+timedelta(days=1)),0)
        alerts=self.client.get('/api/notifications').json()['notifications']
        self.assertEqual(len(alerts),2)
        self.assertEqual(alerts[0]['document_link'],f'#buses?bus={self.bus_id}&document=insurance')
        self.save(version=1,valid_until='2027-10-08')
        self.assertTrue(all(n['status']=='Resolved' for n in self.client.get('/api/notifications').json()['notifications']))
        self.assertEqual(self.check(),0)
        self.assertEqual(self.check(date(2027,9,8)),1)
        self.assertEqual(self.check(date(2027,10,1)),1)

    def test_no_expiry_overdue_and_urgent_window(self):
        self.save('rc',document_number='RC')
        self.save('fitness',valid_until=(self.today-timedelta(days=1)).isoformat())
        self.save('insurance',valid_until=(self.today+timedelta(days=3)).isoformat())
        self.assertEqual(self.check(),1)
        with self.sessions() as db:
            self.assertEqual(db.scalar(select(BusDocumentReminder)).reminder_type,'7_DAY')

    def test_document_reminders_do_not_become_driver_trip_feedback(self):
        self.save(valid_until=(self.today+timedelta(days=20)).isoformat())
        self.check()
        buses=self.client.get('/api/trip-history/buses').json()
        self.assertEqual(buses[0]['feedback_count'],0)
        history=self.client.get(f'/api/trip-history/buses/{self.bus_id}').json()
        self.assertEqual(history['timeline'],[])

    def test_parallel_workers_generate_one_notification_and_restart_keeps_dedup(self):
        self.save(valid_until=(self.today+timedelta(days=28)).isoformat())
        with ThreadPoolExecutor(max_workers=2) as pool:
            counts=list(pool.map(lambda _:self.check(),range(2)))
        self.assertEqual(sum(counts),1)
        self.engine.dispose() # reconnect from persistent state
        self.assertEqual(self.check(),0)
        with self.sessions() as db:
            self.assertEqual(db.query(FleetNotification).count(),1)

    def test_daily_worker_checks_without_a_browser(self):
        from backend.main import _document_expiry_loop
        self.save(valid_until=(self.today+timedelta(days=20)).isoformat())
        sleep=AsyncMock(side_effect=asyncio.CancelledError)
        with patch('backend.main.SessionLocal',self.sessions), patch('backend.main.restore_in_progress',return_value=False), \
             patch('backend.services.bus_documents.compliance_today',return_value=self.today), patch('backend.main.asyncio.sleep',sleep):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(_document_expiry_loop())
        sleep.assert_awaited_once_with(86400)
        with self.sessions() as db:
            self.assertEqual(db.query(FleetNotification).count(),1)

    def test_duplicate_saves_rejected_without_overwriting(self):
        self.save(document_number='original')
        self.assertEqual(self.save(document_number='duplicate').status_code,409)
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses=list(pool.map(lambda number:self.save(version=1,document_number=str(number)).status_code,range(2)))
        self.assertEqual(sorted(statuses),[200,409])

    def test_repeated_schema_creation_and_backup_preserve_optional_files(self):
        original_columns=[c['name'] for c in inspect(self.engine).get_columns('buses')]
        self.save(file=('scan.pdf',b'%PDF-1.4\n%%EOF','application/pdf'))
        Base.metadata.create_all(self.engine)
        self.assertEqual(original_columns,[c['name'] for c in inspect(self.engine).get_columns('buses')])
        archive=create_database_backup_archive(self.engine)
        restore_database_backup_archive(self.engine,archive)
        self.assertEqual(self.client.get(f'{self.url}/insurance/file').content,b'%PDF-1.4\n%%EOF')


if __name__=='__main__':
    unittest.main()
