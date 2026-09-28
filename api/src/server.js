import { readFileSync } from "node:fs";
import { ApnsClient } from "./apns.js";
import { createApp } from "./app.js";
import { DeviceStore } from "./devices.js";

const keyPem = process.env.APNS_KEY
  ? process.env.APNS_KEY.replace(/\\n/g, "\n")
  : process.env.APNS_KEY_PATH
    ? readFileSync(process.env.APNS_KEY_PATH, "utf8")
    : exit("Set APNS_KEY (the .p8 contents) or APNS_KEY_PATH (path to the .p8 file)");

const config = {
  keyPem,
  keyId: process.env.APNS_KEY_ID ?? exit("Missing environment variable APNS_KEY_ID"),
  teamId: process.env.APNS_TEAM_ID ?? exit("Missing environment variable APNS_TEAM_ID"),
  topic: process.env.APNS_TOPIC ?? exit("Missing environment variable APNS_TOPIC"),
};
const apns = {
  production: new ApnsClient({ ...config, host: "https://api.push.apple.com" }),
  sandbox: new ApnsClient({ ...config, host: "https://api.sandbox.push.apple.com" }),
};

const store = new DeviceStore(process.env.DATA_FILE ?? "./data/devices.json");

const apiKey = process.env.API_KEY;
if (!apiKey) console.warn("API_KEY is not set: /alert-alarm is open to anyone who can reach this server");

const defaultTokens = (process.env.APNS_DEVICE_TOKENS ?? "").split(",").map((t) => t.trim()).filter(Boolean);
const port = Number(process.env.PORT ?? 3000);

createApp({ apns, store, apiKey, defaultTokens }).listen(port, () => {
  console.log(`PushAlarm API listening on :${port} (${store.size} registered devices, data at ${store.file})`);
});

function exit(message) {
  console.error(message);
  process.exit(1);
}
