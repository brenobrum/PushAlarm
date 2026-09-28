import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ApnsClient } from "./apns.js";

const MAX_BODY = 16 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{64,200}$/i;
// APNs answers these when a token doesn't belong to the environment we tried.
const WRONG_ENV = new Set(["BadDeviceToken", "DeviceTokenNotForTopic"]);

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data === undefined ? undefined : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) reject(Object.assign(new Error("Body too large"), { status: 413 }));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req, res) {
  try {
    return { body: JSON.parse(await readBody(req)) };
  } catch (err) {
    json(res, err.status ?? 400, { error: err.status ? err.message : "Invalid JSON" });
    return {};
  }
}

function authorized(req, apiKey) {
  if (!apiKey) return true;
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${apiKey}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Returns { value } or { error } */
export function parseAlertAlarm(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { error: "Body must be a JSON object" };

  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) return { error: "`note` is required" };
  if (note.length > 500) return { error: "`note` must be at most 500 characters" };

  let date = new Date();
  if (body.date !== undefined) {
    date = new Date(body.date);
    if (typeof body.date !== "string" || isNaN(date)) return { error: "`date` must be an ISO-8601 string, e.g. 2026-09-28T14:30:00Z" };
  }

  if (body.id !== undefined && !(typeof body.id === "string" && UUID_RE.test(body.id))) {
    return { error: "`id` must be a UUID" };
  }

  if (body.title !== undefined && typeof body.title !== "string") return { error: "`title` must be a string" };

  let tokens;
  if (body.deviceTokens !== undefined) {
    if (!Array.isArray(body.deviceTokens) || body.deviceTokens.length === 0) return { error: "`deviceTokens` must be a non-empty array" };
    if (!body.deviceTokens.every((t) => typeof t === "string" && TOKEN_RE.test(t))) return { error: "Invalid device token" };
    tokens = body.deviceTokens;
  }

  return { value: { note, date, id: body.id, title: body.title?.trim() || undefined, tokens } };
}

/**
 * apns: { production, sandbox } ApnsClients. Each phone's environment is learned on the first
 * send (TestFlight/App Store builds use production, Xcode builds use sandbox) and remembered.
 */
export function createApp({ apns, store, apiKey, defaultTokens = [], log = console }) {
  async function deliver(token, payload) {
    const known = store.env(token);
    const order = known ? [known] : ["production", "sandbox"];
    let result;
    for (const env of order) {
      result = await apns[env].send(token, payload);
      if (result.ok) {
        store.setEnv(token, env);
        return { ...result, env };
      }
      if (!WRONG_ENV.has(result.reason)) break;
    }
    // Token is dead (app deleted) or matches neither environment: stop sending to it.
    if (result.status === 410 || WRONG_ENV.has(result.reason)) {
      if (known && result.status !== 410) store.setEnv(token, null); // retry both envs next time
      else store.remove(token);
    }
    return result;
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, devices: store.size });

    // Called by the app on launch. No API key: a valid token can only come from an installed copy of the app.
    if (url.pathname === "/devices") {
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      const { body } = await readJson(req, res);
      if (!body) return;
      if (typeof body.token !== "string" || !TOKEN_RE.test(body.token)) return json(res, 400, { error: "Invalid `token`" });
      if (!store.add(body.token.toLowerCase())) return json(res, 507, { error: "Device limit reached" });
      return json(res, 204);
    }

    if (url.pathname !== "/alert-alarm") return json(res, 404, { error: "Not found" });
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    if (!authorized(req, apiKey)) return json(res, 401, { error: "Unauthorized" });

    const { body } = await readJson(req, res);
    if (!body) return;

    const { value, error } = parseAlertAlarm(body);
    if (error) return json(res, 400, { error });

    const tokens = value.tokens ?? [...new Set([...store.tokens(), ...defaultTokens.map((t) => t.toLowerCase())])];
    if (tokens.length === 0) return json(res, 400, { error: "No devices registered yet: open the app on a phone first" });

    const payload = ApnsClient.buildPayload(value);
    const results = await Promise.all(tokens.map((t) => deliver(t, payload)));
    const failed = results.filter((r) => !r.ok);

    for (const r of failed) log.warn(`APNs rejected ${r.deviceToken.slice(0, 8)}…: ${r.status} ${r.reason}`);
    log.info(`alert-alarm "${value.note}" at ${payload.alarm.date} → ${results.length - failed.length}/${results.length} delivered`);

    return json(res, failed.length < results.length ? 202 : 502, {
      id: payload.alarm.id,
      date: payload.alarm.date,
      note: value.note,
      sent: results.length - failed.length,
      failed: failed.map(({ deviceToken, status, reason }) => ({ deviceToken, status, reason })),
    });
  });
}
