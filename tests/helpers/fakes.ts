import { vi } from "vitest";
import type { Env } from "../../functions/_lib/common";
import type { TwinStore } from "../../functions/_lib/twin/guard";

/** In-memory TwinStore with the same semantics as the D1 one (counters expire). */
export class MemoryStore implements TwinStore {
  counters = new Map<string, { n: number; exp: number }>();
  state = new Map<string, string>();
  fail = false;
  private readonly clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    if (this.fail) throw new Error("store down");
    const now = Math.floor(this.clock() / 1000);
    const entry = this.counters.get(key);
    if (!entry || entry.exp <= now) {
      this.counters.set(key, { n: 1, exp: now + ttlSeconds });
      return 1;
    }
    entry.n += 1;
    return entry.n;
  }

  async getState(key: string): Promise<string | null> {
    if (this.fail) throw new Error("store down");
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    if (this.fail) throw new Error("store down");
    this.state.set(key, value);
  }
}

export const fakeKv = (data: Record<string, string> = {}) => ({
  data,
  get: vi.fn(async (key: string) => data[key] ?? null),
});

export const makeEnv = (overrides: Partial<Env> = {}, kv = fakeKv()): Env =>
  ({
    CV_DATA: kv as unknown as KVNamespace,
    TWIN_ENABLED: "true",
    OPENROUTER_API_KEY: "sk-or-test-key",
    TWIN_MODELS: "meta-llama/llama-3.3-70b-instruct:free,google/gemma-3-27b-it:free",
    TWIN_HMAC_SECRET: "h".repeat(48),
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    TWIN_ALLOWED_HOSTS: "cv.example.com",
    TWIN_DB: {} as D1Database,
    ...overrides,
  }) as Env;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export const completion = (content: string, extra: Record<string, unknown> = {}) =>
  json({
    id: "gen-1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1000, completion_tokens: 40 },
    ...extra,
  });

export interface Call {
  url: string;
  body: Record<string, unknown> | null;
  rawBody: string;
}

/** Routes Turnstile and OpenRouter requests to controllable fakes and records every call. */
export function makeFetch(
  opts: {
    turnstile?: boolean | "network-error";
    upstream?: (call: Call) => Response | Promise<Response>;
  } = {},
) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const rawBody = typeof init?.body === "string" ? init.body : init?.body ? init.body.toString() : "";
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
    const call = { url, body, rawBody };
    calls.push(call);
    if (url.includes("challenges.cloudflare.com")) {
      if (opts.turnstile === "network-error") throw new Error("network");
      return json({ success: opts.turnstile !== false });
    }
    return opts.upstream ? opts.upstream(call) : completion("I work as a Senior Software Engineer.");
  });
  return {
    impl: impl as unknown as typeof fetch,
    mock: impl,
    calls,
    upstreamCalls: () => calls.filter((c) => !c.url.includes("challenges.cloudflare.com")),
  };
}

export const SAMPLE_CV = {
  profile: {
    name: "Test Person",
    title: "Engineer",
    summary: "Summary text.",
    location: "Selangor, Malaysia",
    address: "No. 1, Secret Street, 43300 Somewhere",
    url: "https://www.linkedin.com/in/test-person/",
    photo: "data:image/png;base64,AAAA",
  },
  experience: [
    { id: "1", company: "Acme", role: "Senior Engineer", startDate: "Sept 2019", endDate: "Present", description: "Did things." },
    { id: "2", company: "Old Co", role: "Programmer", startDate: "May 2006", endDate: "May 2014", description: "Did older things." },
  ],
  education: [{ id: "1", institution: "Some College", degree: "Diploma", year: "1999 - 2001" }],
  skills: [{ id: "1", name: "Delphi", category: "backend", level: 100 }],
  languages: [{ id: "1", language: "English", proficiency: "Professional" }],
  certifications: [{ id: "1", name: "Scrum Master Certified", year: "2019" }],
  contact: { email: "test@example.com", phone: "+60 12-345 6789", github: "https://github.com/test" },
};
