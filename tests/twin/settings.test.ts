import { beforeEach, describe, expect, it } from "vitest";
import { resetTwinCaches } from "../../functions/_lib/twin/cv";
import {
  SETTINGS_KEY,
  type StoredSettings,
  decryptApiKey,
  encryptApiKey,
  loadTwinConfig,
  parseStoredSettings,
  validateApiKey,
  validateModels,
  validateProviderUrl,
} from "../../functions/_lib/twin/settings";
import { fakeKv, makeEnv } from "../helpers/fakes";

const SECRET = "s".repeat(48);
const ORIGIN = "https://openrouter.ai";
const URL_OK = "https://openrouter.ai/api/v1/chat/completions";

describe("validateProviderUrl", () => {
  it("accepts a public https endpoint and normalises it", () => {
    expect(validateProviderUrl(URL_OK, "cv.example.com")).toEqual({ ok: true, value: URL_OK });
    expect(validateProviderUrl("  https://API.Groq.com/openai/v1/chat/completions  ")).toEqual({
      ok: true,
      value: "https://api.groq.com/openai/v1/chat/completions",
    });
    expect(validateProviderUrl("https://api.example.com:443/v1/chat")).toMatchObject({ ok: true });
  });

  it("rejects everything that could leak the key or hit the wrong place", () => {
    const rejected = [
      "http://openrouter.ai/api/v1/chat/completions", // not https
      "https://user:pass@openrouter.ai/api", // credentials
      "https://openrouter.ai:8443/api/v1/chat", // custom port
      "https://openrouter.ai/api/v1/chat?x=1", // query
      "https://openrouter.ai/api/v1/chat#frag", // hash
      "https://127.0.0.1/v1/chat", // IPv4
      "https://169.254.169.254/latest/meta-data", // metadata IP
      "https://[::1]/v1/chat", // IPv6
      "https://2130706433/v1/chat", // decimal IP
      "https://localhost/v1/chat",
      "https://intranet/v1/chat", // single label
      "https://printer.local/v1/chat",
      "https://svc.internal/v1/chat",
      "https://openrouter.ai./api/v1/chat", // trailing dot
      "https://cv.example.com/api/v1/chat", // this site itself
      "https://openrouter.ai", // no endpoint path
      "https://openrouter.ai/",
      "ftp://openrouter.ai/x",
      "javascript:alert(1)",
      "not a url",
      "",
      `https://openrouter.ai/${"a".repeat(300)}`,
    ];
    for (const url of rejected) expect(validateProviderUrl(url, "cv.example.com").ok, url).toBe(false);
    for (const nonString of [undefined, null, 5, {}, []]) expect(validateProviderUrl(nonString).ok).toBe(false);
  });
});

describe("validateModels", () => {
  it("free-only by default on OpenRouter", () => {
    expect(validateModels(["meta-llama/llama-3.3-70b-instruct:free"], false, "openrouter.ai")).toMatchObject({ ok: true });
    expect(validateModels(["a/b:free", "c/d:free", "e/f:free"], false, "openrouter.ai")).toMatchObject({ ok: true });
    expect(validateModels(["openai/gpt-4o"], false, "openrouter.ai").ok).toBe(false);
    expect(validateModels(["a/b:free", "c/d"], false, "openrouter.ai").ok).toBe(false);
  });

  it("paid models and other providers need the explicit allowPaid confirmation", () => {
    expect(validateModels(["openai/gpt-4o"], true, "openrouter.ai")).toMatchObject({ ok: true });
    expect(validateModels(["llama-3.3-70b"], false, "api.groq.com").ok).toBe(false); // no slash, not OpenRouter
    expect(validateModels(["llama-3.3-70b"], true, "api.groq.com")).toMatchObject({ ok: true });
  });

  it("enforces count, uniqueness and charset", () => {
    for (const bad of [[], ["a/b:free", "c/d:free", "e/f:free", "g/h:free"], ["a/b:free", "a/b:free"], [""], ["a b:free"], ["a/b:free;x"], [5], "a/b:free", null, ["../x:free"]]) {
      expect(validateModels(bad, true, "openrouter.ai").ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("validateApiKey", () => {
  it("accepts visible characters only, within bounds", () => {
    expect(validateApiKey("sk-or-v1-abcdef123456")).toMatchObject({ ok: true });
    for (const bad of ["short", "has space in it", "tab\tkey12345", "new\nline12345", "ünïcode-key-12345", "x".repeat(401), "", 5, null]) {
      expect(validateApiKey(bad).ok, String(bad)).toBe(false);
    }
  });
});

describe("API key encryption", () => {
  it("round-trips and never stores the plaintext", async () => {
    const stored = await encryptApiKey("sk-or-v1-super-secret-1234", SECRET, ORIGIN);
    expect(stored).toMatchObject({ v: 1, last4: "1234" });
    expect(JSON.stringify(stored)).not.toContain("super-secret");
    expect(await decryptApiKey(stored, SECRET, ORIGIN)).toBe("sk-or-v1-super-secret-1234");
  });

  it("uses a fresh IV every time", async () => {
    const a = await encryptApiKey("same-key-12345678", SECRET, ORIGIN);
    const b = await encryptApiKey("same-key-12345678", SECRET, ORIGIN);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("fails (null) for another secret, another provider origin, or a tampered record", async () => {
    const stored = await encryptApiKey("sk-or-v1-secret-key-9999", SECRET, ORIGIN);
    expect(await decryptApiKey(stored, "x".repeat(48), ORIGIN)).toBeNull();
    expect(await decryptApiKey(stored, SECRET, "https://evil.example")).toBeNull();
    expect(await decryptApiKey({ ...stored, ct: stored.ct.slice(0, -4) + "AAAA" }, SECRET, ORIGIN)).toBeNull();
    expect(await decryptApiKey({ ...stored, iv: "AAAAAAAAAAAAAAAA" }, SECRET, ORIGIN)).toBeNull();
    expect(await decryptApiKey({ ...stored, ct: "!!!" }, SECRET, ORIGIN)).toBeNull();
  });
});

const record = async (over: Partial<StoredSettings> = {}, withKey = true): Promise<StoredSettings> => ({
  v: 1,
  enabled: true,
  providerUrl: URL_OK,
  models: ["meta-llama/llama-3.3-70b-instruct:free"],
  allowPaid: false,
  apiKey: withKey ? await encryptApiKey("sk-or-v1-stored-key-0001", SECRET, ORIGIN) : undefined,
  updatedAt: 1_700_000_000_000,
  updatedBy: "admin@example.com",
  ...over,
});

describe("parseStoredSettings", () => {
  it("accepts a valid record", async () => {
    const r = parseStoredSettings(JSON.stringify(await record()));
    expect(r.ok && r.value.models).toEqual(["meta-llama/llama-3.3-70b-instruct:free"]);
  });

  it("rejects broken or hostile records", async () => {
    const good = await record();
    const cases: unknown[] = [
      "not json",
      {},
      { ...good, v: 2 },
      { ...good, enabled: "yes" },
      { ...good, providerUrl: "http://openrouter.ai/x/y" },
      { ...good, providerUrl: "https://127.0.0.1/x/y" },
      { ...good, models: ["gpt-4o"] }, // paid without allowPaid
      { ...good, models: [] },
      { ...good, apiKey: { v: 1, iv: 5 } },
      { ...good, updatedAt: "now" },
    ];
    for (const c of cases) {
      expect(parseStoredSettings(typeof c === "string" ? c : JSON.stringify(c)).ok, JSON.stringify(c)).toBe(false);
    }
  });
});

describe("loadTwinConfig: one source of truth, fail closed", () => {
  beforeEach(() => resetTwinCaches());
  const withRecord = (rec: unknown, extra: Record<string, string> = {}) =>
    fakeKv({ [SETTINGS_KEY]: typeof rec === "string" ? rec : JSON.stringify(rec), ...extra });
  const envWith = (kv: ReturnType<typeof fakeKv>, over = {}) =>
    makeEnv({ TWIN_CONFIG_ENC_KEY: SECRET, TWIN_ENABLED: undefined, OPENROUTER_API_KEY: undefined, TWIN_MODELS: undefined, ...over }, kv);

  it("no saved record: environment settings as before (disabled unless TWIN_ENABLED=true)", async () => {
    expect((await loadTwinConfig(makeEnv({ TWIN_ENABLED: undefined }))).state).toBe("disabled");
    resetTwinCaches();
    const r = await loadTwinConfig(makeEnv());
    expect(r).toMatchObject({ state: "ready", source: "env" });
    if (r.state === "ready") {
      expect(r.config.providerUrl).toBe(URL_OK);
      expect(r.config.apiKey).toBe("sk-or-test-key");
    }
  });

  it("saved record is the only source: its key, models and URL are used", async () => {
    const r = await loadTwinConfig(envWith(withRecord(await record())));
    expect(r).toMatchObject({ state: "ready", source: "kv" });
    if (r.state === "ready") {
      expect(r.config).toMatchObject({
        apiKey: "sk-or-v1-stored-key-0001",
        providerUrl: URL_OK,
        models: ["meta-llama/llama-3.3-70b-instruct:free"],
        allowPaid: false,
      });
    }
  });

  it("the saved 'enabled' flag wins over TWIN_ENABLED, and the kill switch wins over everything", async () => {
    const off = withRecord(await record({ enabled: false }));
    expect((await loadTwinConfig(envWith(off, { TWIN_ENABLED: "true" }))).state).toBe("disabled");
    resetTwinCaches();
    const killed = withRecord(await record(), { twin_disabled: "1" });
    expect((await loadTwinConfig(envWith(killed))).state).toBe("disabled");
  });

  it("a broken record means OFF, never a quiet fall back to the environment", async () => {
    const env = (kv: ReturnType<typeof fakeKv>) => envWith(kv, { TWIN_ENABLED: "true", OPENROUTER_API_KEY: "sk-or-env-key-0000", TWIN_MODELS: "a/b:free" });
    for (const broken of ["{not json", JSON.stringify({ v: 1 }), JSON.stringify({ ...(await record()), providerUrl: "http://x.com/a/b" })]) {
      resetTwinCaches();
      const r = await loadTwinConfig(env(withRecord(broken)));
      expect(r.state, broken).toBe("misconfigured");
    }
  });

  it("the environment API key is never used with a saved record", async () => {
    const kv = withRecord(await record({ providerUrl: "https://api.other.com/v1/chat/completions", allowPaid: true }, false));
    const r = await loadTwinConfig(envWith(kv, { OPENROUTER_API_KEY: "sk-or-env-key-0000" }));
    expect(r).toMatchObject({ state: "misconfigured", reason: "No API key is saved" });
  });

  it("missing/short/wrong encryption secret, or a record moved to another origin, cannot decrypt", async () => {
    const good = await record();
    expect(await loadTwinConfig(envWith(withRecord(good), { TWIN_CONFIG_ENC_KEY: undefined }))).toMatchObject({ state: "misconfigured" });
    resetTwinCaches();
    expect(await loadTwinConfig(envWith(withRecord(good), { TWIN_CONFIG_ENC_KEY: "short" }))).toMatchObject({ state: "misconfigured" });
    resetTwinCaches();
    expect(await loadTwinConfig(envWith(withRecord(good), { TWIN_CONFIG_ENC_KEY: "z".repeat(48) }))).toMatchObject({
      state: "misconfigured",
      reason: expect.stringContaining("cannot be decrypted"),
    });
    resetTwinCaches();
    // Someone edits the stored URL to a host they control: the key is bound to the old origin and will not decrypt.
    const moved = withRecord({ ...good, providerUrl: "https://attacker.example/v1/chat/completions", allowPaid: true });
    expect(await loadTwinConfig(envWith(moved))).toMatchObject({ state: "misconfigured" });
  });

  it("missing infrastructure (D1, HMAC secret, Turnstile secret) is reported, not ignored", async () => {
    const kv = withRecord(await record());
    for (const missing of ["TWIN_DB", "TWIN_HMAC_SECRET", "TURNSTILE_SECRET_KEY"] as const) {
      resetTwinCaches();
      expect((await loadTwinConfig(envWith(kv, { [missing]: undefined }))).state, missing).toBe("misconfigured");
    }
  });
});
