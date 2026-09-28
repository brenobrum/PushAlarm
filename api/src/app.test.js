import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import http2 from "node:http2";
import { createApp } from "./app.js";
import { ApnsClient } from "./apns.js";

const TOKEN = "a".repeat(64);
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

// ---- endpoint, with a fake APNs sender ----
const sent = [];
const fakeApns = { send: async (deviceToken, payload) => (sent.push({ deviceToken, payload }), { deviceToken, ok: true, status: 200 }) };
let server, base;

before(async () => {
  server = createApp({ apns: fakeApns, apiKey: "secret", defaultTokens: [TOKEN], log: quiet });
  base = await listen(server);
});
after(() => server.close());

test("POST /alert-alarm sends the alarm push", async () => {
  sent.length = 0;
  const res = await post(base, { note: "Server X went down", date: "2030-01-02T03:04:05Z" });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.sent, 1);
  assert.equal(sent[0].deviceToken, TOKEN);
  assert.deepEqual(sent[0].payload.alarm, { id: body.id, date: "2030-01-02T03:04:05.000Z", note: "Server X went down" });
  assert.equal(sent[0].payload.aps["mutable-content"], 1);
});

test("date defaults to now and tokens can come from the body", async () => {
  sent.length = 0;
  const other = "b".repeat(64);
  const res = await post(base, { note: "hi", deviceTokens: [other] });
  assert.equal(res.status, 202);
  assert.equal(sent[0].deviceToken, other);
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
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/alert-alarm`)).status, 405);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
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

  assert.deepEqual(await apns.send(TOKEN, payload), { deviceToken: TOKEN, ok: true, status: 200, reason: undefined });
  assert.deepEqual(await apns.send("b".repeat(64), payload), { deviceToken: "b".repeat(64), ok: false, status: 410, reason: "Unregistered" });

  const { headers, body } = requests[0];
  assert.equal(headers[":path"], `/3/device/${TOKEN}`);
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
