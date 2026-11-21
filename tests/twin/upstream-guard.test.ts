import { describe, expect, it, vi } from "vitest";
import { OPENROUTER_URL, callOpenRouter, classifyError } from "../../functions/_lib/twin/openrouter";
import {
  checkLimits,
  getRestingUntil,
  hashIp,
  nextUtcMidnight,
  setRestingUntil,
  signSession,
  utcDate,
  verifySession,
  verifyTurnstile,
} from "../../functions/_lib/twin/guard";
import { isAllowedHost, isLocalRequest, parseModels, readConfig } from "../../functions/_lib/twin/config";
import { MemoryStore, completion, json, makeEnv } from "../helpers/fakes";

const base = {
  apiKey: "sk-or-test",
  models: ["meta-llama/llama-3.3-70b-instruct:free"],
  system: "SYSTEM",
  messages: [{ role: "user" as const, content: "Hello" }],
};
const fetchReturning = (res: Response | (() => Response)) =>
  vi.fn(async () => (typeof res === "function" ? res() : res)) as unknown as typeof fetch;

describe("callOpenRouter", () => {
  it("builds a bounded, non-streaming request with a single model", async () => {
    const f = fetchReturning(completion("Hi"));
    const r = await callOpenRouter({ ...base, fetchImpl: f });
    expect(r).toMatchObject({ ok: true, answer: "Hi", model: "meta-llama/llama-3.3-70b-instruct:free" });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENROUTER_URL);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: base.models[0], stream: false, temperature: 0.2, max_tokens: 400 });
    expect(body.models).toBeUndefined();
    expect(body.messages[0]).toEqual({ role: "system", content: "SYSTEM" });
    expect(body.provider).toBeUndefined();
    expect(body).not.toHaveProperty("user");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
    expect(Object.keys(init.headers as object).map((h) => h.toLowerCase())).not.toContain("http-referer");
  });

  it("sends an ordered fallback list and the privacy preference when asked", async () => {
    const f = fetchReturning(completion("Hi"));
    await callOpenRouter({ ...base, models: ["a/b:free", "c/d:free"], dataCollectionDeny: true, fetchImpl: f });
    const body = JSON.parse(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string);
    expect(body.models).toEqual(["a/b:free", "c/d:free"]);
    expect(body.model).toBeUndefined();
    expect(body.provider).toEqual({ data_collection: "deny" });
  });

  it("classifies upstream errors", async () => {
    expect(classifyError(402, "")).toBe("payment");
    expect(classifyError(429, "Rate limit exceeded: free-models-per-day")).toBe("quota_daily");
    expect(classifyError(429, "Too many requests")).toBe("rate_limited");
    expect(classifyError(500, "")).toBe("unavailable");
    expect(classifyError(401, "")).toBe("unavailable");
  });

  it("maps HTTP and in-body errors without leaking upstream text", async () => {
    const daily = await callOpenRouter({
      ...base,
      fetchImpl: fetchReturning(json({ error: { message: "free-models-per-day exceeded", code: 429 } }, 429, { "Retry-After": "120" })),
    });
    expect(daily).toEqual({ ok: false, kind: "quota_daily", retryAfterSec: 120 });

    const rate = await callOpenRouter({ ...base, fetchImpl: fetchReturning(json({ error: { message: "slow down" } }, 429)) });
    expect(rate).toMatchObject({ ok: false, kind: "rate_limited" });

    expect(await callOpenRouter({ ...base, fetchImpl: fetchReturning(json({ error: { message: "x" } }, 402)) })).toMatchObject({ kind: "payment" });
    expect(await callOpenRouter({ ...base, fetchImpl: fetchReturning(new Response("boom", { status: 503 })) })).toMatchObject({ kind: "unavailable" });

    // OpenRouter can answer 200 with an error object in the body.
    const inBody = await callOpenRouter({ ...base, fetchImpl: fetchReturning(json({ error: { message: "per-day", code: 429 } })) });
    expect(inBody).toMatchObject({ ok: false, kind: "quota_daily" });
  });

  it("rejects empty, malformed or oversized responses", async () => {
    expect(await callOpenRouter({ ...base, fetchImpl: fetchReturning(completion("   ")) })).toMatchObject({ kind: "bad_response" });
    expect(await callOpenRouter({ ...base, fetchImpl: fetchReturning(new Response("<html>")) })).toMatchObject({ kind: "bad_response" });
    expect(await callOpenRouter({ ...base, fetchImpl: fetchReturning(json({ choices: [] })) })).toMatchObject({ kind: "bad_response" });
    expect(await callOpenRouter({ ...base, fetchImpl: fetchReturning(new Response("x".repeat(200_000))) })).toMatchObject({ kind: "bad_response" });
  });

  it("maps timeouts and network failures", async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    expect(await callOpenRouter({ ...base, fetchImpl: timeout })).toEqual({ ok: false, kind: "timeout" });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await callOpenRouter({ ...base, fetchImpl: down })).toEqual({ ok: false, kind: "unavailable" });
  });
});

describe("sessions and ip hashing", () => {
  const secret = "s".repeat(40);
  const now = 1_800_000_000;

  it("verifies a fresh session bound to the same client", async () => {
    const iph = await hashIp("203.0.113.9", secret, now);
    const token = await signSession(iph, secret, now);
    expect(await verifySession(token, iph, secret, now + 10)).toBe(true);
  });

  it("rejects expired, tampered, foreign-client, wrong-secret and garbage tokens", async () => {
    const iph = await hashIp("203.0.113.9", secret, now);
    const token = await signSession(iph, secret, now);
    expect(await verifySession(token, iph, secret, now + 31 * 60)).toBe(false);
    const [v, payload, mac] = token.split(".");
    const forged = btoa(JSON.stringify({ exp: now + 99999, iph })).replace(/=+$/, "");
    expect(await verifySession(`${v}.${forged}.${mac}`, iph, secret, now)).toBe(false);
    expect(await verifySession(`${v}.${payload}.${mac.slice(0, -2)}AA`, iph, secret, now)).toBe(false);
    expect(await verifySession(token, await hashIp("198.51.100.1", secret, now), secret, now)).toBe(false);
    expect(await verifySession(token, iph, "x".repeat(40), now)).toBe(false);
    for (const junk of ["", "v1", "v1.a.b", "v2.a.b", "a.b.c.d", "v1.!!!.???"]) {
      expect(await verifySession(junk, iph, secret, now)).toBe(false);
    }
  });

  it("hashes IPs per day and per secret, never exposing the raw address", async () => {
    const a = await hashIp("203.0.113.9", secret, now);
    expect(a).toBe(await hashIp("203.0.113.9", secret, now + 60));
    expect(a).not.toBe(await hashIp("203.0.113.9", secret, now + 86400));
    expect(a).not.toBe(await hashIp("203.0.113.9", "z".repeat(40), now));
    expect(a).not.toContain("203");
  });
});

describe("verifyTurnstile", () => {
  it("returns true only for success:true", async () => {
    expect(await verifyTurnstile("t", "s", "1.2.3.4", fetchReturning(json({ success: true })))).toBe(true);
    expect(await verifyTurnstile("t", "s", "1.2.3.4", fetchReturning(json({ success: false })))).toBe(false);
    expect(await verifyTurnstile("t", "s", "1.2.3.4", fetchReturning(json({}, 500)))).toBe(false);
    expect(await verifyTurnstile("t", "s", "1.2.3.4", fetchReturning(new Response("nope")))).toBe(false);
    expect(await verifyTurnstile("t", "s", "1.2.3.4", vi.fn(async () => { throw new Error("x"); }) as unknown as typeof fetch)).toBe(false);
  });

  it("sends the secret and token as a form and the client IP only when known", async () => {
    const f = fetchReturning(json({ success: true }));
    await verifyTurnstile("tok", "sec", "1.2.3.4", f);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(String(init.body)).toBe("secret=sec&response=tok&remoteip=1.2.3.4");
    const g = fetchReturning(json({ success: true }));
    await verifyTurnstile("tok", "sec", "local", g);
    expect(String((g as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body)).not.toContain("remoteip");
  });
});

describe("limits and resting flag", () => {
  const limits = { ipPerMin: 3, ipPerDay: 5, globalDailyCap: 7 };
  const now = Math.floor(Date.parse("2026-11-20T10:00:30Z") / 1000);

  it("blocks exactly after the per-minute cap and reports a retry time", async () => {
    const store = new MemoryStore(() => now * 1000);
    for (let i = 0; i < 3; i++) expect(await checkLimits(store, "a", limits, now)).toEqual({ ok: true });
    expect(await checkLimits(store, "a", limits, now)).toEqual({ ok: false, scope: "ip_min", retryAfterSec: 30 });
  });

  it("blocks after the per-day cap across minutes", async () => {
    const store = new MemoryStore(() => now * 1000);
    let result;
    for (let i = 0; i < 6; i++) result = await checkLimits(store, "a", limits, now + i * 60);
    expect(result).toMatchObject({ ok: false, scope: "ip_day" });
  });

  it("a blocked client does not consume the global budget, and the global cap stops everyone", async () => {
    const store = new MemoryStore(() => now * 1000);
    for (let i = 0; i < 6; i++) await checkLimits(store, "abuser", { ...limits, ipPerMin: 1 }, now);
    expect(store.counters.get(`g:${utcDate(now)}`)?.n).toBe(1);

    const shared = new MemoryStore(() => now * 1000);
    for (let i = 0; i < 7; i++) expect((await checkLimits(shared, `ip${i}`, limits, now)).ok).toBe(true);
    expect(await checkLimits(shared, "ip8", limits, now)).toMatchObject({ ok: false, scope: "global" });
  });

  it("counters expire so a new day starts clean", async () => {
    let t = now;
    const store = new MemoryStore(() => t * 1000);
    for (let i = 0; i < 7; i++) await checkLimits(store, `ip${i}`, limits, t);
    t = nextUtcMidnight(now) + 5;
    expect(await checkLimits(store, "ip0", limits, t)).toEqual({ ok: true });
    expect(nextUtcMidnight(now)).toBe(Math.floor(Date.parse("2026-11-21T00:00:00Z") / 1000));
  });

  it("stores and expires the resting flag", async () => {
    const store = new MemoryStore();
    expect(await getRestingUntil(store, now)).toBe(0);
    await setRestingUntil(store, now + 100);
    expect(await getRestingUntil(store, now)).toBe(now + 100);
    expect(await getRestingUntil(store, now + 101)).toBe(0);
  });
});

describe("config", () => {
  it("only accepts :free model ids, at most three", () => {
    expect(parseModels("meta-llama/llama-3.3-70b-instruct:free")).toEqual(["meta-llama/llama-3.3-70b-instruct:free"]);
    expect(parseModels("a/b:free, c/d:free ,e/f:free")).toHaveLength(3);
    for (const bad of [undefined, "", "a/b", "a/b:paid", "a/b:free,c/d", "a/b:free,c/d:free,e/f:free,g/h:free", "../x:free", "openrouter/auto", "a/b:free;rm"]) {
      expect(parseModels(bad)).toBeNull();
    }
  });

  it("fails closed when anything required is missing", () => {
    expect(readConfig(makeEnv()).ok).toBe(true);
    for (const missing of ["OPENROUTER_API_KEY", "TWIN_MODELS", "TWIN_HMAC_SECRET", "TWIN_DB", "TURNSTILE_SECRET_KEY"] as const) {
      expect(readConfig(makeEnv({ [missing]: undefined })).ok).toBe(false);
    }
    expect(readConfig(makeEnv({ TWIN_HMAC_SECRET: "short" })).ok).toBe(false);
    expect(readConfig(makeEnv({ TWIN_REQUIRE_TURNSTILE: "false", TURNSTILE_SECRET_KEY: undefined })).ok).toBe(true);
  });

  it("clamps limits to sane numbers and defaults bad values", () => {
    const cfg = readConfig(makeEnv({ TWIN_IP_PER_MIN: "abc", TWIN_IP_PER_DAY: "999999", TWIN_GLOBAL_DAILY_CAP: "900" }));
    expect(cfg.ok && cfg.config.limits).toEqual({ ipPerMin: 3, ipPerDay: 10, globalDailyCap: 900 });
  });

  it("allows only configured hosts, and localhost only without CF-Ray", () => {
    const env = makeEnv();
    const at = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
    expect(isAllowedHost(at("https://cv.example.com/x"), env)).toBe(true);
    expect(isAllowedHost(at("https://cv-app.pages.dev/x"), env)).toBe(false);
    expect(isAllowedHost(at("https://abc123.cv-app.pages.dev/x"), env)).toBe(false);
    expect(isAllowedHost(at("http://localhost:8788/x"), env)).toBe(true);
    expect(isAllowedHost(at("http://localhost:8788/x", { "CF-Ray": "1" }), env)).toBe(false);
    expect(isLocalRequest(at("http://127.0.0.1/x"))).toBe(true);
    expect(isAllowedHost(at("https://cv.example.com/x"), makeEnv({ TWIN_ALLOWED_HOSTS: "" }))).toBe(false);
  });
});
