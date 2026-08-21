# BusTrack GPS provider handoff

This is the BusTrack receiving contract to give to the MVD/GPS company. It is
not a replacement for their official device/API documentation; their team must
confirm that their system can make this request and send one real test position.

## Delivery target

Replace `YOUR-BUSTRACK-DOMAIN` with the publicly reachable production domain:

```text
POST https://YOUR-BUSTRACK-DOMAIN/api/integrations/gps/ingest
Content-Type: application/json
X-GPS-Token: <provider-token>
```

`X-GPS-Token` is a service-to-service credential only. It cannot log a user in,
read tracking data, or access technician/admin APIs. Do not send it as a query
parameter, cookie, or `Authorization: Bearer` header.

Each provider token is permanent until a Technician deletes, disables, or
rotates it. On rotation, the old value is invalid immediately. The replacement
value is returned once in the authorised `POST /api/integrations/gps/tokens/{id}/rotate`
response and must be transferred to MVD through an approved secure channel.

## Accepted JSON body

BusTrack accepts one native position object, an array of position objects, or an
object containing a `data` or `positions` array. The Teltonika-compatible
example below can be sent without renaming fields:

```json
{
  "uniqueId": "862567072404952",
  "deviceId": 44842,
  "latitude": 10.4929336,
  "longitude": 76.257856,
  "speed": 29.0,
  "course": 2.0,
  "altitude": 22.0,
  "accuracy": 0.0,
  "fixTime": "2026-08-17T11:36:32.000+00:00",
  "deviceTime": "2026-08-17T11:36:32.000+00:00",
  "serverTime": "2026-08-17T11:36:34.000+00:00",
  "status": "RUNNING",
  "valid": true,
  "protocol": "teltonika",
  "attributes": {
    "ignition": true,
    "motion": true,
    "sat": 32,
    "odometer": 1826139,
    "totalDistance": 1895647.03,
    "distanceForday": 45837.29,
    "hoursForday": 5305000,
    "idlehoursForday": 2520000,
    "stophoursforday": 53755000
  }
}
```

Before sending data, a Technician maps the provider identifier (normally
`uniqueId`) to the exact BusTrack bus. BusTrack keeps the original provider
payload for audit and translates the position into its own tracking format.
Technicians can update the configured JSON field paths if MVD changes its
payload format.

## Expected frequency and responses

- Ignition on: send a position every 20 seconds.
- Ignition off: send a heartbeat/position every 2 minutes.
- `200`: position(s) accepted and translated.
- `401`: missing, invalid, disabled, or rotated token. Stop and request the
  current token from the authorised BusTrack contact.
- `404`: provider device ID has not been mapped to a BusTrack bus.
- `422`: payload is malformed or lacks valid latitude/longitude.
- `429`: retry with backoff; do not burst resend requests.

Fresh valid vehicle GPS and driver-phone GPS are both recorded for an active
trip. Either source can keep the map and route progression current if the
other device temporarily has no reading.

## Final MVD confirmation checklist

1. MVD confirms the exact outbound URL and `X-GPS-Token` header are configured
   in its production system.
2. MVD sends a real position for each mapped device ID.
3. A Technician verifies the mapped bus appears as fresh in the GPS Integration
   portal and that its latest timestamp, ignition state, and coordinates are
   correct.
4. A student/admin live-tracking view confirms the vehicle source appears on
   the map.

Items 1–4 require the MVD company and a publicly reachable deployed BusTrack
server; they cannot be completed solely from local source code.
