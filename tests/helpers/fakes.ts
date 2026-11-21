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

/** In-memory KV: strings in `data`, binary values (with metadata) in `blobs`. */
export const fakeKv = (data: Record<string, string> = {}) => {
  const blobs = new Map<string, { value: ArrayBuffer; metadata: unknown }>();
  return {
    data,
    blobs,
    get: vi.fn(async (key: string) => data[key] ?? null),
    put: vi.fn(async (key: string, value: string | ArrayBuffer, options?: { metadata?: unknown }) => {
      if (typeof value === "string") data[key] = value;
      else blobs.set(key, { value, metadata: options?.metadata ?? null });
    }),
    delete: vi.fn(async (key: string) => {
      delete data[key];
      blobs.delete(key);
    }),
    getWithMetadata: vi.fn(async (key: string) => {
      const blob = blobs.get(key);
      return blob ? { value: blob.value, metadata: blob.metadata } : { value: null, metadata: null };
    }),
  };
};

// ---- minimal image headers (the server only reads headers, never decodes pixels) ----

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const le = (value: number, bytes: number) => Array.from({ length: bytes }, (_, i) => (value >> (8 * i)) & 0xff);
const be32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

export const makePng = (width: number, height: number, padTo = 64): Uint8Array => {
  const head = [137, 80, 78, 71, 13, 10, 26, 10, ...be32(13), ...ascii("IHDR"), ...be32(width), ...be32(height), 8, 6, 0, 0, 0];
  return Uint8Array.from([...head, ...new Array(Math.max(0, padTo - head.length)).fill(0)]);
};

export const makeWebp = (kind: "VP8X" | "VP8L" | "VP8 ", width: number, height: number, padTo = 64): Uint8Array => {
  let chunk: number[];
  if (kind === "VP8X") chunk = [...ascii("VP8X"), ...le(10, 4), 0, 0, 0, 0, ...le(width - 1, 3), ...le(height - 1, 3)];
  else if (kind === "VP8L") {
    const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
    chunk = [...ascii("VP8L"), ...le(10, 4), 0x2f, ...le(bits >>> 0, 4), 0, 0, 0, 0, 0];
  } else {
    chunk = [...ascii("VP8 "), ...le(20, 4), 0, 0, 0, 0x9d, 0x01, 0x2a, ...le(width, 2), ...le(height, 2)];
  }
  const body = [...ascii("WEBP"), ...chunk];
  const out = [...ascii("RIFF"), ...le(body.length, 4), ...body];
  return Uint8Array.from([...out, ...new Array(Math.max(0, padTo - out.length)).fill(0)]);
};

export const toDataUrl = (bytes: Uint8Array, mime = "image/png"): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte); // not spread: large arrays overflow the stack
  return `data:${mime};base64,${btoa(binary)}`;
};

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
