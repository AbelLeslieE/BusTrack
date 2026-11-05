# Route Studio — Phase 0 implementation plan

Status: architecture inspection and design only; application implementation has not started.
Date: 2026-11-05.

## Verified architecture

- FastAPI, SQLAlchemy 2, Pydantic 2, and vanilla JavaScript ES modules; no frontend framework or frontend build pipeline. Leaflet 1.9.4, OpenStreetMap tiles, OSRM route requests, and Nominatim are already used.
- `backend/main.py` loads configuration, registers models/routers, serves the SPA, and owns provider polling, retention, and document reminder lifecycle tasks.
- `backend/database.py` supports development SQLite and production PostgreSQL, with additive startup compatibility migrations and a PostgreSQL startup advisory lock.
- Authentication uses bcrypt, JWT HttpOnly cookies, tracked sessions, and account versions. `require_gps_technician` permits Admin and Technician; `require_management` and `require_admin` permit Admin only. There is no existing per-bus technician ACL: current integration tools permit fleet-wide access.
- `frontend/common/bootstrap.js` authenticates before importing the hash router. `router.js` selects role module maps and calls view cleanup on navigation. Admin navigation lives in `common/sidebar.js`; Technician navigation in `modules/js/technicianSidebar.js`. User/student and Driver have separate modules.
- Repository deployment configuration describes Cloud Run web/worker separation, Cloud SQL PostgreSQL, and secret bindings. This inspection does not verify current cloud state. This transfer directory has no Git metadata.

## GPS and routing flows

- Driver `trackingService.js` owns browser geolocation watchers and sends `/api/gps` requests. It is not a general-purpose shared location event bus.
- Airotrack, Kingstrack, and `/api/integrations/gps/ingest` normalize vehicle fixes into provider history and `BusGPSState`; vehicle and phone paths update `LiveTrip` and invoke `gps.py:update_route_stop_progression`.
- Progression persists arrival/departure/skipped/leg events, direction and reset boundaries. No Route Studio code should mutate these states while recording or generating drafts.
- Remote feeds normally provide 20-second moving updates and 120-second ignition-off heartbeats. Faster recorder polling cannot increase their true sampling resolution.
- Live views use EventSource streams with polling fallbacks. Student tracking resolves the authenticated student's route and bus server-side. Map rendering computes road lines from ordered stops using OSRM; published geometry storage is currently absent.
- `Route.bus_id` / `Route.driver_id` are authoritative assignments; `Student.route_id` is authoritative for passengers. Bus and Driver fields are legacy mirrors maintained by `save_route_assignment`.
- Existing `route_stops` is already a canonical table. Historical `TripStopEvent` records reference its IDs. Studio draft stops must use a separate table, and publication must not delete historically referenced stops.
- Retention can retain only two live points per source and removes completed-trip coordinates. Route Studio must own raw recordings; historical live telemetry cannot be treated as a durable recording archive.

## Proposed independent components

New files: `backend/models_route_studio.py`, `backend/schemas_route_studio.py`, `backend/routes/route_studio.py`; `backend/services/route_studio/` modules for sessions, recording repository, generation, map matching, editing, publication, worker jobs and audit; frontend `routeStudio.js`, recorder/persistence/editor modules, and scoped `routeStudio.css`. Add focused Python and Node tests and operational documentation.

New tables, names prefixed `route_studio_`: sessions; points; recording markers; route families; versions; version stops; jobs; audit events; active publication bindings. Keep existing canonical route and stop tables intact. Store raw points, quality flags, source/fix/receipt timestamps, sequence numbers, and pause boundaries. Unique `(session_id, sequence_number)` and source observation identities enforce idempotency; conflicting duplicate content returns 409. Use durable per-bus session ownership to prevent concurrent starts on SQLite and PostgreSQL.

Sessions implement explicit validated transitions across IDLE, INITIALIZING, RECORDING, PAUSED, FINALIZING, PROCESSING, DRAFT_READY, COMPLETED, FAILED and RECOVERABLE. Store transition timestamps, error details, upload acknowledgments and final sequence watermark. Finish must wait for acknowledged pending uploads; it cannot quietly process a partial browser upload.

Use namespaced `/api/route-studio/...` routes to avoid existing route endpoints. Server enforcement combines `ENABLE_ROUTE_STUDIO=false` by default, existing role checks, and optional test-account eligibility. Global enablement never starts recording. Reject student and driver access to raw recordings. Admin alone approves, publishes, and restores versions.

## Recording and generation strategy

Explicit source selection: onboard browser or existing remote vehicle feed. Browser mode checks permission and first-fix quality, persists to IndexedDB before enqueueing uploads, samples at configurable intervals and batches uploads with bounded exponential retry. Restore metadata and pending points after reload, reauthorize, and require explicit recovery before restarting location collection. A page-owned watcher must never clear the existing driver watcher. Show foreground-only limitations and interruptions; no native background guarantee is implied.

Remote mode consumes durable provider observations with a persisted cursor in a separate worker while sessions are active. Detect cursor gaps caused by retention or outages and flag them; never fabricate samples. Do not increase upstream polling or put map matching in GPS transactions. Worker availability is required for remote capture. When no recordings or processing jobs exist, no Studio collection timer should run; durable jobs need explicit activation and startup recovery. Feature disablement must stop collectors and preserve pending data for recovery.

Generation uses a durable, bounded job queue and worker leases, separate database sessions and limited concurrency. Preserve raw traces. Validate sequence/time/accuracy/jumps, split at pauses and evidence gaps, and retain quality metadata. Produce GeoJSON MultiLineString where continuity is not supported. Stationary clusters create reviewable stop candidates, never official stops.

Leaflet is reusable. Existing OSRM `/route` requests are not trace map matching. Implement a configurable server-side matching adapter after checking the chosen provider's current API, limits and storage terms. Do not assume the public demo service is a production matching backend. Use overlap-aware chunks, explicit timeouts, bounded retries and uncertain-segment warnings. Provider failure leaves a recoverable draft/job; an unmatched trace must not be labelled road-aligned.

Editor state stays within Route Studio. Provide raw/matched layers, ordered stop edits and candidate decisions, waypoint/segment corrections with road matching, split/join validation, undo/redo, saved revision checks and version comparison. Published versions are immutable; restore creates a new reviewed publication. Draft edits invalidate earlier approval.

## Minimal existing-file integration

1. Register independent models and router in `main.py`; expose authenticated feature availability and conditionally activate Studio worker lifecycle. Add example configuration only, never edit real environment secrets.
2. Add conditional Admin/Technician navigation and module/style registration in the existing bootstrap/router/sidebar files. Studio-disabled bootstrap errors must not prevent normal portal startup.
3. Publication needs a shared transaction-neutral assignment helper: extract the existing assignment operations without changing their behavior; keep the existing endpoint's commit and response unchanged. The new publisher calls the helper inside its own transaction. This is the narrow justified exception to avoiding existing-function edits.
4. Add a published-geometry read interface and narrowly scoped map-line consumers. Existing routes without a Studio publication retain current OSRM rendering. Live position and marker logic must stay separate. Disabling Studio controls must not make already published route geometry disappear.
5. Review backup compatibility explicitly: current restore checks exact model schema and table sets, so adding tables can reject old archives. Add a versioned compatibility path for known pre-Studio backups; never relax arbitrary schema validation. Test both old and new archives before rollout.

## Publishing hazards and transaction design

Current `save_route_assignment` commits internally and moving a bus detaches students on the old route. Blind reuse would violate atomicity and passenger continuity. Current stop replacement can also clear live progression pointers and rejects deletion of stops with historical references.

Publication therefore requires an explicit impact preview covering bus, driver, affected student assignments, stop mappings, active trips and existing pass eligibility. Preserve old routes and canonical stop IDs. Materialize an approved version into a new canonical route where necessary, retaining lineage. Resolve every affected passenger's target stop; reject unresolved mappings. Apply canonical records, reviewed passenger mapping, assignment mirrors, active-version binding and audit together under locking and expected-version checks. Never silently move passengers by nearest-stop distance.

Do not repoint a running trip to a different route. Stage conflicting publications until an explicit safe activation boundary; a background worker must not stop/reset trips to force publication. Continuous vehicle-owned sessions make this a real activation constraint that the UI must explain. Recheck conflicts at activation. On failure the previous assignment remains intact. Route changes affect signed pass route claims and must be covered by pass regression tests.

## Verification and baseline

Earlier checks in this chat: 160 Python tests passed; all 13 Node test files passed; 73 frontend JavaScript files and 7 PowerShell scripts passed syntax checks. These are pre-change results, not Route Studio acceptance. The previous response's count of 42 JavaScript cases was inaccurate: the runner output included 45 named cases plus standalone assertion scripts.

Before edits preserve a source checksum inventory and copies of each modified source file outside application paths; no Git repository exists here. Do not copy secrets into review artifacts. Use disposable databases, never live bus resets or real assignments for testing.

Test feature off (no watcher/task/upload), access control and eligibility, legal/illegal state transitions, concurrent starts, durable sequence acknowledgments, conflicting duplicates, permission/network loss, pause boundaries, finish with pending points, restart recovery, worker crash/lease recovery, matching outages/chunk seams/gaps, uncertain geometry, stop suggestions and all editor commands. Test optimistic draft concurrency, stale approval, atomic publish failure, historical reference preservation, passenger/pass continuity, safe activation and version restore. Run SQLite and PostgreSQL concurrency checks. Run the existing regression suites after integration milestones.

Measure baseline versus enabled/off/recording/generation on the same isolated fixture: GPS latency, read latency, upload throughput, database writes, CPU/memory and map responsiveness. Physical phones, locked/background browser behavior, vendor delivery and production load remain unverified until tested; do not claim zero regression from unit tests alone.

## Rollout and rollback

Deploy additive schema and disabled code first. Enable only eligible test accounts in staging; record, edit and publish only test buses. Preserve production configuration and data. Document browser support, remote feed granularity, retention and authorized deletion. Raw recording deletion must be explicit and scoped; live retention/reset must not delete Studio history.

Feature rollback disables new Studio collection/jobs/controls while preserving canonical published routes, geometry, pending recordings and audits. No table drops. Source rollback must account for additive tables and backup schema compatibility; do not assume reverting code alone restores backup compatibility. Retain the pre-change source baseline and an independently verified database backup before a deployment.
