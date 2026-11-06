import unittest
import uuid
import asyncio
import json
import zipfile
from io import BytesIO
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from fastapi import HTTPException, FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from backend.database import Base
from backend.models import Bus, User, Route, RouteStop, Stop
from backend.routes.models_tracking import LiveTrip
from backend.routes import route_studio as api
from backend.models_route_studio import TracePoint, TraceSession
from backend.services.daily_direction import apply_daily_direction, IST
from backend.services.trace_geometry import published_geometry


class RouteStudioTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, autoflush=False)()
        self.bus = Bus(bus_number='1', registration_number='TEST', capacity=40, manufacturer='Test', model='Test', year=2026, fuel_type='Diesel')
        self.tracer = User(username='tracer', full_name='Tracer', password_hash='unused', role='Tracer', status='Active')
        self.admin = User(username='admin', full_name='Admin', password_hash='unused', role='Admin', status='Active')
        self.db.add_all([self.bus,self.tracer,self.admin]); self.db.flush()
        self.route = Route(route_code='R001', route_name='Manual', bus_id=self.bus.id, status='Active')
        self.db.add(self.route); self.db.commit()
        api.assign(api.Assignment(user_id=self.tracer.id,bus_id=self.bus.id),self.db,self.admin)

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    def start(self):
        return api.start(api.Start(request_id=uuid.uuid4(),name='Recorded'),self.db,self.tracer)

    def points(self):
        now=datetime.now(timezone.utc)
        return [api.Point(sequence=i+1,latitude=10+i*.001,longitude=76,accuracy=5,speed=7,recorded_at=now+timedelta(seconds=i*15)) for i in range(2)]

    def test_off_and_role_gate(self):
        with patch.dict('os.environ', {'ENABLE_ROUTE_STUDIO':'false'}):
            with self.assertRaises(HTTPException): api.access(self.tracer)
        self.tracer.role='User'
        with patch.dict('os.environ', {'ENABLE_ROUTE_STUDIO':'true'}):
            with self.assertRaises(HTTPException): api.access(self.tracer)

    def test_recording_idempotency_and_finish_gap(self):
        s=self.start(); batch=api.Batch(points=self.points())
        api.upload(s['id'],batch,self.db,self.tracer); api.upload(s['id'],batch,self.db,self.tracer)
        self.assertEqual(self.db.query(TracePoint).count(),2)
        with self.assertRaises(HTTPException): api.action(s['id'],api.Action(action='finish',final_sequence=3),self.db,self.tracer)
        result=api.action(s['id'],api.Action(action='finish',final_sequence=2),self.db,self.tracer)
        self.assertEqual(result['status'],'DRAFT')
        self.assertEqual(self.route.bus_id,self.bus.id)
        self.assertEqual(self.db.query(LiveTrip).count(),0)

    def test_stationary_samples_cannot_be_published_as_a_route(self):
        session = self.start()
        now = datetime.now(timezone.utc)
        points = [api.Point(sequence=index + 1, latitude=10 + index * .0001,
                            longitude=76, accuracy=5, speed=0,
                            recorded_at=now + timedelta(seconds=index * 5))
                  for index in range(2)]
        api.upload(session['id'], api.Batch(points=points), self.db, self.tracer)
        with self.assertRaises(HTTPException) as error:
            api.action(session['id'], api.Action(action='finish', final_sequence=2), self.db, self.tracer)
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(self.db.query(TracePoint).count(), 2)
        self.assertEqual(self.db.get(TraceSession, session['id']).status, 'RECORDING')

    def test_other_tracer_and_conflicting_batch_rejected(self):
        s=self.start(); batch=api.Batch(points=self.points())
        api.upload(s['id'],batch,self.db,self.tracer)
        batch.points[0].latitude=11
        with self.assertRaises(HTTPException): api.upload(s['id'],batch,self.db,self.tracer)
        other=User(id=999,role='Tracer')
        with self.assertRaises(HTTPException): api.detail(s['id'],self.db,other)

    def test_explicit_switch_preserves_manual_and_geometry(self):
        s=self.start(); api.upload(s['id'],api.Batch(points=self.points()),self.db,self.tracer)
        s=api.action(s['id'],api.Action(action='finish',final_sequence=2),self.db,self.tracer)
        stops=[api.DraftStop(name=f'Stop {i}',latitude=10+i*.001,longitude=76) for i in range(2)]
        s=api.edit(s['id'],api.Draft(revision=1,name=s['name'],stops=stops,geometry=s['geometry']),self.db,self.admin)
        s=api.select_route(s['id'],api.Select(mode='traced',revision=s['revision']),self.db,self.admin)
        self.assertIsNotNone(published_geometry(self.db,s['route_id'],self.bus.id))
        self.assertIsNotNone(self.db.get(Route,self.route.id))
        api.select_route(s['id'],api.Select(mode='manual',revision=s['revision']),self.db,self.admin)
        self.assertEqual(self.db.get(Route,self.route.id).bus_id,self.bus.id)
        self.assertIsNone(published_geometry(self.db,s['route_id'],self.bus.id))

    def test_midnight_once_catchup_and_coordinates_preserved(self):
        now=datetime(2026,11,6,0,1,tzinfo=IST)
        trip=LiveTrip(bus_id=self.bus.id,route_id=self.route.id,status='Running',route_direction='reverse',
                      started_at=now-timedelta(hours=10),current_latitude=10,current_longitude=76)
        self.db.add(trip);self.db.commit()
        self.assertEqual(apply_daily_direction(self.db,now-timedelta(minutes=1)),0)
        self.db.commit()
        self.assertEqual(apply_daily_direction(self.db,now),1);self.db.commit()
        self.assertEqual(trip.route_direction,'forward')
        self.assertEqual(trip.current_latitude,10)
        trip.route_direction='reverse';self.db.commit()
        self.assertEqual(apply_daily_direction(self.db,now+timedelta(hours=10)),0)
        self.assertEqual(trip.route_direction,'reverse')
        self.assertEqual(apply_daily_direction(self.db,now+timedelta(days=1,hours=2)),1)

    def test_reassignment_rejected_during_capture(self):
        self.start()
        with self.assertRaises(HTTPException):
            api.assign(api.Assignment(user_id=self.tracer.id,bus_id=self.bus.id),self.db,self.admin)

    def test_start_retry_and_pause_retry(self):
        data=api.Start(request_id=uuid.uuid4(),name='Retry')
        first=api.start(data,self.db,self.tracer)
        self.assertEqual(api.start(data,self.db,self.tracer)['id'],first['id'])
        for _ in range(2):
            self.assertEqual(api.action(first['id'],api.Action(action='pause'),self.db,self.tracer)['status'],'PAUSED')
        self.assertEqual(self.db.query(TraceSession).count(),1)

    def test_running_trip_blocks_selection_without_changing_assignment(self):
        s=self.start();api.upload(s['id'],api.Batch(points=self.points()),self.db,self.tracer)
        s=api.action(s['id'],api.Action(action='finish',final_sequence=2),self.db,self.tracer)
        self.db.add(LiveTrip(bus_id=self.bus.id,route_id=self.route.id,status='Running',route_direction='reverse'))
        self.db.commit()
        with self.assertRaises(HTTPException): api.select_route(s['id'],api.Select(mode='traced',revision=1),self.db,self.admin)
        self.db.rollback()
        self.assertEqual(self.db.get(Route,self.route.id).bus_id,self.bus.id)
        self.assertEqual(self.db.query(LiveTrip).one().route_direction,'reverse')

    def test_round_trip_pairing_and_midnight_boundary(self):
        from backend.routes.trip_history import completed_round_trips
        stops={1:SimpleNamespace(id=1,route_id=9,sequence=1),2:SimpleNamespace(id=2,route_id=9,sequence=2)}
        def event(i,stop,day):
            return SimpleNamespace(id=i,trip_id=7,route_stop_id=stop,event_type='Leg completed',occurred_at=datetime(2026,11,day,10+i,tzinfo=IST))
        self.assertEqual(len(completed_round_trips([event(1,2,5),event(2,1,5)],stops)),1)
        self.assertEqual(completed_round_trips([event(1,2,5),event(2,1,6)],stops),[])

    def test_http_tracer_cannot_assign_or_publish_and_flag_blocks_capture(self):
        from backend.database import get_db
        from backend.security import require_authenticated
        app=FastAPI();app.include_router(api.router)
        app.dependency_overrides[get_db]=lambda:self.db
        app.dependency_overrides[require_authenticated]=lambda:self.tracer
        async def call(method,path,body):
            messages=[]
            async def receive(): return {"type":"http.request","body":json.dumps(body).encode(),"more_body":False}
            async def send(message): messages.append(message)
            await app({"type":"http","asgi":{"version":"3.0"},"http_version":"1.1","scheme":"https","method":method,"path":path,
                       "raw_path":path.encode(),"query_string":b"","headers":[(b"content-type",b"application/json")],
                       "client":('127.0.0.1',1),"server":('test',443),"root_path":""},receive,send)
            return next(m['status'] for m in messages if m['type']=='http.response.start')
        with patch.dict('os.environ',{'ENABLE_ROUTE_STUDIO':'true'}):
            self.assertEqual(asyncio.run(call('PUT','/api/route-studio/assignment',{'user_id':self.tracer.id,'bus_id':self.bus.id})),403)
            self.assertEqual(asyncio.run(call('POST','/api/route-studio/recordings/unknown/select',{'mode':'traced','revision':1})),403)
        with patch.dict('os.environ',{'ENABLE_ROUTE_STUDIO':'false'}):
            self.assertEqual(asyncio.run(call('POST','/api/route-studio/recordings',{'request_id':str(uuid.uuid4()),'name':'Off'})),404)

    def test_exact_legacy_backup_is_accepted_without_relaxing_other_tables(self):
        from backend.services.database_backup import create_database_backup_archive, _read_backup_archive, _application_metadata, MANIFEST_MEMBER, DATA_MEMBER
        archive=create_database_backup_archive(self.engine)
        with zipfile.ZipFile(BytesIO(archive)) as z:
            manifest=json.loads(z.read(MANIFEST_MEMBER)); data=json.loads(z.read(DATA_MEMBER))
        def added(name): return name.startswith('route_studio_') or name=='daily_direction_checkpoints'
        manifest['schema']=[s for s in manifest['schema'] if not added(s['name'])]
        data={name:rows for name,rows in data.items() if not added(name)}
        def pack():
            buffer=BytesIO()
            with zipfile.ZipFile(buffer,'w') as z:
                z.writestr(MANIFEST_MEMBER,json.dumps(manifest));z.writestr(DATA_MEMBER,json.dumps(data))
            return buffer.getvalue()
        restored=_read_backup_archive(pack(),_application_metadata())
        self.assertEqual(restored['route_studio_sessions'],[])
        self.assertEqual(len(restored['buses']),1)
        data.pop('users')
        with self.assertRaises(ValueError): _read_backup_archive(pack(),_application_metadata())

if __name__ == '__main__': unittest.main()
