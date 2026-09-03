# Bus Tracker

> Project documentation placeholder. TODO: Keep this document aligned with approved architecture decisions.

## Overview

Bus Tracker is a FastAPI and vanilla-JavaScript fleet-management application for school transport operations. It includes authenticated management, route/bus/driver assignments, student transport assignments, and live trip tracking.

## Technology stack

- **Backend:** FastAPI (Python)
- **Database:** SQLite for development and PostgreSQL for production
- **ORM:** SQLAlchemy
- **Authentication:** JWT with Passlib and python-jose
- **Frontend:** HTML5, CSS3, and Vanilla JavaScript ES Modules
- **Maps and charts:** Leaflet.js and Chart.js (to be integrated when modules are implemented)

## Installation

1. Create and activate a Python virtual environment.
2. Install dependencies with `pip install -r requirements.txt`.
3. For computer-only use, start the application with `python -m uvicorn backend.main:app --reload` from this project directory.
4. Open `http://127.0.0.1:8000/` for the login shell or `http://127.0.0.1:8000/dashboard` for the SPA host.

### Use the app from a phone on your Wi-Fi

Connect the computer and phone to the same trusted Wi-Fi network. In PowerShell,
from this project directory, run:

```powershell
.\start-lan.ps1
```

The helper starts FastAPI on every network interface and prints an address such
as `http://192.168.1.25:8000/`. Open that exact address in the phone browser.
Do not use `localhost` or `127.0.0.1` on the phone: those addresses point to
the phone itself.

If the phone times out, allow the app through Windows Firewall on **Private**
networks (or add an inbound TCP rule for port 8000), then restart the helper.
Avoid exposing this development server on public Wi-Fi; it has no HTTPS and is
intended only for your private local network.

## First administrator and secure sign-in

Before signing in for the first time, create an administrator without placing a password in source code or shell history:

```powershell
python database/init_database.py --username your-admin-name
```

The setup command securely prompts for a 12–72 character password and stores only its bcrypt hash with a unique salt. The login page receives a short-lived JWT in an HttpOnly, SameSite session cookie; the JSON bearer token remains available temporarily for legacy clients. The dashboard verifies the session before it loads, and logout clears the browser cookie.

To rotate an existing administrator password (including an older development account), run:

```powershell
python database/init_database.py --username admin --reset-password
```

If the development SQLite database is deleted, the server will recreate its tables and print the recovery command instead of inventing a known password. Use `admin` as the username or choose another username, then enter a new password at the secure prompt. For a production deployment, set `BOOTSTRAP_ADMIN_PASSWORD` in the server's secret store before the first start; the application will create the configured administrator once and will not print the password.

For production, set `APP_ENV=production`, `DATABASE_URL` to PostgreSQL, and a random `JWT_SECRET_KEY` of at least 32 characters. Configure `BOOTSTRAP_ADMIN_PASSWORD` only through the hosting provider's secret store if a first administrator must be created at startup. See `.env.example`; never commit a real secret or use a default password. For an existing SQLite installation, follow the verified [SQLite-to-PostgreSQL cutover](docs/postgresql-cutover.md) rather than manually copying database files.

### Render deployment

The included `render.yaml` provisions PostgreSQL and has Render generate a persistent 256-bit `JWT_SECRET_KEY` for a **new** Blueprint deployment. For an existing Render service, set `JWT_SECRET_KEY` manually in **Environment** to a random value of at least 32 characters, then redeploy; Render does not overwrite an existing empty secret when a Blueprint is updated. Before the first successful deployment, also set `BOOTSTRAP_ADMIN_PASSWORD` to a unique 12–72 character password in the same Environment page. The first administrator uses username `admin` unless `BOOTSTRAP_ADMIN_USERNAME` is set. Keep both values in Render's secret store and never add them to the repository.

If the first administrator password is lost, set `BOOTSTRAP_ADMIN_RESET_PASSWORD=true` temporarily in Render together with the intended `BOOTSTRAP_ADMIN_USERNAME` and a new `BOOTSTRAP_ADMIN_PASSWORD`, then deploy once. This resets only that existing active administrator's password, ends its existing sessions, and clears login lockout. Remove the reset variable or set it to `false` immediately after the successful deployment so future deployments cannot overwrite a password changed in Settings.

## Security baseline

- Management and identity APIs require server-side JWT authentication and role checks.
- Browser sessions use an HttpOnly, SameSite cookie with a dedicated logout endpoint; bearer headers remain supported during the frontend migration.
- Driver trip actions are restricted to the authenticated driver's own profile and trip.
- Student APIs are restricted to the authenticated student or management staff.
- Request-size limits, per-client API/login/upload rate limits, security headers, HSTS in production, and an enforced browser Content Security Policy are applied by `backend/security.py`.
- Administrative deletion is limited to authenticated administrators. There is intentionally no remote database-wipe endpoint; account removal/revocation is auditable and scoped to an individual account.
- Driver safety feedback is stored in the notifications table and is visible to management with acknowledge, resolve, reopen, and refresh workflows.
- Production startup fails closed if the JWT signing secret is missing or too short. Use a reverse proxy/WAF for distributed rate limiting, TLS termination, backups, and intrusion monitoring.

## GPS provider webhook integration

BusTrack accepts GPS-company webhooks without changing the existing driver-mobile
GPS contract. An administrator first maps each external provider device ID to a
bus, then creates either one service token for the whole fleet or a bus-scoped
token. Tokens never expire automatically and plaintext values are returned only
once to the authorised API caller when they are created or rotated. They are
never returned by the token-list API or persisted in readable form.

1. `POST /api/integrations/gps/devices` with an admin session:

   ```json
   {"bus_id": 12, "external_device_id": "862567072404952", "display_name": "KL07BN4647"}
   ```

2. `POST /api/integrations/gps/tokens` with `{"label":"GPS company"}`. Store
   the returned `token` with the provider. Supplying a `bus_id` makes the token
   valid for that bus only.

3. Ask the provider to `POST` its native JSON to
   `https://YOUR-DOMAIN/api/integrations/gps/ingest`, with
   `X-GPS-Token: <returned token>` and `Content-Type: application/json`.
   A bare object or an array of position objects is accepted. The custom key is
   accepted only in this header on this webhook; it is not a browser login,
   Bearer token, or credential for any read or management API.

The supplied Teltonika payload maps `uniqueId`, `deviceId`, `name`, or `phone`
to the configured device mapping. The latest internal position is visible to
administrators at `/api/integrations/gps/status`; its complete vendor payload is
available per bus at `/api/integrations/gps/status/{bus_id}`. The receiver
expects the provider's 20-second ignition-on updates and two-minute ignition-off
heartbeats. Fresh vehicle GPS and driver-phone GPS are both recorded for an
active trip, so either source can keep the map and route progression current.

Administrators can create a **Technician** account from Users. Technician
accounts have a separate GPS Integration portal; they can rotate or disable
provider credentials, edit external device-to-bus mappings, and update the
allowed JSON field paths when a provider changes its payload layout. They do
not receive general fleet, account, or assignment administration permissions.
The separate **Provider Health** module shows provider contact time and device
fix time independently, reports delayed/offline/error states per bus, and
provides an exact-bus filter over the rolling raw coordinate feed.

See [`docs/mvd-gps-provider-handoff.md`](docs/mvd-gps-provider-handoff.md) for
the exact handoff contract to send to the GPS provider, including the accepted
payload forms, expected response codes, and the final live-delivery check.

## Airotrack pull integration

For Airotrack's `vehicle-live-data` API, configure `AIROTRACK_API_TOKEN` only
in the server/deployment secret store (or a local uncommitted `.env` file) and
restart the API. BusTrack then polls every bus's database **registration
number** every 20 seconds (set `AIROTRACK_POLL_INTERVAL_SECONDS` to change
this; the minimum is 20 seconds). Add all 24 buses normally in Bus Management;
their registration number is the only per-bus Airotrack lookup value. The API
returns the tracker IMEI and BusTrack stores it with the received position.
The translated positions feed the existing Admin and User live-tracking APIs
automatically. A GPS technician can run an immediate authorised refresh with
`POST /api/integrations/gps/airotrack/refresh`.

The vendor's `source_date`, not the time BusTrack polled it, determines whether
a location is fresh. An old last-known point remains visible to management but
is never presented to users as current vehicle movement. If a sleeping service
wakes to an advancing queue of older Airotrack heartbeats, BusTrack performs a
bounded catch-up read and applies only the greatest device timestamp. Set
`AIROTRACK_CATCHUP_MAX_REQUESTS` to tune the maximum (default 8). A production
cold start completes its first provider refresh before serving tracking pages.

A suspended free web service cannot run outbound polling code while suspended.
For uninterrupted collection during that period, configure the provider to
push heartbeats to the webhook endpoint or run the service on an always-on
instance. The cold-start catch-up prevents the saved pre-sleep coordinate from
winning once the service is awake again.

## Folder guide

- `backend/` contains the minimal API entry point, future data/auth placeholders, API route placeholders, shared utilities, and backend assets.
- `frontend/` contains SPA entry documents, common layout and client utilities, and isolated two-file feature modules. Module HTML will be generated in each module's JavaScript file.
- `database/` holds the development SQLite database file and the future initialization script.
- `requirements.txt` lists backend dependencies.

## SPA approach

`frontend/common/router.js` is the single routing seam. It dynamically imports ES-module feature files and safely shows a generic placeholder until each module supplies its own generated HTML. Shared layout components belong in `frontend/common/`; each feature module intentionally contains only one `.js` and one `.css` file.
