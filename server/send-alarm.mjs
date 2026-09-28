// Sends a push that makes PushAlarm create an alarm. No dependencies — Node 18+.
//
//   APNS_KEY_PATH=AuthKey_ABC123.p8 APNS_KEY_ID=ABC123 APNS_TEAM_ID=TEAM123456 \
//   APNS_TOPIC=com.brenobrum.pushalarm \
//   node send-alarm.mjs <deviceToken> "2026-09-28T14:30:00Z" "Server X went down"
//
// Add APNS_PRODUCTION=1 for TestFlight / App Store builds.
import { createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http2 from "node:http2";

const [token, date, ...noteParts] = process.argv.slice(2);
const note = noteParts.join(" ");
if (!token || !date || !note) {
  console.error('Usage: node send-alarm.mjs <deviceToken> <ISO-8601 date | "now"> <note>');
  process.exit(1);
}

const env = (name) => process.env[name] ?? (console.error(`Missing ${name}`), process.exit(1));
const keyPem = readFileSync(env("APNS_KEY_PATH"), "utf8");
const keyId = env("APNS_KEY_ID");
const teamId = env("APNS_TEAM_ID");
const topic = env("APNS_TOPIC");
const host = process.env.APNS_PRODUCTION ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
const signature = createSign("SHA256").update(`${header}.${claims}`).sign({ key: keyPem, dsaEncoding: "ieee-p1363" });
const jwt = `${header}.${claims}.${b64url(signature)}`;

const alarmDate = date === "now" ? new Date() : new Date(date);
if (isNaN(alarmDate)) { console.error(`Invalid date: ${date}`); process.exit(1); }

const payload = {
  aps: {
    alert: { title: "New alarm", body: note },
    sound: "default",
    "mutable-content": 1,    // runs the Notification Service Extension (main path)
    "content-available": 1,  // also wakes the app in the background (backup path)
  },
  alarm: { id: randomUUID(), date: alarmDate.toISOString(), note },
};

const client = http2.connect(host);
const req = client.request({
  ":method": "POST",
  ":path": `/3/device/${token}`,
  authorization: `bearer ${jwt}`,
  "apns-topic": topic,
  "apns-push-type": "alert",
  "apns-priority": "10",
});
req.setEncoding("utf8");
let status, body = "";
req.on("response", (h) => (status = h[":status"]));
req.on("data", (c) => (body += c));
req.on("end", () => {
  console.log(status === 200 ? `Sent ✔ alarm at ${payload.alarm.date}` : `APNs error ${status}: ${body}`);
  client.close();
});
req.end(JSON.stringify(payload));
