# Tracer recording and daily direction recovery

## Activation and use

Set `ENABLE_ROUTE_STUDIO=true` in the target environment and restart the application. The example remains false. No production configuration has been changed. Startup creates additive `route_studio_*` tables and `daily_direction_checkpoints`; existing tables are preserved. Keep one `BACKGROUND_JOBS_ENABLED=true` worker for daily direction recovery, as for existing provider polling.

An Admin creates a User with role **Tracer**. An Admin or Technician opens **Traced paths**, selects that Tracer and a bus, and assigns them. The Tracer signs in on the onboard phone and explicitly starts recording. The account cannot choose another bus or access another tracer's recordings. It receives no driver or technician permissions.

Use HTTPS and a browser supporting IndexedDB, Geolocation and Web Locks. Keep the page visible and phone unlocked. Browser background operation is not guaranteed; hiding the page stops its watcher and requires explicit recovery. A failed location permission or storage operation stops collection with an error. The existing driver and provider tracking sources are not touched.

The recorder samples about every three seconds and uploads batches every twelve seconds. Samples are stored in IndexedDB before upload; acknowledgment removes only confirmed pending samples. Sequence uniqueness makes retries idempotent. Recover resumes the same server session and local pending queue. Finish refuses incomplete sequences. Discard changes only that recording's status, retaining raw samples. Retention is currently explicit/manual administration; no automatic raw recording purge is configured.

Finished recordings appear as drafts. Admins and technicians can rename paths, add map stops, rename/move/remove/reorder stops, correct the coordinate list, undo/redo, and save a draft. New draft version copies preserve the previous immutable published recording; lineage is recorded in the audit stream. The path is an **unmatched GPS trace**, not a road-matching guarantee. Automated matching, uncertain-segment splitting and stop suggestions from the original broad Route Studio specification are not implemented in this increment.

Only an Admin can deliberately approve/select a traced route or switch back to the original manual route. Selection is transactional and preserves old canonical routes. It rejects a running trip, ambiguous assignment, conflicting target bus, or loss of an assigned passenger stop. Existing stop names/coordinates must match exactly for stop reuse. Resolve any mismatch through reviewed passenger assignments, not nearest-stop guesses. A route switch changes signed pass route claims, so previously issued short-lived QRs no longer match the assignment.

Selected trace geometry is returned to the student map and is reversed for display when the existing trip direction reverses. The Admin Routes view also displays the stored published trace. Actual live vehicle coordinates still come from the existing tracking sources. Manual route editing retains its existing OSRM preview. Published data remains readable when Studio is disabled.

## Daily IST rule

### Tracer map and permission UI

The dedicated Tracer portal uses MapLibre GL JS (pinned 5.6.1) with OpenFreeMap Liberty vector tiles. Other existing tracking screens retain their current maps. The map shows the recorded line, latest phone position, accuracy circle, numbered editable stops, follow-location and whole-path controls. GPS accuracy, sample counts, pending uploads and last-fix time remain visible beside the recording indicator. Map loading failures do not discard GPS samples.

Enable location or Start requests browser geolocation permission after a user action. Enabling location alone previews a fix and does not create a recording. Previously granted permission may not prompt again; denied permission must be changed in browser site settings. HTTPS, WebGL and access to the map CDN/tile host are required for the full experience. Recording remains foreground-only. Resume reconstructs the path from server samples and locally pending samples.

UI verification: all 14 JavaScript test files pass (57 reported checks), including seven Tracer checks for idle behavior, offline storage, acknowledgments, denied permission, location preview and live path/metric updates. Physical-phone and browser visual verification remain outstanding.

The worker checks the server UTC clock every ten seconds and converts it to IST (UTC+05:30). At the first check at or after 00:01 IST, old running trips still in reverse are reset to forward and the first canonical stop. Current coordinates and historical stop events are preserved. Reset metadata prevents pre-boundary observations from replaying the old progression. Fresh points resume normal progression using the existing reset safeguards.

A database checkpoint per bus prevents subsequent checks from overriding legitimate daytime reversals. Restart performs catch-up before provider startup refresh. Trips begun after the applicable daily boundary are not retroactively reset. There are no changes to the terminal reversal function. Worker errors are logged and retried without stopping existing GPS polling.

`GET /api/route-studio/availability` returns server UTC and IST times to authenticated users. Time accuracy depends on the hosting OS clock synchronization. This code does not set OS time or claim an independently verified time source. An offline/stopped worker cannot execute at 00:01; it catches up after restart.

History now provides `round_trips`: an outbound completion followed by a return completion in the same trip and IST date counts as one round trip. Original trip/leg/event responses remain available. The history summary displays round-trip counts without rewriting history.

## Rollback and checks

Set `ENABLE_ROUTE_STUDIO=false` to reject new Studio operations. A running browser recorder stops on its next rejected upload and preserves local pending samples. Published canonical routes are retained. Do not drop new tables. Daily IST recovery is independent of the recording flag and continues as requested. Known exact pre-Studio backup schemas are accepted with empty new tables; unrelated schema mismatches remain rejected.

Source baseline copies are under `.codex-finalizer/route-studio-baseline-20261105`. This workspace has no Git repository. Tests use disposable SQLite databases. PostgreSQL concurrency, physical phone GPS/camera operation, production clock synchronization, full browser visual QA, and sustained load require staging verification. No production deployment or real route assignment was performed by this implementation.

Verification on 2026-11-05: the full Python suite passed 170 tests, followed by an additional passing legacy-backup test (11 Route Studio tests passed together). All 14 JavaScript test files passed, including four recorder tests covering idle behavior, local persistence, offline recovery data and acknowledgment handling. Frontend syntax checks passed. Baseline comparison confirms the terminal reversal implementation in `backend/routes/gps.py` is unchanged.
