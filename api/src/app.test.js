import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import http2 from "node:http2";
import { createApp } from "./app.js";
import { ApnsClient } from "./apns.js";
import { DeviceStore } from "./devices.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const quiet = { info() {}, warn() {} };

function listen(server) {
  return new Promise((r) => server.listen(0, () => r(`http://localhost:${server.address().port}`)));
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/alert-alarm`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

// ---- endpoint, with fake APNs servers ----
// Tokens starting with "a" are production phones, "b" sandbox phones, "d" deleted apps.
const sent = [];
const fakeEnv = (env) => ({
  send: async (deviceToken, payload) => {
    sent.push({ env, deviceToken, payload });
    if (deviceToken.startsWith("d")) return { deviceToken, ok: false, status: 410, reason: "Unregistered" };
    const mine = deviceToken.startsWith(env === "production" ? "a" : "b");
    return mine ? { deviceToken, ok: true, status: 200 } : { deviceToken, ok: false, status: 400, reason: "BadDeviceToken" };
  },
});
const PROD = "a".repeat(64);
const SANDBOX = "b".repeat(64);
const DEAD = "d".repeat(64);
let server, base, store;

before(async () => {
  store = new DeviceStore(null);
  server = createApp({ apns: { production: fakeEnv("production"), sandbox: fakeEnv("sandbox") }, store, apiKey: "secret", log: quiet });
  base = await listen(server);
});
after(() => server.close());

const register = (token) =>
  fetch(`${base}/devices`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });

test("POST /alert-alarm without devices explains what to do", async () => {
  const res = await post(base, { note: "x" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /No devices registered/);
});

test("POST /devices registers phones (no API key needed)", async () => {
  assert.equal((await register(PROD)).status, 204);
  assert.equal((await register(SANDBOX.toUpperCase())).status, 204);
  assert.equal((await register(PROD)).status, 204); // idempotent
  assert.equal((await register("nope")).status, 400);
  assert.deepEqual(store.tokens(), [PROD, SANDBOX]);
});

test("alarm goes to every phone, each on its own APNs environment", async () => {
  sent.length = 0;
  const res = await post(base, { note: "Server X went down", date: "2030-01-02T03:04:05Z" });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.sent, 2);
  assert.deepEqual(sent.filter((s) => s.env === "production").map((s) => s.deviceToken), [PROD, SANDBOX]);
  assert.deepEqual(sent.filter((s) => s.env === "sandbox").map((s) => s.deviceToken), [SANDBOX]);
  assert.deepEqual(sent[0].payload.alarm, { id: body.id, date: "2030-01-02T03:04:05.000Z", note: "Server X went down" });
  assert.equal(store.env(PROD), "production");
  assert.equal(store.env(SANDBOX), "sandbox");

  // Environments are remembered: one request per phone next time.
  sent.length = 0;
  await post(base, { note: "again" });
  assert.deepEqual(sent.map((s) => [s.env, s.deviceToken]), [["production", PROD], ["sandbox", SANDBOX]]);
});

test("dead tokens are removed", async () => {
  await register(DEAD);
  const res = await post(base, { note: "x" });
  assert.equal(res.status, 202);
  assert.deepEqual((await res.json()).failed, [{ deviceToken: DEAD, status: 410, reason: "Unregistered" }]);
  assert.ok(!store.tokens().includes(DEAD));
});

test("deviceTokens in the body override the registered list", async () => {
  sent.length = 0;
  await post(base, { note: "hi", deviceTokens: [SANDBOX] });
  assert.deepEqual([...new Set(sent.map((s) => s.deviceToken))], [SANDBOX]);
  assert.ok(Math.abs(new Date(sent[0].payload.alarm.date) - Date.now()) < 5000);
});

test("rejects bad input", async () => {
  for (const body of [{}, { note: "  " }, { note: "x", date: "tomorrow" }, { note: "x", id: "nope" }, { note: "x", deviceTokens: ["zz"] }, "{bad json", []]) {
    assert.equal((await post(base, body)).status, 400, JSON.stringify(body));
  }
});

test("requires the API key", async () => {
  assert.equal((await post(base, { note: "x" }, { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await post(base, { note: "x" }, { authorization: "" })).status, 401);
});

test("other routes", async () => {
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, devices: 2 });
  assert.equal((await fetch(`${base}/alert-alarm`)).status, 405);
  assert.equal((await fetch(`${base}/devices`)).status, 405);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test("DeviceStore persists to disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "pushalarm-"));
  const file = join(dir, "sub", "devices.json");
  const a = new DeviceStore(file);
  a.add(PROD);
  a.setEnv(PROD, "production");
  const b = new DeviceStore(file);
  assert.deepEqual(b.tokens(), [PROD]);
  assert.equal(b.env(PROD), "production");
  rmSync(dir, { recursive: true });
});

// ---- real ApnsClient against a local HTTP/2 server acting as APNs ----
test("ApnsClient signs and sends the request APNs expects", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const requests = [];
  const fakeApple = http2.createServer();
  fakeApple.on("stream", (stream, headers) => {
    let body = "";
    stream.on("data", (c) => (body += c));
    stream.on("end", () => {
      requests.push({ headers, body: JSON.parse(body) });
      const bad = headers[":path"].endsWith("b".repeat(64));
      stream.respond({ ":status": bad ? 410 : 200 });
      stream.end(bad ? JSON.stringify({ reason: "Unregistered" }) : "");
    });
  });
  const host = await listen(fakeApple);

  const apns = new ApnsClient({ keyPem: privateKey.export({ type: "pkcs8", format: "pem" }), keyId: "KEY123", teamId: "TEAM123", topic: "com.brenobrum.pushalarm", host });
  const payload = ApnsClient.buildPayload({ date: new Date("2030-01-01T00:00:00Z"), note: "hello" });

  assert.deepEqual(await apns.send(PROD, payload), { deviceToken: PROD, ok: true, status: 200, reason: undefined });
  assert.deepEqual(await apns.send("b".repeat(64), payload), { deviceToken: "b".repeat(64), ok: false, status: 410, reason: "Unregistered" });

  const { headers, body } = requests[0];
  assert.equal(headers[":path"], `/3/device/${PROD}`);
  assert.equal(headers["apns-topic"], "com.brenobrum.pushalarm");
  assert.equal(headers["apns-push-type"], "alert");
  assert.deepEqual(body, payload);

  const [h, c, s] = headers.authorization.replace("bearer ", "").split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "KEY123" });
  assert.equal(JSON.parse(Buffer.from(c, "base64url")).iss, "TEAM123");
  assert.ok(createVerify("SHA256").update(`${h}.${c}`).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));

  apns.session.close();
  fakeApple.close();
});
