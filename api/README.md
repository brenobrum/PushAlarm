# PushAlarm API

A small standalone HTTP service. `POST /alert-alarm` sends a push to the PushAlarm iOS app, and the app turns it into an alarm.
It uses Node 20+ and has no dependencies.

## Run

```bash
cp .env.example .env   # fill in the APNs key, team, topic and device token
npm run dev            # or: npm start (reads variables from the environment)
npm test
```

Docker: `docker build -t pushalarm-api . && docker run --env-file .env -p 3000:3000 pushalarm-api`
(when using Docker, put the key contents in `APNS_KEY` rather than a file path).

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
| `deviceTokens` | no       | Array of tokens. Defaults to `APNS_DEVICE_TOKENS` |

Responses: `202` if at least one phone accepted the push, `502` if APNs rejected every token (`failed` lists why),
`400` for invalid input, `401` for a wrong or missing API key.

```json
{ "id": "…", "date": "2026-09-28T14:30:00.000Z", "note": "Server X went down", "sent": 1, "failed": [] }
```

`GET /health` returns `{ "ok": true }`.
