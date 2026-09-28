# PushAlarm

iOS app (iOS 26+) plus a small HTTP API ([`api/`](api/README.md)). The app turns a push notification into a real alarm using **AlarmKit**.
The alarm rings at the time in the push, even in silent mode and Focus, and shows your note as its title.

## How it works

```
Your server ──APNs──▶ iPhone
                       ├─ NotificationService extension (runs even if the app is closed)
                       │     → AlarmManager.schedule(.fixed(date), title: note)
                       └─ App (backup: silent-push wake, notification tap, app open)
                             → same scheduling; duplicates are skipped by alarm id
```

Push payload:

```json
{
  "aps": { "alert": { "title": "New alarm", "body": "Server X went down" },
           "sound": "default", "mutable-content": 1, "content-available": 1 },
  "alarm": { "id": "<uuid>", "date": "2026-09-28T14:30:00Z", "note": "Server X went down" }
}
```

* `date`: ISO‑8601. If it's missing or already in the past, the alarm rings about 5 seconds later.
* `id`: optional. Resending the same id doesn't create a second alarm.

## Setup

1. `brew install xcodegen && xcodegen generate`, then open `PushAlarm.xcodeproj`.
2. Set your Team ID in `project.yml` (`DEVELOPMENT_TEAM`), or in Signing & Capabilities for both targets.
3. The bundle ID is `com.brenobrum.pushalarm`, with the App Group `group.com.brenobrum.pushalarm`. Xcode's automatic signing
   registers both the first time you run the app on a device.
4. Run the app on an iPhone with iOS 26+. Tap the red bell and allow alarms and notifications; it turns blue when ready. Long-press the bell → **Copy device token**.
5. In the Apple Developer portal, create an APNs key (.p8). Then send a push:

```bash
APNS_KEY_PATH=AuthKey_XXXX.p8 APNS_KEY_ID=XXXX APNS_TEAM_ID=YYYY APNS_TOPIC=com.brenobrum.pushalarm \
node server/send-alarm.mjs <deviceToken> 2026-09-28T14:30:00Z "Server X went down"
```

Simulator (no server needed): `xcrun simctl push booted com.brenobrum.pushalarm server/simulator-test.apns`

## Limitations

* AlarmKit alarms belong to this app. They ring like Clock alarms, but they don't show up in Apple's Clock app list.
  No public API can write into the Clock app.
* The simulator doesn't run notification service extensions for `simctl push`, and it doesn't show the full-screen alarm.
  Test the whole flow on a real device.
