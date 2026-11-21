import { base64UrlToBytes, bytesToBase64Url } from "../common";

const encoder = new TextEncoder();
const SESSION_TTL_SECONDS = 30 * 60;
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// ---------------------------------------------------------------- store

/** Counters and flags that must be consistent across isolates (KV is not: D1 is). */
export interface TwinStore {
  /** Atomically increments a counter that expires after ttlSeconds; returns the new value. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  getState(key: string): Promise<string | null>;
  setState(key: string, value: string): Promise<void>;
}

const schemaReady = new WeakMap<D1Database, Promise<void>>();

function ensureSchema(db: D1Database): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    // Idempotent DDL, once per isolate: no manual migration step for the owner.
    ready = db
      .batch([
        db.prepare(
          "CREATE TABLE IF NOT EXISTS rate_counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
        ),
        db.prepare(
          "CREATE TABLE IF NOT EXISTS twin_state (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL)",
        ),
      ])
      .then(() => undefined);
    ready.catch(() => schemaReady.delete(db)); // retry on the next request
    schemaReady.set(db, ready);
  }
  return ready;
}

export class D1TwinStore implements TwinStore {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    await ensureSchema(this.db);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;
    const row = await this.db
      .prepare(
        `INSERT INTO rate_counters (key, n, expires_at) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           n = CASE WHEN expires_at <= ? THEN 1 ELSE n + 1 END,
           expires_at = CASE WHEN expires_at <= ? THEN ? ELSE expires_at END
         RETURNING n`,
      )
      .bind(key, expiresAt, now, now, expiresAt)
      .first<{ n: number }>();
    if (!row) throw new Error("counter update returned no row");
    if (Math.random() < 0.01) {
      await this.db.prepare("DELETE FROM rate_counters WHERE expires_at <= ?").bind(now).run();
    }
    return row.n;
  }

  async getState(key: string): Promise<string | null> {
    await ensureSchema(this.db);
    const row = await this.db
      .prepare("SELECT v FROM twin_state WHERE k = ?")
      .bind(key)
      .first<{ v: string }>();
    return row?.v ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    await ensureSchema(this.db);
    await this.db
      .prepare(
        "INSERT INTO twin_state (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at",
      )
      .bind(key, value, Math.floor(Date.now() / 1000))
      .run();
  }
}

// ---------------------------------------------------------------- time helpers

export const utcDate = (nowSec: number): string => new Date(nowSec * 1000).toISOString().slice(0, 10);

export const nextUtcMidnight = (nowSec: number): number => (Math.floor(nowSec / 86400) + 1) * 86400;

// ---------------------------------------------------------------- crypto

const hmacKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);

/** Pseudonymous client id: unlinkable across days, never stored or sent upstream in raw form. */
export async function hashIp(ip: string, secret: string, nowSec: number): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(`ip|${ip}|${utcDate(nowSec)}`),
  );
  return bytesToBase64Url(new Uint8Array(sig).slice(0, 9));
}

interface SessionPayload {
  exp: number;
  iph: string;
}

/** `v1.<payload>.<mac>`: proves a Turnstile check passed for this client recently. */
export async function signSession(iph: string, secret: string, nowSec: number): Promise<string> {
  const payload = bytesToBase64Url(
    encoder.encode(JSON.stringify({ exp: nowSec + SESSION_TTL_SECONDS, iph } satisfies SessionPayload)),
  );
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`v1.${payload}`));
  return `v1.${payload}.${bytesToBase64Url(new Uint8Array(mac))}`;
}

export async function verifySession(
  token: string,
  iph: string,
  secret: string,
  nowSec: number,
): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return false;
    const valid = await crypto.subtle.verify(
      "HMAC", // constant-time comparison
      await hmacKey(secret),
      base64UrlToBytes(parts[2]),
      encoder.encode(`v1.${parts[1]}`),
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1]))) as SessionPayload;
    return payload.exp > nowSec && payload.iph === iph;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Turnstile

export async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "local") form.set("remoteip", ip); // sent to Cloudflare only
    const res = await fetchImpl(TURNSTILE_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- limits and circuit

export interface Limits {
  ipPerMin: number;
  ipPerDay: number;
  globalDailyCap: number;
}

export type LimitResult =
  | { ok: true }
  | { ok: false; scope: "ip_min" | "ip_day" | "global"; retryAfterSec: number };

/** Cheapest first; a blocked client never consumes the global budget. */
export async function checkLimits(
  store: TwinStore,
  iph: string,
  limits: Limits,
  nowSec: number,
): Promise<LimitResult> {
  const untilMidnight = nextUtcMidnight(nowSec) - nowSec;

  const perMinute = await store.incr(`ipm:${iph}:${Math.floor(nowSec / 60)}`, 120);
  if (perMinute > limits.ipPerMin) {
    return { ok: false, scope: "ip_min", retryAfterSec: 60 - (nowSec % 60) };
  }
  const perDay = await store.incr(`ipd:${iph}:${utcDate(nowSec)}`, untilMidnight);
  if (perDay > limits.ipPerDay) {
    return { ok: false, scope: "ip_day", retryAfterSec: untilMidnight };
  }
  const global = await store.incr(`g:${utcDate(nowSec)}`, untilMidnight);
  if (global > limits.globalDailyCap) {
    return { ok: false, scope: "global", retryAfterSec: untilMidnight };
  }
  return { ok: true };
}

const RESTING_KEY = "resting_until";

/** Epoch seconds until which the twin is "resting", or 0. */
export async function getRestingUntil(store: TwinStore, nowSec: number): Promise<number> {
  const until = Number(await store.getState(RESTING_KEY));
  return Number.isFinite(until) && until > nowSec ? until : 0;
}

export const setRestingUntil = (store: TwinStore, untilSec: number): Promise<void> =>
  store.setState(RESTING_KEY, String(untilSec));
