# Request and caching optimization report

Status: implemented and regression-tested on 2026-09-16.

## Counting rules and assumptions

This report separates application HTTP requests from stream messages and GPS
vendor traffic. One Server-Sent Events connection counts as one HTTP request;
the data messages inside it do not create additional HTTP requests. Static
CSS/JavaScript/images, OpenStreetMap tiles, and OSRM route calls are not API
requests, although they still use bandwidth. Static BusTrack assets now have a
one-hour browser cache and student road geometry has a seven-day browser cache.

The monthly model uses 22 school days. The conservative model assumes 700
students and two Admins keep their portal open for eight hours per school day,
25 drivers use tracking for four hours, and two technicians keep Provider
Health open for eight hours. Login, portal authentication, hourly idle-session
checks, and logout are included. User-triggered create/edit/delete/download and
manual-refresh operations must be added according to actual usage.

## Automatic request policy now in the code

| Area | Normal behavior | Fallback / cache |
|---|---|---|
| Student live tracking | One changed-data stream, 5-second server observation | 5-second GET only while streaming is unavailable |
| Driver GPS-source status | One changed-data stream, 5-second server observation | 5-second GET only while streaming is unavailable |
| Admin fleet tracking | One stream, 10-second server observation | 10-second GET only while streaming is unavailable |
| Admin fleet bus list | Loaded separately | Browser-memory cache for 5 minutes |
| Technician Provider Health | Two GETs every 60 seconds while visible | Stops when the page/tab is hidden |
| Admin Active Users | One GET every 60 seconds while visible | Stops when hidden |
| Admin Notifications | One GET every 60 seconds while visible | Stops when hidden |
| Admin selected Trip History | One GET every 60 seconds while visible | Stops when hidden |
| Student bus pass | Valid signed QR renews before expiry | Missing pass: 60 seconds; failures: exponential 5–60 seconds |
| Session monitor | One GET per hour while visible | Normal API 401s still end revoked sessions immediately |
| Static frontend assets | Normal browser request | `public, max-age=3600, must-revalidate` |
| Student road route | No per-position OSRM request | Route geometry cached for seven days and reused for ETA/motion |
| Successful GET audit rows | 1% sampled in production | Mutations and errors remain 100%; rows retained 30 days |

Student snapshots are single-flight cached per bus/route for 4.5 seconds, so a
simultaneous login wave does not perform the same full route calculation once
per connected student. Admin fleet snapshots are shared per process for 9.5
seconds. Student identity and assigned-stop fields remain per-user and are
never shared. All three streams retain the existing GET payloads and endpoints,
and automatically fall back to polling.

## Exact modeled portal requests

These counts are exact or conservative upper bounds for the assumptions above,
excluding retries caused by network failure and excluding user-triggered actions.

| Portal/use | Per person per day | Users | Monthly HTTP requests |
|---|---:|---:|---:|
| Student, tracking open 2 hours | 9 | 700 | 138,600 |
| Student, tracking open 8 hours (conservative) | 22 | 700 | 338,800 |
| Driver, hardware GPS normal, tracking open 4 hours | 14 | 25 | 7,700 |
| Admin, fleet tracking open 8 hours | 118 | 2 | 5,192 |
| Admin, one 60-second page open 8 hours | 492 | 2 | 21,648 |
| Technician, Provider Health open 8 hours | 973 | 2 | 42,812 |
| Technician, integration dashboard opened once for 8 hours | 18 | 2 | 792 |

The Admin cannot keep multiple SPA modules active at once, so use either its
fleet row or one 60-second-page row, not both for the same browser session.
The technician dashboard now reuses its unfiltered token request when no token
filter is active, reducing its initial load from eight network calls to seven.

Two useful aggregate cases are therefore:

- Typical two-hour student use + hardware GPS + two Provider Health technicians
  + two Admins on a 60-second page: about **210,760 API requests/month**.
- Conservative eight-hour student use with the same other portals: about
  **410,960 API requests/month**.

This leaves about 89,000 action/retry requests before reaching the requested
500,000 API-request ceiling in the conservative model. A 5-second polling-only
fallback is intentionally not included because it runs only while a stream is
unavailable; persistent proxy failure should be treated as an operational
alert.

## GPS-provider traffic: the hard boundary

Provider traffic is separate from browser portal traffic and cannot honestly be
claimed to fit the same 500,000 ceiling in every configuration:

- Kingstrack is a fleet/account request. A continuously running 20-second
  schedule makes about `129,600 × configured account count` outgoing vendor
  requests in a 30-day month, plus process startup/restart refreshes.
- Airotrack is one request per configured bus per cycle. Its baseline is about
  `129,600 × Airotrack bus count` per 30-day month, before startup and bounded stale-data
  catch-up requests. Twenty-five Airotrack buses therefore make at least
  **3,240,000 outgoing requests/month**.
- A phone used as moving-GPS fallback sends at most every 5 seconds. Continuous
  four-hour fallback for all 25 drivers would add 1,584,000 POSTs/month;
  stationary phones are reduced to a 30-second heartbeat. Normal hardware-GPS
  operation creates none of those phone POSTs.

Maintaining 20-second freshness for 25 independently queried Airotrack buses and
also limiting requests to 500,000 is mathematically impossible. The no-
performance-loss solution is a provider fleet batch endpoint, webhook, or
persistent provider stream. Kingstrack already uses the preferred batched
account pattern. Increasing the Airotrack interval would lower calls but would
also lower tracking freshness, so that change was not made silently.

## Container and GCP readiness

The program is containerized. The Dockerfile uses Python 3.12 slim, installs
locked project requirements, runs as the non-root `bustrack` user, exposes the
platform `PORT`, uses one Uvicorn worker, and refuses a production start without
PostgreSQL. The Docker context excludes environment files, keys, SQLite files,
backups, bytecode, and node modules.

For Cloud Run, use the same image as two services:

1. Public web: `BACKGROUND_JOBS_ENABLED=false`, request-based billing, stream
   flags enabled, and a timeout of at least 55 minutes.
2. Private singleton worker: `BACKGROUND_JOBS_ENABLED=true`, minimum/maximum one,
   instance-based billing, and no public browser routing.

This prevents every autoscaled public instance from duplicating provider,
retention, and reminder loops. Current official Cloud Run pricing gives
request-based services 2 million free requests, 180,000 free vCPU-seconds, and
360,000 free GiB-seconds monthly in the us-central1-equivalent free tier. The
request charge itself is therefore expected to remain free under this model;
long-lived streams make active compute time, database, and network egress the
main cost variables. With 1 vCPU/512 MiB and enough concurrency for one public
instance to cover 176 active hours, the simple CPU upper-bound calculation is
about **$10.89/month after the CPU free tier**, before the worker, database, and
egress. Two continuously active public instances would be about **$26.78** by
the same simplified calculation. Actual autoscaling and regional SKU prices
must be measured with Cloud Monitoring and the pricing calculator.

The cheapest current worker alternative is an eligible Free Tier `e2-micro` in
`us-central1`, `us-east1`, or `us-west1`; an attached in-use external IPv4 is
currently $0.005/hour, about **$3.65 for 730 hours**, before database and egress.
This VM should not be described as fully free because IPv4, database, excess
egress, backups, and monitoring can still be charged.

Official references:

- https://cloud.google.com/run/pricing
- https://docs.cloud.google.com/run/docs/about-concurrency
- https://docs.cloud.google.com/free/docs/free-cloud-features
- https://cloud.google.com/vpc/pricing

No GCP resources were created or changed by this implementation.
