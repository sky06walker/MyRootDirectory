import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleChat, handleStatus } from "../../functions/_lib/twin/handler";
import { saveAvatar, saveConfig } from "../../functions/_lib/twin/admin";
import { callOpenRouter } from "../../functions/_lib/twin/openrouter";
import { resetTwinCaches } from "../../functions/_lib/twin/cv";
import { completion, fakeKv, makeEnv, makeFetch, makePng, MemoryStore, toDataUrl } from "../helpers/fakes";

const API_KEY = "sk-or-v1-TOPSECRET-provider-key-4242";
const NOW = Date.parse("2026-11-21T10:00:00Z");

const base = { apiKey: "k-12345678", models: ["a/b:free"], system: "SYS", messages: [{ role: "user" as const, content: "hi" }] };
const bodyOf = (f: typeof fetch) => JSON.parse(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string);
const initOf = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;

describe("provider adapter hardening", () => {
  it("never follows redirects (the API key must not travel to another host)", async () => {
    const f = vi.fn(async () => completion("ok")) as unknown as typeof fetch;
    await callOpenRouter({ ...base, fetchImpl: f });
    // NOT "error": the Workers runtime does not support redirect:"error" (every call failed silently).
    expect(initOf(f).redirect).toBe("manual");

    for (const status of [301, 302, 303, 307, 308]) {
      const redirected = vi.fn(
        async () => new Response(null, { status, headers: { Location: "https://evil.example/steal" } }),
      ) as unknown as typeof fetch;
      expect(await callOpenRouter({ ...base, fetchImpl: redirected }), String(status)).toEqual({ ok: false, kind: "unavailable" });
      expect(redirected).toHaveBeenCalledTimes(1); // the Location is never requested
    }
  });

  it("OpenRouter gets its extensions; any other provider gets the plain OpenAI-style body", async () => {
    const f1 = vi.fn(async () => completion("ok")) as unknown as typeof fetch;
    await callOpenRouter({ ...base, models: ["a/b:free", "c/d:free"], dataCollectionDeny: true, fetchImpl: f1 });
    expect(bodyOf(f1)).toMatchObject({ models: ["a/b:free", "c/d:free"], provider: { data_collection: "deny" } });

    const f2 = vi.fn(async () => completion("ok")) as unknown as typeof fetch;
    await callOpenRouter({ ...base, models: ["llama-3.3-70b", "second"], dataCollectionDeny: true, url: "https://api.groq.com/openai/v1/chat/completions", fetchImpl: f2 });
    const body = bodyOf(f2);
    expect(body.model).toBe("llama-3.3-70b");
    expect(body.models).toBeUndefined();
    expect(body.provider).toBeUndefined();
    expect((f2 as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("stops reading a hostile huge response instead of buffering it", async () => {
    let cancelled = false;
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 50_000;
        controller.enqueue(new Uint8Array(50_000).fill(120));
        if (sent > 5_000_000) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const f = vi.fn(async () => new Response(stream, { status: 200 })) as unknown as typeof fetch;
    expect(await callOpenRouter({ ...base, fetchImpl: f })).toEqual({ ok: false, kind: "bad_response" });
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(1_000_000); // cut off after ~100 KB, not the whole 5 MB
  });

  it("still reads a normal multi-chunk response, and rejects an unusable URL", async () => {
    const text = JSON.stringify({ choices: [{ message: { content: "chunked ok" }, finish_reason: "stop" }] });
    const half = Math.floor(text.length / 2);
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(text.slice(0, half)));
        controller.enqueue(enc.encode(text.slice(half)));
        controller.close();
      },
    });
    const f = vi.fn(async () => new Response(stream, { status: 200 })) as unknown as typeof fetch;
    expect(await callOpenRouter({ ...base, fetchImpl: f })).toMatchObject({ ok: true, answer: "chunked ok" });
    expect(await callOpenRouter({ ...base, url: "not a url" })).toEqual({ ok: false, kind: "unavailable" });
  });
});

describe("chat endpoint uses the settings saved in the admin page", () => {
  let logs: string[];
  beforeEach(() => {
    resetTwinCaches();
    logs = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(String(line)));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const adminCtx = { actor: "admin@example.com", requestId: "r", ownHost: "cv.example.com" };
  const setup = async (settings: Record<string, unknown>) => {
    const kv = fakeKv();
    const env = makeEnv(
      { TWIN_CONFIG_ENC_KEY: "e".repeat(48), TWIN_ENABLED: undefined, OPENROUTER_API_KEY: undefined, TWIN_MODELS: undefined, TWIN_REQUIRE_TURNSTILE: "false", TURNSTILE_SECRET_KEY: undefined },
      kv,
    );
    const saved = await saveConfig(env, { enabled: true, apiKey: API_KEY, ...settings }, adminCtx);
    expect(saved.status).toBe(200);
    resetTwinCaches();
    return { env, kv };
  };
  const ask = (env: ReturnType<typeof makeEnv>, fetcher: ReturnType<typeof makeFetch>) =>
    handleChat(
      new Request("https://cv.example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://cv.example.com", "CF-Connecting-IP": "203.0.113.5", "CF-Ray": "x" },
        body: JSON.stringify({ messages: [{ role: "user", content: "What is your current role?" }] }),
      }),
      env,
      { store: new MemoryStore(() => NOW), fetchImpl: fetcher.impl, now: () => NOW },
    );

  it("OpenRouter settings: saved key, model list and URL reach the provider; the key never reaches the visitor or the logs", async () => {
    const { env } = await setup({ providerUrl: "https://openrouter.ai/api/v1/chat/completions", models: ["x/one:free", "y/two:free"] });
    const fetcher = makeFetch();
    const res = await ask(env, fetcher);
    expect(res.status).toBe(200);
    const call = fetcher.upstreamCalls()[0];
    expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((fetcher.mock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    expect(call.body).toMatchObject({ models: ["x/one:free", "y/two:free"] });
    expect(await res.clone().text()).not.toContain("TOPSECRET");
    expect(logs.join("\n")).not.toContain("TOPSECRET");
    expect(JSON.parse(logs[logs.length - 1])).toMatchObject({ outcome: "ok", config_source: "kv" });
  });

  it("another provider (paid confirmed): its URL and plain body are used, with the key re-entered for that provider", async () => {
    const { env } = await setup({ providerUrl: "https://api.groq.com/openai/v1/chat/completions", models: ["llama-3.3-70b"], allowPaid: true });
    const fetcher = makeFetch();
    expect((await ask(env, fetcher)).status).toBe(200);
    const call = fetcher.upstreamCalls()[0];
    expect(call.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(call.body).toMatchObject({ model: "llama-3.3-70b" });
    expect(call.body?.models).toBeUndefined();
  });

  it("switched off in the admin page: disabled, no provider call", async () => {
    const { env, kv } = await setup({ models: ["x/one:free"] });
    const record = JSON.parse(kv.data.twin_config);
    kv.data.twin_config = JSON.stringify({ ...record, enabled: false });
    resetTwinCaches();
    const fetcher = makeFetch();
    const res = await ask(env, fetcher);
    expect(res.status).toBe(503);
    expect((await res.json()) as unknown).toEqual({ error: "disabled" });
    expect(fetcher.calls).toHaveLength(0);
  });

  it("a broken saved record answers 'unavailable' and does not fall back to environment settings", async () => {
    const { env, kv } = await setup({ models: ["x/one:free"] });
    kv.data.twin_config = "{corrupt";
    resetTwinCaches();
    const fetcher = makeFetch();
    const res = await ask({ ...env, TWIN_ENABLED: "true", OPENROUTER_API_KEY: "sk-or-env-key-0000", TWIN_MODELS: "a/b:free" }, fetcher);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("unavailable");
    expect(fetcher.calls).toHaveLength(0);
  });

  it("the status endpoint exposes only the avatar hash of a custom picture", async () => {
    const { env } = await setup({ models: ["x/one:free"] });
    const status = async () =>
      (await (await handleStatus(new Request("https://cv.example.com/api/chat/status", { headers: { "CF-Ray": "x" } }), env, { store: new MemoryStore(() => NOW), now: () => NOW })).json()) as Record<string, unknown>;
    expect(await status()).toEqual({ enabled: true, available: true, avatarHash: null });

    const hash = (await saveAvatar(env, { image: toDataUrl(makePng(192, 192)) }, adminCtx)).body.avatarHash;
    resetTwinCaches();
    expect(await status()).toEqual({ enabled: true, available: true, avatarHash: hash });
    expect(JSON.stringify(await status())).not.toContain("TOPSECRET");
  });
});
