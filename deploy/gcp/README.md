# BusTrack on Google Cloud Run

This deployment keeps the application and frontend in one container, stores
state in Cloud SQL for PostgreSQL, and separates public request handling from
the singleton background loops. It does not change route, stop, GPS, or portal
business logic.

## Architecture

- `bustrack-web`: public Cloud Run service, autoscaled, background jobs off.
- `bustrack-worker`: internal Cloud Run service, exactly one continuously
  allocated instance, background jobs on.
- Cloud SQL for PostgreSQL: the only production data store.
- Secret Manager: database URL, JWT secret, bus-pass private key, bootstrap
  administrator password, and optional GPS-provider credentials.
- Cloud Logging/Monitoring: Cloud Run and Cloud SQL platform telemetry.

Cloud Run terminates HTTPS and replaces the VM/Nginx/process-manager portion of
the original checklist. A load balancer/static IP is only needed if the college
or MVD explicitly requires an allow-listed fixed egress/ingress architecture.

## Before deployment

1. Select the project, region, budget, notification contacts, production domain,
   Cloud SQL sizing, and recovery objectives with the college IT owner.
2. Create a Cloud SQL PostgreSQL instance/database/user. Keep the instance
   private where the college network design permits it. The preparation script
   below enables required APIs, creates the `bustrack` Artifact Registry
   repository if absent, and grants its detected Cloud Build service account
   image-push access.
3. Create these Secret Manager secrets and add their values without placing
   plaintext values in Git or command history:

   - `bustrack-database-url`
   - `bustrack-jwt-secret` (at least 32 random characters)
   - `bustrack-bus-pass-signing-key` (the existing Ed25519 private PEM)
   - `bustrack-bootstrap-admin-password` (12-72 characters)

   The Cloud SQL Unix-socket database URL has this form; URL-encode the password:

   `postgresql://USER:PASSWORD@/DATABASE?host=/cloudsql/PROJECT:REGION:INSTANCE`

   Add provider secrets only when staging has passed. Typical optional bindings
   are `AIROTRACK_API_TOKEN=bustrack-airotrack-api-token:1` and
   `KINGSTRACK_ACCOUNTS=bustrack-kingstrack-accounts:1`.

4. Import existing data with a reviewed database migration. Do not point both
   the old host and this worker at live provider credentials simultaneously.
5. Run the complete automated test suite and a PostgreSQL staging smoke test.

## Build and deploy

From the repository root, prepare the project (review first), then build a
uniquely tagged image. Cloud Build runs both backend and browser-module tests
before it builds or pushes the image:

```powershell
./deploy/gcp/prepare-project.ps1 -ProjectId PROJECT_ID -WhatIf
./deploy/gcp/prepare-project.ps1 -ProjectId PROJECT_ID
$tag = (git rev-parse --short HEAD)
gcloud builds submit --config deploy/gcp/cloudbuild.yaml --substitutions "_REGION=asia-south1,_REPOSITORY=bustrack,_IMAGE=bustrack,_TAG=$tag" .
$image = "asia-south1-docker.pkg.dev/PROJECT_ID/bustrack/bustrack:$tag"
```

Review changes first with `-WhatIf`, then deploy:

```powershell
./deploy/gcp/deploy-cloud-run.ps1 -ProjectId PROJECT_ID -Image $image -CloudSqlInstance "PROJECT_ID:asia-south1:INSTANCE" -WhatIf
./deploy/gcp/deploy-cloud-run.ps1 -ProjectId PROJECT_ID -Image $image -CloudSqlInstance "PROJECT_ID:asia-south1:INSTANCE"
```

The script pins required secrets to version 1 by default. When a secret is
rotated, pass the corresponding `-...SecretVersion` parameter explicitly and
redeploy; it never binds a production service to the mutable `latest` alias.

Enable protected backups and point-in-time recovery:

```powershell
./deploy/gcp/configure-cloud-sql.ps1 -ProjectId PROJECT_ID -Instance INSTANCE -WhatIf
./deploy/gcp/configure-cloud-sql.ps1 -ProjectId PROJECT_ID -Instance INSTANCE
```

The runtime service account receives only Cloud SQL client, log writer,
monitoring writer, and per-secret accessor roles. Human IAM, billing roles, and
DNS permissions remain an IT-owner decision.

## Cutover verification

Run the read-only checks against the generated Cloud Run URL:

```powershell
./deploy/gcp/verify-deployment.ps1 -BaseUrl "https://SERVICE_URL"
```

Then verify with staging accounts:

- Admin, Driver, and Student login/logout, expiry, disabled users, and RBAC.
- Bus/route/stop assignments, outbound and return directions, Reset All, direct
  arrival at a later stop after reset, terminal handling, ETA, and notifications.
- GPS authentication, invalid/duplicate/stale/future payloads, unknown devices,
  retry behavior, and provider-health display.
- Student/admin live streams and their polling fallbacks.
- Bus-pass scanning over the final HTTPS domain and document download/reminders.
- Representative concurrent GPS writes and portal reads against PostgreSQL.

Map the final domain only after these checks pass. Cloud Run provides managed
TLS; follow the DNS records shown by the selected domain-mapping or external
load-balancer workflow. Give MVD the domain endpoint rather than a temporary
service URL whenever possible.

## Monitoring, backup, and recovery

Create an HTTPS uptime check for `/health` and alert on failure. Also create
alerts for Cloud Run 5xx rate and latency, instance saturation, and Cloud SQL
CPU, connections, disk utilization, and storage growth. Configure a billing
budget with email/Pub/Sub notifications; a budget alert is not a hard spending
cap.

Backups are not considered complete until a restore drill succeeds. Restore the
latest backup into a separate Cloud SQL instance, bind a staging revision to its
database URL, run this verifier and the route/GPS checks, record the recovery
time, and delete the drill resources only after sign-off.

For rollback, route traffic back to the preceding healthy Cloud Run revision.
Never roll application code back across an incompatible database change without
a reviewed data rollback plan. This repository currently uses idempotent startup
compatibility migrations rather than Alembic; introducing versioned migrations
is still recommended before complex future schema changes.

## Items that source code cannot complete

The production domain/DNS, college IAM and 2FA, firewall/source-IP policy, Cloud
SQL sizing/HA choice, notification channels, billing limit, live data migration,
MVD payload contract, and MVD end-to-end test require the relevant owners and
credentials. Do not mark those checklist items complete until they are verified
in the target project.
