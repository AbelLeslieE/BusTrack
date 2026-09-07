# Reset route progress

In **Provider Health → Manual route control**, select **Reset to first stop**.
Choose Outbound (the saved route's first stop) or Return (its last stop), check
the displayed starting stop name, then confirm. The existing direction action
still preserves current progress for trips that are not waiting after a reset.

The reset keeps the current trip, physical GPS position, GPS timestamp,
assignments, stop definitions, and history. Only current progression is reset.
Students see the first stop approaching, all others upcoming, and “Route reset —
waiting to reach the first stop.” A reset does not make an old GPS position fresh.

Progression waits for a timestamped observation captured **after** the reset,
within the existing freshness window, and inside the selected first stop's
geofence. Positions elsewhere may update the map but cannot skip the first stop.
After its arrival, the existing departure, skipped-stop, and terminal-reversal
rules resume. Do not use reset as a way to continue from a middle stop.

## API and persistence

- `GET /api/integrations/gps/provider-health/buses/{bus_id}/reset-options`
  returns the active trip, reset version, and names of the two possible starts.
- `POST /api/integrations/gps/provider-health/buses/{bus_id}/reset`
  accepts `direction`, `trip_id`, `expected_reset_version`, and a UUID
  `request_id`. Retry an uncertain request with the same ID and payload.
- Both endpoints require the existing Admin/Technician integration permission.
  Missing trips and outdated assignments fail without creating a new trip.
- The trip stores `route_reset_at`, `reset_waiting_for_start`, `reset_version`,
  and `reset_request_id`. An audit event records the actor and previous progress.
- Backend startup adds these columns to existing databases; new databases include
  them in their schema. Restart the backend when installing this change.
- Provider and phone writes share the reset transaction lock: a bus row lock on
  PostgreSQL and a writer transaction on SQLite. A reset version prevents two
  dialogs opened on the same state from silently resetting it twice.
- Phone updates now send their original `recorded_at` and `reset_version`.
  Legacy phone requests without that metadata cannot advance a reset trip.
  Provider observations without a device timestamp cannot prove they belong to
  the new journey and cannot advance a reset trip either.

## Changed implementation files

- `backend/database.py`: additive compatibility migration.
- `backend/routes/models_tracking.py`: persistent reset fields.
- `backend/schemas_gps_provider.py`, `backend/schemas_tracking.py`: request and
  response contracts, including phone fix metadata.
- `backend/services/trip_reset.py`: reset metadata, timestamp checks, write lock.
- `backend/routes/gps_provider.py`: preview/reset endpoints, provider gating,
  provider-health and driver-source metadata.
- `backend/services/airotrack.py`: shared tracking write lock.
- `backend/routes/gps.py`: first-stop gate and phone/reset write synchronization.
- `backend/routes/student.py`: reset state in student responses.
- `frontend/modules/js/providerHealth.js`, `frontend/modules/css/providerHealth.css`:
  reset dialog, direction preview, submission protection, waiting status.
- `frontend/modules/js/studentTracking.js`: reset-aware ETA, route/terminal
  invalidation, and waiting/stale messages.
- `frontend/modules/js/trackingService.js`: driver reset synchronization and
  timestamped phone fixes.
- `tests/test_trip_reset.py`, `tests/test_trip_reset_frontend.mjs`: regression tests.

## Verification

Run from the repository root:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests
node --test tests/test_trip_reset_frontend.mjs
```

Tests use temporary databases and mocked network boundaries. The reset dialog
was also exercised in a local browser against an isolated test bus. Production
PostgreSQL concurrency and real GPS hardware were not exercised during development.
