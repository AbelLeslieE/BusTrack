# Optional bus documents

Open **Admin → Buses → View bus → Documents & Compliance**. RC, fitness,
insurance, permit, PUC, tax, fire extinguisher servicing and first aid inspections
are optional. Add a date, a number, remarks, a file, any combination, or nothing.
Existing Add/Edit Bus forms and their required fields are unchanged.

## Storage and deployment

`bus_documents` references the existing integer `buses.id`. `bus_document_reminders`
records each expiry cycle and links to the existing admin notification feed.
The existing `initialize_database()` / SQLAlchemy `create_all()` startup migration
adds both tables without modifying bus columns or copying/recreating buses.
Deploy the code and allow normal startup to finish. No document backfill or
additional signing key, storage service, or push credentials are needed.

PDF, JPG/JPEG and PNG files are limited to 5 MB. Image content is verified;
PDFs require a PDF signature. Files are downloaded as attachments rather than
rendered as trusted app content. This is type validation, not antivirus scanning.
File bytes are deferred database columns, so list endpoints do not read them.
They survive an ephemeral hosting filesystem and are included in the existing
database backup format. Metadata and file replacement commit together.
Downloads and all document APIs require Admin authentication; there are no public
file URLs. Renewing replaces the current file only when a new one is selected.
Full document version history is not implemented; `version` detects stale saves.

## Reminders

The isolated backend task checks at startup and every 24 hours, with a five-minute
retry after errors. It pauses during database restore. India calendar dates
(UTC+05:30) determine expiry; a document expires after its valid-until date.

- 8–30 days remaining: one `30_DAY` reminder per document and expiry date.
- 0–7 days remaining: one `7_DAY` reminder per document and expiry date.
- After expiry: **Expired** status, without repeated overdue notifications.
- No expiry: **Added**, with no reminders. No record: neutral **Not added**.

Checks catch up within a window rather than requiring an exact anniversary.
If a document is first seen with only seven days or less remaining, only the
urgent reminder is emitted; an obsolete 30-day reminder is not sent alongside it.
The server must be running to execute a check. A sleeping/offline host catches up
on startup; it cannot deliver while offline. Changing expiry retires old open
alerts and creates an independent future reminder cycle. Clearing expiry stops
future reminders. Historical dedup records are retained.

Document row locks (PostgreSQL), short writer transactions (SQLite), and a unique
`(document_id, expiry_date, reminder_type)` constraint prevent duplicate alerts.
The reminder and notification commit atomically. Optimistic document versions
reject repeated or concurrent stale saves with a clear 409 response.

Notifications use the current admin module and its refresh mechanism. **View
document** links to `#buses?bus=<id>&document=<type>`. The driver feed and trip
history do not show compliance reminders. This repository has no service worker,
push subscription endpoints or web-push sender; no separate push stack is added.

## Tracking boundary and verification

Tracking does not import or query document records. GPS identifiers, bus IDs,
canonical stops, assignments, trip state, ignition handling and automatic direction
reversal are unchanged. Missing or expired documents cannot disable any bus/trip.

Run from the repository root:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p 'test_*.py'
node --test tests/test_trip_reset_frontend.mjs tests/test_pass_scanner_frontend.mjs
```

`test_bus_documents.py` uses disposable databases for metadata, files, permissions,
expiry thresholds, renewal, backup, deduplication and concurrent saves.
`test_document_tracking.py` verifies provider and mobile tracking with zero and
expired documents alongside the existing full tracking regression suite.
Browser verification uses a disposable database, never a real bus reset or journey.
