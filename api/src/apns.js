import { createSign, randomUUID } from "node:crypto";
import http2 from "node:http2";

const b64url = (v) => Buffer.from(v).toString("base64url");

/** Sends alarm pushes to Apple Push Notification service using token (.p8) auth. */
export class ApnsClient {
  constructor({ keyPem, keyId, teamId, topic, host }) {
    Object.assign(this, { keyPem, keyId, teamId, topic, host });
    this.jwt = null;
    this.jwtIssuedAt = 0;
    this.session = null;
  }

  // Apple wants the provider token refreshed between 20 and 60 minutes.
  #token() {
    const now = Math.floor(Date.now() / 1000);
    if (!this.jwt || now - this.jwtIssuedAt > 50 * 60) {
      const header = b64url(JSON.stringify({ alg: "ES256", kid: this.keyId }));
      const claims = b64url(JSON.stringify({ iss: this.teamId, iat: now }));
      const sig = createSign("SHA256")
        .update(`${header}.${claims}`)
        .sign({ key: this.keyPem, dsaEncoding: "ieee-p1363" });
      this.jwt = `${header}.${claims}.${b64url(sig)}`;
      this.jwtIssuedAt = now;
    }
    return this.jwt;
  }

  #connection() {
    if (!this.session || this.session.closed || this.session.destroyed) {
      this.session = http2.connect(this.host);
      this.session.on("error", () => (this.session = null));
      this.session.unref();
    }
    return this.session;
  }

  /** Payload format the iOS app understands (see Shared/AlarmScheduler.swift). */
  static buildPayload({ id = randomUUID(), date, note, title = "New alarm" }) {
    return {
      aps: {
        alert: { title, body: note },
        sound: "default",
        "mutable-content": 1,
        "content-available": 1,
      },
      alarm: { id, date: date.toISOString(), note },
    };
  }

  send(deviceToken, payload) {
    return new Promise((resolve) => {
      const req = this.#connection().request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${this.#token()}`,
        "apns-topic": this.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
      });
      req.setEncoding("utf8");
      let status = 0;
      let body = "";
      req.on("response", (h) => (status = h[":status"]));
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const reason = body ? JSON.parse(body).reason : undefined;
        resolve({ deviceToken, ok: status === 200, status, reason });
      });
      req.on("error", (err) => resolve({ deviceToken, ok: false, status: 0, reason: err.message }));
      req.end(JSON.stringify(payload));
    });
  }
}
