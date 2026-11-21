import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminData, Env } from "../../functions/_lib/common";
import { onRequest as adminMiddleware } from "../../functions/api/admin/_middleware";
import { onRequestGet as getConfigRoute, onRequestPost as postConfigRoute } from "../../functions/api/admin/twin/config";
import { onRequestPost as postAvatarRoute } from "../../functions/api/admin/twin/avatar";
import { onRequestPost as postTestRoute } from "../../functions/api/admin/twin/test";
import { onRequestGet as publicAvatarRoute } from "../../functions/api/twin/avatar";
import {
  type AdminContext,
  getConfigView,
  resetTestThrottle,
  saveAvatar,
  saveConfig,
  testConnection,
} from "../../functions/_lib/twin/admin";
import { AVATAR_POINTER_KEY, AVATAR_PREFIX, avatarHash } from "../../functions/_lib/twin/avatar";
import { resetTwinCaches } from "../../functions/_lib/twin/cv";
import { SETTINGS_KEY, loadTwinConfig } from "../../functions/_lib/twin/settings";
import { completion, fakeKv, json, makeEnv, makePng, makeWebp, toDataUrl } from "../helpers/fakes";

const API_KEY = "sk-or-v1-TOPSECRET-key-7777";
const SECRET = "e".repeat(48);
const ctx: AdminContext = { actor: "admin@example.com", requestId: "req-1", ray: "ray-1", ownHost: "cv.example.com" };
const FREE = "meta-llama/llama-3.3-70b-instruct:free";

let kv: ReturnType<typeof fakeKv>;
let logs: string[];
const newEnv = (over: Partial<Env> = {}) => makeEnv({ TWIN_CONFIG_ENC_KEY: SECRET, TWIN_ENABLED: undefined, OPENROUTER_API_KEY: undefined, TWIN_MODELS: undefined, ...over }, kv);

beforeEach(() => {
  kv = fakeKv();
  resetTwinCaches();
  resetTestThrottle();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(String(line)));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const save = (body: unknown, env = newEnv(), c = ctx) => saveConfig(env, body, c);
const firstSave = (over: Record<string, unknown> = {}, env = newEnv()) =>
  save({ enabled: true, providerUrl: "https://openrouter.ai/api/v1/chat/completions", models: [FREE], apiKey: API_KEY, ...over }, env);

describe("GET config view", () => {
  it("before anything is saved it shows the environment fallback and never a key", async () => {
    const r = await getConfigView(newEnv({ OPENROUTER_API_KEY: API_KEY, TWIN_MODELS: FREE, TWIN_ENABLED: "true" }));
    expect(r.body).toMatchObject({ source: "env", settings: { hasApiKey: true, apiKeyLast4: null, models: [FREE], enabled: true, updatedAt: null } });
    expect(JSON.stringify(r.body)).not.toContain("TOPSECRET");
  });

  it("reports what is missing in plain words", async () => {
    const r = await getConfigView(newEnv({ TWIN_DB: undefined, TURNSTILE_SECRET_KEY: undefined }));
    expect(r.body.ready).toBe(false);
    expect((r.body.problems as string[]).join(" | ")).toMatch(/API key/);
    expect((r.body.problems as string[]).join(" | ")).toMatch(/TWIN_DB/);
    expect((r.body.problems as string[]).join(" | ")).toMatch(/TURNSTILE_SECRET_KEY/);
  });
});

describe("saving settings", () => {
  it("stores one record, encrypts the key, and never echoes it back", async () => {
    const r = await firstSave();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ source: "kv", ready: true, settings: { enabled: true, hasApiKey: true, apiKeyLast4: "7777", models: [FREE] } });
    expect(JSON.stringify(r.body)).not.toContain("TOPSECRET");
    const stored = kv.data[SETTINGS_KEY];
    expect(stored).toBeTruthy();
    expect(stored).not.toContain("TOPSECRET");
    expect(JSON.parse(stored).apiKey).toMatchObject({ v: 1, last4: "7777" });
    expect(kv.put).toHaveBeenCalledTimes(1); // one write: URL and key can never be read out of step
  });

  it("what was saved is what the chat endpoint will use", async () => {
    await firstSave();
    const loaded = await loadTwinConfig(newEnv());
    expect(loaded).toMatchObject({ state: "ready", source: "kv" });
    if (loaded.state === "ready") expect(loaded.config.apiKey).toBe(API_KEY);
  });

  it("refuses to save a key without the encryption secret", async () => {
    const r = await save({ enabled: true, models: [FREE], apiKey: API_KEY }, newEnv({ TWIN_CONFIG_ENC_KEY: undefined }));
    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain("TWIN_CONFIG_ENC_KEY");
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("rejects unknown fields, wrong types and conflicting instructions", async () => {
    for (const body of [null, [], "x", { extra: 1 }, { enabled: "yes" }, { allowPaid: 1 }, { removeApiKey: "y" }, { models: [FREE], apiKey: API_KEY, removeApiKey: true }, { models: "x" }, { providerUrl: 5 }]) {
      expect((await save(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("applies the URL, model and key rules", async () => {
    for (const bad of [
      { providerUrl: "http://openrouter.ai/api/v1/chat/completions" },
      { providerUrl: "https://127.0.0.1/v1/chat" },
      { providerUrl: "https://cv.example.com/v1/chat" }, // this site
      { models: ["openai/gpt-4o"] }, // paid without allowPaid
      { apiKey: "short" },
      { models: [FREE, FREE] },
      { providerUrl: "https://api.groq.com/openai/v1/chat/completions" }, // other provider without allowPaid
    ]) {
      expect((await firstSave(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await firstSave({ providerUrl: "https://api.groq.com/openai/v1/chat/completions", models: ["llama-3.3-70b"], allowPaid: true })).status).toBe(200);
  });

  it("rejects stale saves (optimistic concurrency) and accepts the current token", async () => {
    const first = await firstSave();
    const token = (first.body.settings as { updatedAt: number }).updatedAt;
    expect((await save({ enabled: false })).status).toBe(409); // no token while a record exists
    expect((await save({ enabled: false, expectedUpdatedAt: token - 5 })).status).toBe(409);
    const ok = await save({ enabled: false, expectedUpdatedAt: token });
    expect(ok.status).toBe(200);
    expect((ok.body.settings as { enabled: boolean; updatedAt: number }).enabled).toBe(false);
    expect((ok.body.settings as { updatedAt: number }).updatedAt).toBeGreaterThan(token);
  });

  it("changing the provider host drops the saved key; the same host keeps it", async () => {
    const first = await firstSave();
    const t1 = (first.body.settings as { updatedAt: number }).updatedAt;
    const samePath = await save({ providerUrl: "https://openrouter.ai/api/v1/chat/completions2", expectedUpdatedAt: t1 });
    expect((samePath.body.settings as { hasApiKey: boolean }).hasApiKey).toBe(true);

    const t2 = (samePath.body.settings as { updatedAt: number }).updatedAt;
    const moved = await save({ providerUrl: "https://api.other.com/v1/chat/completions", models: ["m1"], allowPaid: true, expectedUpdatedAt: t2 });
    expect(moved.status).toBe(200);
    expect((moved.body.settings as { hasApiKey: boolean }).hasApiKey).toBe(false);
    expect(String(moved.body.notice)).toContain("saved API key was removed");
    expect(kv.data[SETTINGS_KEY]).not.toContain('"ct"');
  });

  it("can remove the key explicitly", async () => {
    const first = await firstSave();
    const r = await save({ removeApiKey: true, expectedUpdatedAt: (first.body.settings as { updatedAt: number }).updatedAt });
    expect((r.body.settings as { hasApiKey: boolean }).hasApiKey).toBe(false);
    expect(r.body.ready).toBe(false);
  });

  it("a broken saved record can always be repaired by saving again", async () => {
    kv.data[SETTINGS_KEY] = "{corrupt";
    resetTwinCaches();
    expect(((await getConfigView(newEnv())).body.problems as string[]).join(" ")).toContain("not valid JSON");
    expect((await firstSave()).status).toBe(200);
  });
});

describe("audit trail", () => {
  it("records field names and flags only, never values or the key", async () => {
    await firstSave();
    const audit = logs.map((l) => JSON.parse(l)).filter((l) => l.event === "twin_admin_audit");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: "admin@example.com", action: "settings_saved", request_id: "req-1", ray: "ray-1" });
    expect(audit[0].fields).toContain("apiKey:set");
    expect(audit[0].fields).toContain("models");
    const all = logs.join("\n");
    expect(all).not.toContain("TOPSECRET");
    expect(all).not.toContain("openrouter.ai/api"); // no values
    expect(all).not.toContain(FREE);
  });

  it("is also written to D1 when available, and a D1 failure never blocks the save", async () => {
    const rows: unknown[][] = [];
    const db = {
      prepare: () => ({ run: async () => ({}), bind: (...args: unknown[]) => ({ run: async () => void rows.push(args) }) }),
    } as unknown as D1Database;
    expect((await firstSave({}, newEnv({ TWIN_DB: db }))).status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0].slice(1, 4)).toEqual(["admin@example.com", "settings_saved", expect.stringContaining("apiKey:set")]);
    expect(JSON.stringify(rows)).not.toContain("TOPSECRET");

    resetTwinCaches();
    const broken = { prepare: () => { throw new Error("d1 down"); } } as unknown as D1Database;
    expect((await firstSave({ expectedUpdatedAt: JSON.parse(kv.data[SETTINGS_KEY]).updatedAt }, newEnv({ TWIN_DB: broken }))).status).toBe(200);
  });
});

describe("test connection", () => {
  const providerOk = () => vi.fn(async () => completion("OK")) as unknown as typeof fetch;

  it("uses the saved URL, model and decrypted key, and returns no upstream text", async () => {
    await firstSave();
    const fetchImpl = providerOk();
    const r = await testConnection(newEnv(), ctx, { fetchImpl });
    expect(r.body).toMatchObject({ ok: true, model: "meta-llama/llama-3.3-70b-instruct:free" });
    expect(typeof r.body.usedUpdatedAt).toBe("number");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.stringify(r.body)).not.toContain("TOPSECRET");
  });

  it("maps failures to a kind and never leaks what the provider said", async () => {
    await firstSave();
    const secretBody = vi.fn(async () => json({ error: { message: "PROVIDER-SECRET-TEXT daily limit" } }, 429)) as unknown as typeof fetch;
    const r = await testConnection(newEnv(), ctx, { fetchImpl: secretBody });
    expect(r.body).toMatchObject({ ok: false, kind: "quota_daily" });
    expect(JSON.stringify(r.body)).not.toContain("PROVIDER-SECRET");
  });

  it("is throttled to one test every 10 seconds", async () => {
    await firstSave();
    let t = 1_000_000;
    const opts = { fetchImpl: providerOk(), now: () => t };
    expect((await testConnection(newEnv(), ctx, opts)).status).toBe(200);
    t += 3000;
    const again = await testConnection(newEnv(), ctx, opts);
    expect(again.status).toBe(429);
    expect(again.body.retryAfterSec).toBeGreaterThan(0);
    t += 10_000;
    expect((await testConnection(newEnv(), ctx, opts)).status).toBe(200);
  });

  it("says what is missing instead of calling the provider", async () => {
    const fetchImpl = providerOk();
    const none = await testConnection(newEnv(), ctx, { fetchImpl });
    expect(none.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    resetTestThrottle();
    await save({ enabled: true, models: [FREE] }); // saved without a key
    expect((await testConnection(newEnv(), ctx, { fetchImpl })).body.message).toContain("No API key");
  });
});

describe("avatar upload", () => {
  const upload = (image: unknown) => saveAvatar(newEnv(), { image }, ctx);

  it("accepts PNG and all three WebP encodings, stores a content-addressed blob and a pointer", async () => {
    for (const bytes of [makePng(192, 192), makeWebp("VP8X", 192, 192), makeWebp("VP8L", 128, 128), makeWebp("VP8 ", 64, 64)]) {
      const mime = bytes[0] === 137 ? "image/png" : "image/webp";
      const r = await upload(toDataUrl(bytes, mime));
      expect(r.status, mime).toBe(200);
      const hash = r.body.avatarHash as string;
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
      expect(kv.data[AVATAR_POINTER_KEY]).toBe(hash);
      expect(kv.blobs.get(AVATAR_PREFIX + hash)?.metadata).toEqual({ type: mime });
    }
  });

  it("replacing the picture removes the old blob; reset removes everything", async () => {
    const a = (await upload(toDataUrl(makePng(192, 192)))).body.avatarHash as string;
    const b = (await upload(toDataUrl(makePng(128, 128)))).body.avatarHash as string;
    expect(a).not.toBe(b);
    expect(kv.blobs.has(AVATAR_PREFIX + a)).toBe(false);
    expect(kv.blobs.has(AVATAR_PREFIX + b)).toBe(true);
    const r = await saveAvatar(newEnv(), { reset: true }, ctx);
    expect(r.body).toEqual({ avatarHash: null });
    expect(kv.blobs.size).toBe(0);
    expect(kv.data[AVATAR_POINTER_KEY]).toBeUndefined();
  });

  it("rejects SVG, scripts, mismatched types, non-images, oversize and absurd dimensions", async () => {
    const svg = `data:image/svg+xml;base64,${btoa("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")}`;
    const html = `data:text/html;base64,${btoa("<script>alert(1)</script>")}`;
    const fakePng = toDataUrl(Uint8Array.from([60, 115, 99, 114, 105, 112, 116, 62, ...new Array(60).fill(0)]), "image/png"); // "<script>" with a png label
    const rejected: unknown[] = [
      svg, html, fakePng,
      toDataUrl(makePng(192, 192), "image/webp"), // PNG bytes labelled WebP
      toDataUrl(makeWebp("VP8X", 192, 192), "image/png"), // WebP bytes labelled PNG
      toDataUrl(makePng(192, 192), "image/jpeg"),
      toDataUrl(makePng(4000, 4000)), // huge once decoded
      toDataUrl(makePng(513, 100)),
      toDataUrl(makePng(8, 8)),
      toDataUrl(makePng(192, 192, 150 * 1024)), // too many bytes
      "data:image/png;base64,@@@@", "data:image/png;base64,", "plain text", "", 5, null,
    ];
    for (const image of rejected) {
      expect((await upload(image)).status, String(image).slice(0, 40)).toBe(400);
    }
    expect(kv.blobs.size).toBe(0);
    expect(kv.data[AVATAR_POINTER_KEY]).toBeUndefined();
  });

  it("rejects unknown fields and ambiguous requests", async () => {
    for (const body of [null, [], { image: toDataUrl(makePng(192, 192)), extra: 1 }, {}, { reset: true, image: toDataUrl(makePng(192, 192)) }, { reset: "yes" }]) {
      expect((await saveAvatar(newEnv(), body, ctx)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("public avatar route", () => {
  const get = (hash: string | null) =>
    publicAvatarRoute({
      request: new Request(`https://cv.example.com/api/twin/avatar${hash === null ? "" : `?h=${hash}`}`),
      env: newEnv(),
    } as unknown as Parameters<typeof publicAvatarRoute>[0]) as Promise<Response>;

  it("serves the current picture with hardening headers and immutable caching", async () => {
    const bytes = makeWebp("VP8X", 192, 192);
    const hash = (await saveAvatar(newEnv(), { image: toDataUrl(bytes, "image/webp") }, ctx)).body.avatarHash as string;
    resetTwinCaches();
    const res = await get(hash);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(await avatarHash(bytes)).toBe(hash);
  });

  it("404s for a missing, stale or wrong hash and when nothing is stored", async () => {
    expect((await get(null)).status).toBe(404);
    expect((await get("a".repeat(32))).status).toBe(404); // nothing stored
    const hash = (await saveAvatar(newEnv(), { image: toDataUrl(makePng(192, 192)) }, ctx)).body.avatarHash as string;
    resetTwinCaches();
    expect((await get("b".repeat(32))).status).toBe(404);
    expect((await get(`${hash}x`)).status).toBe(404);
    expect((await get("../../etc/passwd")).status).toBe(404);
    kv.blobs.delete(AVATAR_PREFIX + hash); // pointer without blob
    expect((await get(hash)).status).toBe(404);
  });
});

describe("admin routes sit behind the Access middleware", () => {
  const runMiddleware = (request: Request, env: Env) => {
    const next = vi.fn(async () => json({ reached: true }));
    const data = {} as AdminData;
    const result = adminMiddleware({ request, env, next, data } as unknown as Parameters<typeof adminMiddleware>[0]) as Promise<Response>;
    return { result, next };
  };
  const localEnv = () => newEnv({ ALLOW_INSECURE_LOCAL_AUTH: "true" });
  const post = (headers: Record<string, string>, url = "http://localhost:8788/api/admin/twin/config") =>
    new Request(url, { method: "POST", headers, body: "{}" });

  it("401 without an Access token, 403 for cross-origin or non-JSON writes, otherwise through with no-store", async () => {
    const anon = runMiddleware(new Request("https://cv.example.com/api/admin/twin/config"), newEnv());
    expect((await anon.result).status).toBe(401);
    expect(anon.next).not.toHaveBeenCalled();

    const textPlain = runMiddleware(post({ Origin: "http://localhost:8788", "Content-Type": "text/plain" }), localEnv());
    expect((await textPlain.result).status).toBe(403);
    const cross = runMiddleware(post({ Origin: "https://evil.example", "Content-Type": "application/json" }), localEnv());
    expect((await cross.result).status).toBe(403);
    expect(cross.next).not.toHaveBeenCalled();

    const ok = runMiddleware(post({ Origin: "http://localhost:8788", "Content-Type": "application/json" }), localEnv());
    const res = await ok.result;
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("the route handlers work with the identity the middleware provides", async () => {
    const data = { admin: { actor: "admin@example.com" } } as AdminData;
    const call = <T extends (c: never) => unknown>(handler: T, request: Request) =>
      (handler as unknown as (c: unknown) => Promise<Response>)({ request, env: newEnv(), data }) as Promise<Response>;
    const url = "https://cv.example.com/api/admin/twin/config";
    const headers = { Origin: "https://cv.example.com", "Content-Type": "application/json" };

    expect((await call(getConfigRoute, new Request(url))).status).toBe(200);
    const saved = await call(postConfigRoute, new Request(url, { method: "POST", headers, body: JSON.stringify({ enabled: true, models: [FREE], apiKey: API_KEY }) }));
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain("TOPSECRET");
    expect((await call(postConfigRoute, new Request(url, { method: "POST", headers, body: "{nope" }))).status).toBe(400);
    expect((await call(postConfigRoute, new Request(url, { method: "POST", headers, body: JSON.stringify({ x: "y".repeat(20_000) }) }))).status).toBe(413);

    const avatarRes = await call(postAvatarRoute, new Request(url, { method: "POST", headers, body: JSON.stringify({ image: toDataUrl(makePng(192, 192)) }) }));
    expect(avatarRes.status).toBe(200);
    const oversize = await call(postAvatarRoute, new Request(url, { method: "POST", headers, body: JSON.stringify({ image: "x".repeat(300_000) }) }));
    expect(oversize.status).toBe(413);

    resetTestThrottle();
    const test = await call(postTestRoute, new Request(url, { method: "POST", headers, body: "{}" }));
    expect([200, 400]).toContain(test.status); // no network in tests: either a result or "not ready"
  });
});
