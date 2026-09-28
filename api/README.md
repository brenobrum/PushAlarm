# PushAlarm API

A small standalone HTTP service. `POST /alert-alarm` sends the alarm to **every phone that has the app installed**; each phone turns it into an alarm.
Phones register themselves on launch through `POST /devices`, and each phone's push environment (sandbox for Xcode builds, production for TestFlight/App Store) is detected automatically.
It uses Node 20+ and has no dependencies.

## Run

```bash
cp .env.example .env   # fill in the APNs key, team, topic and device token
npm run dev            # or: npm start (reads variables from the environment)
npm test
```

Docker: `docker build -t pushalarm-api . && docker run --env-file .env -p 3000:3000 pushalarm-api`
(when using Docker, put the key contents in `APNS_KEY` rather than a file path, and mount a volume at `/data`).

## POST /alert-alarm

```bash
curl -X POST http://localhost:3000/alert-alarm \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"note": "Server X went down", "date": "2026-09-28T14:30:00Z"}'
```

| Field          | Required | Notes |
| -------------- | -------- | ----- |
| `note`         | yes      | The alarm title on the phone (max 500 characters) |
| `date`         | no       | ISO‑8601. Defaults to now; if it's in the past, the alarm rings right away |
| `id`           | no       | UUID. Sending the same id twice won't create a second alarm |
| `title`        | no       | Banner title (default "New alarm") |
| `deviceTokens` | no       | Only send to these tokens. Defaults to every registered phone plus `APNS_DEVICE_TOKENS` |

Responses: `202` if at least one phone accepted the push, `502` if APNs rejected every token (`failed` lists why; uninstalled apps are dropped automatically),
`400` for invalid input, `401` for a wrong or missing API key.

```json
{ "id": "…", "date": "2026-09-28T14:30:00.000Z", "note": "Server X went down", "sent": 1, "failed": [] }
```

## POST /devices

Called by the app with `{ "token": "<APNs device token>" }`; returns `204`. No API key: only an installed copy of the app can produce a valid token.

`GET /health` returns `{ "ok": true, "devices": <registered count> }`.

Registered devices are saved to `DATA_FILE` (`/data/devices.json` in Docker): mount a volume at `/data`.
