# BusTrack GCP and route-readiness report

Audit date: 2026-09-22

## Executive result

The repository is prepared for a staged Google Cloud Run + Cloud SQL deployment.
It is not accurate to call the production system live-ready until the target GCP
resources, secrets, domain, monitoring contacts, live database migration, and MVD
acceptance test have been completed by their owners.

The route-reset defect was confirmed and fixed. Previously, **Reset All** put an
active route at its first outbound stop and only a fresh GPS point inside that
first stop could clear the reset gate. A valid fresh point at Stop 2 or later was
ignored for progression. Now the first fresh post-reset point at the selected
first stop **or any later stop in the selected direction** resumes progression;
bypassed stops are recorded as skipped. Replay, stale, future, off-route, and
backward observations remain blocked.

## What Reset All resets

Reset All is intentionally a tracking reset, not a database/fleet reset.

It resets or removes:

- retained raw provider positions, current per-bus GPS state, provider-health
  state, and live coordinate rows;
- coordinate fields from retained stop events;
- active trips to outbound, first-stop/Approaching state with a new reset
  version and timestamp;
- obsolete duplicate running sessions, which are stopped; and
- a missing running trip, which is created for an active route when possible.

It preserves:

- buses, users, drivers, students, routes, stops, route-stop ordering, and
  assignments;
- trip and stop-event history apart from intentionally cleared coordinates;
- the actual next GPS point, which becomes authoritative only when it is newer
  than the reset boundary; and
- an idempotency record and per-bus watermark so repeating the request or
  replaying the last vendor packet cannot undo the reset.

Routes with no stops are reported and cannot be reset into valid progression.

## Checklist status

| Area | Repository status | Remaining production action |
|---|---|---|
| Production configuration | Implemented: early `.env` load for local use, production mode, secure cookies/headers, hidden API docs, same-origin frontend, narrow Postman CORS, one container command | Set reviewed target-project values |
| Secrets | No tracked `.env`/keys; Secret Manager bindings and least-privilege runtime service account scripted | Create secrets, versions, owners, and rotation process |
| Health/error handling | `/health` liveness and `/ready` database/restore readiness added; failures return 503 without exception text; operational failures use server logging | Create uptime/5xx/latency alerts and notification channels |
| Production database | PostgreSQL driver, pooling, indexes, retention, and production SQLite rejection implemented | Create/size Cloud SQL, migrate data, and run PostgreSQL concurrency/load tests |
| Schema startup | Existing idempotent compatibility upgrades retained; PostgreSQL advisory lock now serializes multi-instance startup | Adopt versioned migrations (for example Alembic) before complex future schema changes |
| Destructive reset safety | `RESET_DATABASE=true` is rejected in production | Keep break-glass restore/migration access restricted |
| Container/runtime | Python 3.12, non-root user, SIGTERM, one Uvicorn worker, proxy headers, port 8080, Cloud Run probes | Build/push the immutable image and review vulnerability results |
| Static/frontend | Served by FastAPI with bounded asset caching; API calls are relative rather than localhost-bound | Verify final HTTPS domain and camera/browser permissions |
| Cloud deployment | API/registry preparation, test-gated Cloud Build, Cloud Run web/worker split, Cloud SQL connector, Secret Manager/IAM, and verifier scripts added | Execute in the approved project after cost review |
| Background jobs | Public service disables loops; internal min/max-one worker owns polling, retention, and reminders | Observe one rolling deployment; a distributed renewable lease remains a future hardening item for zero-overlap guarantees |
| Backups/recovery | Script enables automated backups, PITR, storage auto-growth, deletion protection, retained/final backups | Run and record a real restore drill into a separate instance |
| HTTPS/domain/network | Cloud Run managed HTTPS architecture documented | College IT must choose domain/DNS, ingress/WAF/static-IP policy, firewall/source-IP rules |
| Monitoring/cost | Required metrics, uptime check, alerts, and budget controls documented | Create notification channels, alert policies, and billing budget in GCP |
| GPS/MVD | Token hashing, payload validation, device mapping, dedupe/order/freshness/quarantine, rate limits, provider health, and handoff contract exist | Confirm actual MVD payload, source IPs, retries, frequency, identifier/time format, and run live acceptance test |
| Authentication/security | Password hashing, JWT expiry/issuer/audience, HttpOnly secure cookie, session revocation, RBAC, lockout, request limits, audit data, CSP/HSTS | Perform an independent security review and project IAM/2FA review |
| Route system | Reset/later-stop bug fixed; forward/reverse, shortcut/skipped stops, terminal behavior, stale ordering, phone/provider races covered by regression tests | Perform a physical route/MVD staging drive before cutover |
| CSS/browser behavior | Existing module tests pass and no deployment change alters layout/styles | Do final visual QA on supported phones/browsers; automated tests cannot prove every viewport |

## Files added or hardened

- `backend/main.py`: correct configuration load order, production validation,
  operational logging, liveness and readiness endpoints.
- `backend/database.py`: production PostgreSQL/reset guard and serialized schema
  initialization.
- `Dockerfile`: graceful stop and managed-proxy support.
- `deploy/gcp/prepare-project.ps1`: guarded API enablement, registry creation,
  and Cloud Build image-push permission.
- `deploy/gcp/cloudbuild.yaml`: backend/browser-test-gated, reproducible Artifact
  Registry image build.
- `deploy/gcp/deploy-cloud-run.ps1`: guarded APIs/IAM/secrets/Cloud SQL/web/worker
  deployment with health probes.
- `deploy/gcp/configure-cloud-sql.ps1`: backups, PITR, storage growth, deletion
  protection, and final-backup policy.
- `deploy/gcp/verify-deployment.ps1`: read-only checks for health, readiness,
  production docs exposure, landing page, and unauthenticated API denial.
- `deploy/gcp/README.md`: staging, cutover, monitoring, recovery, and rollback
  runbook.

## Deployment decision

Proceed to **staging** after GCP credentials and resources exist. Do not switch
the live domain or provider polling token merely because the container deploys.
Production cutover should occur only after PostgreSQL data verification, the
read-only verifier, role/route/GPS checks, representative concurrency testing,
a backup restore drill, alert delivery, and a documented rollback all pass.

## Verification performed

- Backend: 138 tests passed, including production guards/readiness plus reset,
  direction, shortcut, terminal, stale-GPS, provider, and route integrity cases.
- Frontend: 26 browser-module tests passed, including reset dialogs, Student and
  Driver waiting state, provider health, authentication, scanner, and request
  behavior.
- Every frontend JavaScript file passed `node --check`.
- All deployment PowerShell files passed the PowerShell parser.
- Python compile checks, dependency consistency, YAML parsing, and
  `git diff --check` passed.
- A real Uvicorn lifecycle smoke test returned HTTP 200 from `/`, `/health`,
  and database-backed `/ready`.
- No secret `.env`, private key/PEM, or database file is tracked by Git.

Docker and the Google Cloud CLI are not installed in this audit environment, so
the container build and target-project commands are deliberately delegated to
the test-gated Cloud Build/deployment workflow rather than reported as already
executed.
