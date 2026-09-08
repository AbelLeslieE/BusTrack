# Secure QR bus passes

## Trust boundary

Student and driver browsers are untrusted clients. Only the FastAPI server authenticates a pass, using the database, the authenticated account, and an Ed25519 signature. Editing a displayed status, bus number, browser role, localStorage or IndexedDB cannot authorize travel. Both verification and management APIs enforce roles on the server. SQLAlchemy is the database access boundary; this project has no Firebase client database or security rules.

The existing pass table, student route assignment, trip table, admin modal and portal router are reused. GPS ingestion, stop progression, terminal reversal and reset behavior are unchanged. No actual PWA manifest or installed service worker exists in this repository; the cache-refresh utility only unregisters old workers. Scanning works in supported browsers/PWA containers over HTTPS, with camera permission. Offline verification is deliberately unavailable.

## Deployment setup

1. Install `requirements.txt` in the application's Python environment. Added dependencies are PyJWT 2.13.0, qrcode 8.2 and Pillow 12.3.0; the existing cryptography package supplies Ed25519.
2. Generate a private key on trusted server infrastructure with `python scripts/create_bus_pass_signing_key.py --output <private-directory-outside-repository>/bus-pass-signing.pem`. This refuses existing files and paths inside the repository. Restrict the private directory/file ACL to the operator and application service account on Windows. On Unix the file is created with mode 0600. Do not store it under a web root, shared folder, frontend bundle or in Git.
3. Store the PEM contents in the server secret `BUS_PASS_SIGNING_KEY_PEM`. Actual newlines and literal `\n` are supported. Use a deployment secret manager; do not add it to a public/client environment. Every application worker must use the same key. Keep it separate from the login JWT secret. No production key is generated or configured by this implementation.
4. Start the application normally. Its existing compatibility migration adds `bus_passes.credential_version` with default 1 and creates `pass_identities` and `pass_verifications`. Existing pass IDs, dates, statuses, assignments and tracking records remain intact. Back up the database before deployment. Portable backups automatically include these tables and official photos; the private signing key is not stored in the database or its backups.
5. In Admin → Bus Passes, use **Official photo / identity** to enroll each student's official name, department/course and photograph. Previously issued passes stay in place, but QR issuance fails closed until an official photo is enrolled. Photos are admin-only, image-decoded and re-encoded to JPEG (metadata removed), at most 640 × 640. Self-service profile edits do not change official pass identity.
6. Issue/renew/activate a pass in the existing Manage dialog. Assign students through Students and buses/drivers through Assignments. Manage also supports Suspended, Revoked and Expired. Suspended passes can be restored to Active. Revoked passes cannot be restored. The existing Admin Delete operation remains available for removing/reissuing a record; verification snapshots survive deletion. A signed pass number also prevents an old QR authorizing a recreated record if SQLite reuses its numeric ID.
7. The assigned driver starts/claims the existing active trip and opens **Verify Bus Pass**. A missing, ambiguous, ended or reassigned trip returns `NO_ACTIVE_TRIP`; assignment alone never creates a trip for scanning. A provider trip without driver ownership must be claimed through the existing driver trip workflow first.

Missing or invalid key configuration makes QR issuance/verification return a safe 503. Other tracking functionality continues operating. Keys never appear in HTML, JS, logs, tokens, API responses, public keys delivered to clients, or database records. Rotate a compromised key across all server workers and restart them together; this immediately invalidates outstanding QRs. Normal QRs last only 25 seconds. No previous-key overlap is implemented.

## API and validation

| Endpoint | Authority | Behavior |
| --- | --- | --- |
| `POST /api/students/me/bus-pass/live-token` | User | Empty JSON object only. Resolves the logged-in student's eligible pass and returns a signed token, locally generated PNG QR and server expiry. |
| `POST /api/driver/bus-pass/verify` | Driver | Accepts only `signedToken`. Derives driver, trip, bus, route and direction from database records. Returns the decision and, on success, the official owner photo/identity. |
| `GET/PUT /api/bus-passes/identities/{student_id}` | Admin | Read/enroll the official identity. Photo input is raw base64 of JPEG/PNG/WebP, under 500 KB and 16 megapixels. |
| `GET /api/bus-passes/verifications` | Admin | Filter by result, student ID, bus ID, suspicious flag and older-than cursor; maximum 100 rows per page. |
| Existing `/api/bus-passes` issue/update/delete | Admin | Existing pass management with audit events and credential invalidation. |

Compact JWS uses PyJWT with a fixed EdDSA/Ed25519 key, fixed token type, issuer and audience; it does not accept algorithm/key choices from the QR. Claims include passId, passNumber, studentId, busId, routeId, version, server-issued `iat`/`exp`, and a cryptographically random `jti`. The backend enforces a 25-second lifetime and rejects future timestamps. The client countdown uses server-provided lifetime and a monotonic clock for display only. It refreshes about every 20 seconds, hides expired credentials and clears them when the page is hidden. No QR is stored in browser storage.

After signature verification, the backend checks current pass existence/status/dates, active student account, official identity and active assignment, then matches claims to those records. It checks a single running driver-owned trip, current route/bus/driver assignment and the student's assigned bus/route. Outbound and return trips use the same pass policy, with the real direction included in the result. It never changes a trip while verifying a pass.

Verification results distinguish `QR_EXPIRED`, `PASS_EXPIRED`, `REVOKED`, `SUSPENDED`, `WRONG_BUS`, `WRONG_ROUTE`, `INVALID_SIGNATURE`, `UNKNOWN_PASS`, `NO_ACTIVE_TRIP` and other explicit failures. Server/backend/network failures never authorize a pass. The scanner stops after one decoded QR and requires **Scan next pass**. Pending results from previous scans/pages are invalidated and requests time out. Backgrounding the scanner stops its camera and clears its result.

## Replay, concurrency and identity limits

Successful token consumption is persisted with a unique constraint. Verification and pass/identity edits acquire the same pass row lock on PostgreSQL; SQLite uses `BEGIN IMMEDIATE` before checking eligibility or replay state. Repeating the same still-valid token on the same scanner/trip returns its existing verification ID after checking eligibility again. It does not create another successful log or flag accidental camera duplicates as fraud. Changes to dates/status or identity increment the credential version, preventing old tokens reactivating after suspend/restore.

Successful reuse on a different trip/scanner, and the same student attempting validation on another trip within 90 seconds, return `REPLAY_SUSPECTED`. Legitimate rapid reassignment may therefore need review and a 90-second wait. This is a review signal, not proof of misconduct. Wrong-bus attempts are recorded even when no earlier successful use exists. Logs store actor, pass/student/trip IDs, labels, token ID, time, result and safe reason; never the full QR, secret or photograph. Apply the institution's retention/access policy to these logs and database backups; no automatic verification-log purge is added.

A QR authenticates a credential, not the person holding a phone. The driver must compare the large **official photo** against the boarding person. A shared fresh screenshot can identify its real owner during its 25-second lifetime; cryptography cannot prevent live sharing or borrowing a phone. Optional future passkeys can strengthen token issuance without changing this trust boundary. Offline support would need a separate revocation/assignment freshness policy and public-key verification; no private key belongs on any driver device.

## Verification

Run `python -B -m unittest discover -s tests` and `node --test tests/test_pass_scanner_frontend.mjs tests/test_trip_reset_frontend.mjs`.

The new regression suite covers valid forward/return credentials, official identity independent of self-profile edits, forged/modified QR fields, expiry, status changes, no photo, wrong bus/route, absent/ambiguous/reassigned trips, backend role enforcement and browser field spoofing, replay, retries, concurrent scans/revocation, database reopening, additive migration, safe missing-key errors, scanner timeout/offline behavior and stale response suppression. All fixtures use temporary SQLite databases and generated test-only keys.

Local browser checks include student QR rendering, official identity enrollment, admin verification history, the driver page and decoding an actual backend PNG with the vendored scanner before server verification. Physical camera behavior on Android/iOS/desktop, installed-PWA behavior, PostgreSQL locking under production load and real deployment keys/permissions require deployment testing. No real bus, route, pass or production database was reset or modified during development.

## Library references

- [PyJWT EdDSA usage](https://pyjwt.readthedocs.io/en/stable/usage.html#encoding-decoding-tokens-with-eddsa-ed25519)
- [qrcode generator](https://pypi.org/project/qrcode/)
- [Nimiq QR Scanner](https://github.com/nimiq/qr-scanner): version 1.4.2 is vendored locally with its MIT license and worker. No QR or photograph is sent to a third-party QR service.
