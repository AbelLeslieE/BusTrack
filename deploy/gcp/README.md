# BusTrack on Google Cloud Run

This deployment keeps the application and frontend in one container, stores
state in Neon PostgreSQL, and separates public request handling from
the singleton background loops. It does not change route, stop, GPS, or portal
business logic.

## Architecture

- `bustrack-web`: public Cloud Run service, autoscaled, background jobs off.
- `bustrack-worker`: internal Cloud Run service, exactly one continuously
  allocated instance, background jobs on.
- Neon PostgreSQL: the only production data store.
- Secret Manager: database URL, JWT secret, bus-pass private key, bootstrap
  administrator password, and optional GPS-provider credentials.
- Cloud Logging/Monitoring: Cloud Run platform telemetry; Neon provides its own
  database monitoring and backups.

Cloud Run terminates HTTPS and replaces the VM/Nginx/process-manager portion of
the original checklist. A load balancer/static IP is only needed if the college
or MVD explicitly requires an allow-listed fixed egress/ingress architecture.

## Run the complete stack locally in containers

The root `compose.yaml` runs the same application image as separate web and
background-worker services, plus a persistent PostgreSQL 16 container. The
database is reachable only inside the Compose network; the web service binds
to `127.0.0.1:8080` by default. This local HTTP stack uses `APP_ENV=development`
so browser sign-in works across browsers; Cloud Run uses `APP_ENV=production`
behind HTTPS. Docker Compose and the Python dependencies in
`requirements.txt` are required for this local check.

```powershell
python -m pip install -r requirements.txt
python scripts/create_compose_env.py
docker compose --env-file compose.env up --build -d
docker compose --env-file compose.env ps
```

Open `http://127.0.0.1:8080/`. The generated administrator password is in the
ignored `compose.env` file. The same file also holds the local database, JWT,
and bus-pass signing secrets. Keep it private and retain it with the named
PostgreSQL volume; replacing the JWT or signing key invalidates existing
sessions or passes. `docker compose --env-file compose.env down` stops the
stack while retaining the database volume. The local secrets are not uploaded
to GCP; create separate Secret Manager values for the target project.

## Before deployment

1. Select the project, region, budget, notification contacts, production domain,
   Neon plan, and recovery objectives with the college IT owner.
2. Create a Neon PostgreSQL database and store its connection string in the
   `bustrack-database-url` Secret Manager secret. Use Neon’s **direct**
   connection string with `sslmode=require`; startup compatibility migrations
   use a session-level PostgreSQL advisory lock, which is not safe through
   Neon’s transaction pooler. Do not put the URL in GitHub
   variables or source files. Cloud Run uses its normal outbound internet path,
   so no Cloud SQL attachment or VPC connector is required for Neon.
   The preparation script below enables required APIs, creates the `bustrack`
   Artifact Registry repository if absent, and grants its detected Cloud Build
   service account image-push access.
3. Create these Secret Manager secrets and add their values without placing
   plaintext values in Git or command history:

   - `bustrack-database-url`
   - `bustrack-jwt-secret` (at least 32 random characters)
   - `bustrack-bus-pass-signing-key` (the existing Ed25519 private PEM)
   - `bustrack-bootstrap-admin-password` (12-72 characters)

   Confirm the Neon connection string includes `sslmode=require` and URL-encode
   any special characters in the database password.

   Add provider secrets only when staging has passed. Typical optional bindings
   are `AIROTRACK_API_TOKEN=bustrack-airotrack-api-token:1` and
   `KINGSTRACK_ACCOUNTS=bustrack-kingstrack-accounts:1`.

4. Import existing data with a reviewed database migration. Do not point both
   the old host and this worker at live provider credentials simultaneously.
5. Run the complete automated test suite and a PostgreSQL staging smoke test.

## Build and deploy

### GitHub Actions deployment

The repository includes `.github/workflows/deploy-cloud-run.yml`. After the
one-time Google Cloud and GitHub setup below, every push to `main` will:

1. run the backend and browser-module tests in Cloud Build;
2. build and push an immutable commit-tagged image to Artifact Registry; and
3. deploy the public `bustrack-web` service and the singleton
   `bustrack-worker` service.

The workflow uses GitHub OIDC + Google Workload Identity Federation. Do not
store a long-lived service-account JSON key in GitHub.

Create a deployer service account with `roles/run.admin`,
`roles/cloudbuild.builds.editor`, and
`roles/serviceusage.serviceUsageConsumer` on the project. Grant it
`roles/iam.serviceAccountUser` on the runtime service account,
`roles/artifactregistry.reader` on the image repository, and
`roles/storage.objectCreator`, `roles/storage.objectViewer`, and
`roles/storage.bucketViewer` on the Cloud Build source bucket. Configure a
Workload Identity Provider restricted to this repository's immutable ID and
the `main` branch, then grant its principal set `roles/iam.workloadIdentityUser`
on the deployer service account.

Add these GitHub Actions **Variables** to the `production` environment:

- `GCP_PROJECT_ID` — Google Cloud project ID
- `GCP_REGION` — for example `asia-south1`
- `GCP_WORKLOAD_IDENTITY_PROVIDER` — full provider resource name
- `GCP_DEPLOYER_SERVICE_ACCOUNT` — deployer service-account email
- `GCP_ARTIFACT_REPOSITORY` — for example `bustrack`
- `GCP_IMAGE_NAME` — for example `bustrack`
- `GCP_DATABASE_SECRET`, `GCP_JWT_SECRET`, `GCP_BUS_PASS_SECRET`,
  `GCP_BOOTSTRAP_ADMIN_SECRET` — Secret Manager secret names

Optional provider credentials remain configured as Secret Manager bindings;
set `GCP_OPTIONAL_SECRET_BINDINGS` as an environment variable using the format
`ENVIRONMENT_VARIABLE=secret-name:version`, separated by commas.

Run the one-time project preparation and secret/IAM setup locally with the
commands below before the first GitHub push. The workflow intentionally passes
`-SkipProjectSetup` because routine deployments should not mutate project IAM.

From the repository root, prepare the project (review first), then build a
uniquely tagged image. Cloud Build runs both backend and browser-module tests
before it builds or pushes the image. Commit the intended source first so the
image tag accurately identifies its contents:

```powershell
./deploy/gcp/prepare-project.ps1 -ProjectId PROJECT_ID -WhatIf
./deploy/gcp/prepare-project.ps1 -ProjectId PROJECT_ID
if (git status --porcelain) { throw "Commit the source before building the image." }
$tag = (git rev-parse --short HEAD)
gcloud builds submit --region asia-south1 --config deploy/gcp/cloudbuild.yaml --substitutions "_REGION=asia-south1,_REPOSITORY=bustrack,_IMAGE=bustrack,_TAG=$tag" .
$image = "asia-south1-docker.pkg.dev/PROJECT_ID/bustrack/bustrack:$tag"
```

Review changes first with `-WhatIf`, then deploy:

```powershell
./deploy/gcp/deploy-cloud-run.ps1 -ProjectId PROJECT_ID -Image $image -ExternalDatabase -WhatIf
./deploy/gcp/deploy-cloud-run.ps1 -ProjectId PROJECT_ID -Image $image -ExternalDatabase
```

The script pins required secrets to version 1 by default. When a secret is
rotated, pass the corresponding `-...SecretVersion` parameter explicitly and
redeploy; it never binds a production service to the mutable `latest` alias.
Both Cloud Run services use second-generation execution and instance-based CPU
allocation for their health probes. The worker keeps one instance running, so
review its continuous compute cost before deployment; the web service may
scale to zero with the default `WebMinInstances=0`.

Neon’s backup, branching, retention, and point-in-time recovery settings must
be configured in the Neon project. The runtime service account receives only
log-writer, monitoring-writer, and per-secret accessor roles when
`-ExternalDatabase` is used. Human IAM, billing roles, and DNS permissions
remain an IT-owner decision.

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
alerts for Cloud Run 5xx rate, latency, and instance saturation, and configure
Neon alerts for database health, connections, compute, and storage. Configure
a billing budget with email/Pub/Sub notifications; a budget alert is not a hard
spending cap.

Backups are not considered complete until a restore drill succeeds. Restore a
Neon branch or backup into an isolated staging database, bind a staging
revision to its database URL, run this verifier and the route/GPS checks,
record the recovery time, and delete the drill resources only after sign-off.

For rollback, route traffic back to the preceding healthy Cloud Run revision.
Never roll application code back across an incompatible database change without
a reviewed data rollback plan. This repository currently uses idempotent startup
compatibility migrations rather than Alembic; introducing versioned migrations
is still recommended before complex future schema changes.

## Items that source code cannot complete

The production domain/DNS, college IAM and 2FA, firewall/source-IP policy,
Neon plan and recovery settings, notification channels, billing limit, live data migration,
MVD payload contract, and MVD end-to-end test require the relevant owners and
credentials. Do not mark those checklist items complete until they are verified
in the target project.
