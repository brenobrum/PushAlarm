import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MAX_DEVICES = 5000;

/**
 * Registered phones: token → { env: "production" | "sandbox" | null, registeredAt }.
 * Persisted as JSON when a file path is given (mount a volume there in production).
 */
export class DeviceStore {
  constructor(file) {
    this.file = file;
    this.devices = new Map();
    if (!file) return;
    try {
      for (const [token, info] of Object.entries(JSON.parse(readFileSync(file, "utf8")))) this.devices.set(token, info);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  get size() {
    return this.devices.size;
  }

  tokens() {
    return [...this.devices.keys()];
  }

  env(token) {
    return this.devices.get(token)?.env ?? null;
  }

  /** Returns false when the store is full. */
  add(token) {
    if (this.devices.has(token)) return true;
    if (this.devices.size >= MAX_DEVICES) return false;
    this.devices.set(token, { env: null, registeredAt: new Date().toISOString() });
    this.#save();
    return true;
  }

  setEnv(token, env) {
    const info = this.devices.get(token);
    if (!info || info.env === env) return;
    info.env = env;
    this.#save();
  }

  remove(token) {
    if (this.devices.delete(token)) this.#save();
  }

  #save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.devices), null, 2));
    renameSync(tmp, this.file);
  }
}
