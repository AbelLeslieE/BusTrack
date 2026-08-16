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
3. Start the application with `uvicorn backend.main:app --reload` from this project directory.
4. Open `http://127.0.0.1:8000/` for the login shell or `http://127.0.0.1:8000/dashboard` for the SPA host.

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

For production, set `APP_ENV=production`, `DATABASE_URL` to PostgreSQL, and a random `JWT_SECRET_KEY` of at least 32 characters. Configure `BOOTSTRAP_ADMIN_PASSWORD` only through the hosting provider's secret store if a first administrator must be created at startup. See `.env.example`; never commit a real secret or use a default password.

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

## Folder guide

- `backend/` contains the minimal API entry point, future data/auth placeholders, API route placeholders, shared utilities, and backend assets.
- `frontend/` contains SPA entry documents, common layout and client utilities, and isolated two-file feature modules. Module HTML will be generated in each module's JavaScript file.
- `database/` holds the development SQLite database file and the future initialization script.
- `requirements.txt` lists backend dependencies.

## SPA approach

`frontend/common/router.js` is the single routing seam. It dynamically imports ES-module feature files and safely shows a generic placeholder until each module supplies its own generated HTML. Shared layout components belong in `frontend/common/`; each feature module intentionally contains only one `.js` and one `.css` file.
