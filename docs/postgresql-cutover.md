# SQLite-to-PostgreSQL cutover

BusTrack uses PostgreSQL as its production database. It is the right default
for concurrent mobile/MVD GPS updates, live-portal polling, transactions, and
foreign-key enforcement. TimescaleDB can be evaluated later if the telemetry
history grows to millions of points; it is a PostgreSQL extension, not a
replacement required for the current application.

The migration command does not modify or delete the SQLite source. During an
actual cutover it creates a second, timestamped SQLite snapshot in
`database/backups/`, writes to an empty PostgreSQL database in one transaction,
checks every copied table count and all application foreign keys, and keeps
SQLite as the rollback source.

## Prepare PostgreSQL

Provision an empty PostgreSQL 16+ database. Render is already configured to
provision one from `render.yaml`; use the database's external connection string
for a local migration or run the command from an approved deployment job. Keep
the URL in a secret store or in an uncommitted environment variable; never put
database passwords in the repository.

The included Python environment already requires `psycopg2-binary`. The URL
can be either `postgresql://...` or the older `postgres://...` form supplied by
some hosts.

## Safe cutover procedure

1. Run a dry run while the local service is still online:

   ```powershell
   .\.venv\Scripts\python.exe scripts\migrate_sqlite_to_postgres.py
   ```

2. Schedule a short maintenance window. Stop the API and GPS ingest/polling so
   the snapshot includes the last accepted GPS fix. This prevents a location
   update being accepted by SQLite after the copy has begun.

3. Use the hidden prompt so the credential does not appear in PowerShell
   history or copied terminal output:

   ```powershell
   .\.venv\Scripts\python.exe scripts\migrate_sqlite_to_postgres.py --apply --archive-invalid-history --prompt-target-url
   ```

4. Paste the current Render External Database URL only when the hidden prompt
   appears. The archive option retains non-repairable legacy records as their
   complete original JSON instead of fabricating missing parent records.

5. Review the printed copied counts, archive count, and successful
   foreign-key verification. Do not change the running application's
   `DATABASE_URL` unless all checks pass.

   If an interrupted terminal session leaves it unclear whether a prior copy
   completed, use the read-only verifier. It never writes to PostgreSQL:

   ```powershell
   .\.venv\Scripts\python.exe scripts\migrate_sqlite_to_postgres.py --verify-existing-target --prompt-target-url
   ```

6. Set the application `DATABASE_URL` to that same PostgreSQL URL in the
   deployment secret store, restart the API, and run the normal GPS terminal
   reverse/forward checks. Keep both SQLite files untouched until the new
   service has operated correctly through at least one complete route cycle.

## Existing SQLite data integrity

The current local database contains historical rows that point to routes,
route stops, drivers, or users that were later deleted. PostgreSQL correctly
will not accept those invalid relationships. The migration therefore applies
only two traceable outcomes:

- a nullable broken link is set to `NULL`, with the original ID and reason
  recorded in `migration_repairs`;
- a row that requires a deleted parent (and any required child records) is
  retained unchanged in `migration_archived_records`.

No GPS point, account, trip, or audit payload is silently dropped. Valid route
history, locations, GPS provider positions, and current bus states remain in
their normal application tables.

## GPS data handling after cutover

All application timestamps are stored as UTC-aware PostgreSQL timestamps. The
copy normalizes older timezone-naive SQLite values to UTC, preserves the GPS
device's `fix_time` separately from server `received_at`, and creates indexes
for the latest vehicle fix, active trip, location history, and stop events.
This lets the portals prefer fresh device GPS while retaining the correct
last-known location when the ignition is off or a GPS feed is briefly absent.

PostgreSQL also activates the built-in coordinate-retention service by default.
It keeps the current `bus_gps_states` row for every bus (so the live map can
still show a parked bus with ignition off), the newest two active-trip fixes
from each GPS source for speed calculation, and a small 15-minute provider
diagnostic window. When a driver or administrator completes a trip, every raw
`live_locations` coordinate for that trip is deleted immediately. The durable
record is `trip_stop_events`: trip, stop, route order, Arrived/Departed type,
and UTC timestamp. Old stop-event coordinates are removed too. Change the
retention values through the documented environment variables only if the
operations team needs a longer diagnostics window.
