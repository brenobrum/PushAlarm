import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ApnsClient } from "./apns.js";

const MAX_BODY = 16 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{64,200}$/i;

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
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

function authorized(req, apiKey) {
  if (!apiKey) return true;
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${apiKey}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Returns { value } or { error } */
export function parseAlertAlarm(body, defaultTokens) {
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

  let tokens = defaultTokens;
  if (body.deviceTokens !== undefined) {
    if (!Array.isArray(body.deviceTokens) || body.deviceTokens.length === 0) return { error: "`deviceTokens` must be a non-empty array" };
    tokens = body.deviceTokens;
  }
  if (tokens.length === 0) return { error: "No device token: pass `deviceTokens` or set APNS_DEVICE_TOKENS" };
  if (!tokens.every((t) => typeof t === "string" && TOKEN_RE.test(t))) return { error: "Invalid device token" };

  return { value: { note, date, id: body.id, title: body.title?.trim() || undefined, tokens } };
}

export function createApp({ apns, apiKey, defaultTokens = [], log = console }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });

    if (url.pathname !== "/alert-alarm") return json(res, 404, { error: "Not found" });
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    if (!authorized(req, apiKey)) return json(res, 401, { error: "Unauthorized" });

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return json(res, err.status ?? 400, { error: err.status ? err.message : "Invalid JSON" });
    }

    const { value, error } = parseAlertAlarm(body, defaultTokens);
    if (error) return json(res, 400, { error });

    const payload = ApnsClient.buildPayload(value);
    const results = await Promise.all(value.tokens.map((t) => apns.send(t, payload)));
    const sent = results.filter((r) => r.ok).length;

    for (const r of results.filter((r) => !r.ok)) {
      log.warn(`APNs rejected ${r.deviceToken.slice(0, 8)}…: ${r.status} ${r.reason}`);
    }
    log.info(`alert-alarm "${value.note}" at ${payload.alarm.date} → ${sent}/${results.length} delivered`);

    return json(res, sent > 0 ? 202 : 502, {
      id: payload.alarm.id,
      date: payload.alarm.date,
      note: value.note,
      sent,
      failed: results.filter((r) => !r.ok).map(({ deviceToken, status, reason }) => ({ deviceToken, status, reason })),
    });
  });
}
