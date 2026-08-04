# Bus Tracker

> Project documentation placeholder. TODO: Keep this document aligned with approved architecture decisions.

## Overview

Bus Tracker is a modular, future-ready foundation for a school or fleet bus tracking application. This repository currently contains only the project scaffold and documented placeholders; no business logic, data models, or API endpoints have been implemented.

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

The setup command securely prompts for a 12–72 character password and stores only its bcrypt hash with a unique salt. The login page exchanges valid credentials for a short-lived JWT, and the dashboard verifies that token before it loads.

For production, set `APP_ENV=production`, `DATABASE_URL` to PostgreSQL, and a long random `JWT_SECRET_KEY`. See `.env.example`; never commit a real secret.

## Folder guide

- `backend/` contains the minimal API entry point, future data/auth placeholders, API route placeholders, shared utilities, and backend assets.
- `frontend/` contains SPA entry documents, common layout and client utilities, and isolated two-file feature modules. Module HTML will be generated in each module's JavaScript file.
- `database/` holds the development SQLite database file and the future initialization script.
- `requirements.txt` lists backend dependencies.

## SPA approach

`frontend/common/router.js` is the single routing seam. It dynamically imports ES-module feature files and safely shows a generic placeholder until each module supplies its own generated HTML. Shared layout components belong in `frontend/common/`; each feature module intentionally contains only one `.js` and one `.css` file.
