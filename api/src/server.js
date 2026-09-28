import { readFileSync } from "node:fs";
import { ApnsClient } from "./apns.js";
import { createApp } from "./app.js";

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const keyPem = process.env.APNS_KEY
  ? process.env.APNS_KEY.replace(/\\n/g, "\n")
  : readFileSync(required("APNS_KEY_PATH"), "utf8");

const apns = new ApnsClient({
  keyPem,
  keyId: required("APNS_KEY_ID"),
  teamId: required("APNS_TEAM_ID"),
  topic: required("APNS_TOPIC"),
  host:
    process.env.APNS_HOST ??
    (process.env.APNS_PRODUCTION === "1" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com"),
});

const apiKey = process.env.API_KEY;
if (!apiKey) console.warn("API_KEY is not set: /alert-alarm is open to anyone who can reach this server");

const defaultTokens = (process.env.APNS_DEVICE_TOKENS ?? "").split(",").map((t) => t.trim()).filter(Boolean);
const port = Number(process.env.PORT ?? 3000);

createApp({ apns, apiKey, defaultTokens }).listen(port, () => {
  console.log(`PushAlarm API listening on :${port} (${apns.host})`);
});
