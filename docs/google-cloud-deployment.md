# Google Cloud deployment preparation

The Dockerfile runs the existing FastAPI app and static frontend together. It
uses Python 3.12, a non-root account, the platform-provided PORT, and one Uvicorn
worker. It refuses to start without PostgreSQL configuration. The Docker build
context excludes local environment files, signing keys, SQLite data and backups.

## Information needed before provisioning

The user supplied project ID `project-8fcb2301-4b8b-47c6-bbd` and confirmed
billing is linked. Console access was verified on 2026-09-09; the display name is
currently `My First Project`. The console reports that the free trial requires
a prepayment, or up to 24 hours to credit an already completed payment. The user
must complete any payment themselves. No resources have been provisioned.
The user accepts a mostly-free approach, with Free Tier usage maximized. A total
monthly spending limit has not been specified.

Compute Engine's eligible e2-micro allowance is a candidate for the existing
background poller, but it does not make the complete deployment free. An in-use
external IPv4 address currently costs $0.005/hour (only one free hour per month),
approximately $3.65 for a 730-hour month before other charges. Database hosting,
storage and network traffic must also be assessed before choosing this approach.
The Cloud Run configuration below is a technical reference, not an approved
deployment plan under this cost constraint.

## Preferred mostly-free configuration

- One non-preemptible `e2-micro` VM in `us-central1`, subject to account-wide
  Free Tier availability, with up to 30 GB `pd-standard` disk (not balanced/SSD).
- One application worker, continuously running, with automatic process restart.
- Reuse the existing PostgreSQL service initially, after verifying external
  connectivity, its ongoing cost, and latency. Do not provision Cloud SQL.
- One public IPv4 address; HTTPS termination on the VM. Determine the hostname
  before production cutover, since camera scanning requires a secure context.
- Avoid a load balancer, Cloud NAT, and additional always-running instances.
- Check network egress, database cost, and memory under representative traffic
  before claiming a monthly total or moving production. The 1 GB/month outbound
  allowance is limited; a frequently refreshed student portal can exceed it.
- Configure cost monitoring before production. An alerts-only budget is not a
  spending cap. Do not automatically shut off live tracking without an agreed
  operational policy.

The approximately $3.65/month IPv4 cost is only a baseline, not an all-inclusive
estimate. Verify Free Tier eligibility and the remaining costs in the console.

- The Google Cloud **Project ID**, not just its display name, and enabled billing.
- Agreed hosting region and running-cost budget.
- Confirm the current production database provider, connection accessibility and
  whether it should remain there or be migrated separately.
- Authenticated access to the intended Google Cloud project.

## Cloud Run configuration to review

The app polls its GPS provider from an in-process background task. Use
instance-based billing (CPU allocated outside HTTP requests) and at least one
minimum instance. Default scale-to-zero/request-only settings do not suit this
background loop. Initially use one worker and a maximum of one instance to limit
duplicate provider polling. Instance replacements/revision overlap can still
briefly run two pollers; this is not a distributed singleton guarantee.

This always-running setup incurs charges. Review the actual region-specific cost
before creating resources. Platform restarts remain possible.

Keep PostgreSQL on durable hosting; do not copy the local development SQLite
database into the image. Keep existing bus IDs, route assignments and trip data.
If moving the database to Cloud SQL, plan and verify that migration separately.

Store production secrets in Secret Manager, grant the service identity access
only to the required secrets, and reference explicit secret versions. Preserve
the current JWT secret and bus-pass signing key rather than generating replacements.
Required settings include DATABASE_URL, JWT_SECRET_KEY and BUS_PASS_SIGNING_KEY_PEM;
copy the current GPS-provider and operational settings deliberately. Do not put
secret values in source files, build arguments or command history.

## Staged migration

1. Build the container and test against an isolated PostgreSQL database first.
2. Review the project, costs, service identity and secret bindings before deploy.
3. Test the Google Cloud service using staging data and no live GPS provider token.
4. Plan a controlled production cutover. Do not enable two production GPS polling
   loops unintentionally while Render and Google Cloud overlap.
5. Check authentication, student tracking, driver scanning/camera permissions,
   document downloads, reminders and stop/direction progression on the new URL.
6. Change any provider webhook destination only as part of the agreed cutover.
7. Retire Render only after verification and a rollback plan are in place.

Preparation alone does not provision resources, deploy an image or migrate data.

References:
- https://docs.cloud.google.com/free/docs/free-cloud-features
- https://cloud.google.com/vpc/network-pricing
- https://docs.cloud.google.com/run/docs/configuring/billing-settings
- https://docs.cloud.google.com/run/docs/configuring/min-instances
- https://docs.cloud.google.com/run/docs/container-contract
