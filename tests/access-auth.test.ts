import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate, isSameOriginJson, type Env } from "../functions/_lib/common";

// Real RSA signatures against a mocked Cloudflare Access JWKS endpoint.

const TEAM = "myteam.cloudflareaccess.com";
const AUD = "aud-tag-123";
const enc = new TextEncoder();
const b64u = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encJson = (value: unknown) => b64u(enc.encode(JSON.stringify(value)));
const nowSec = () => Math.floor(Date.now() / 1000);

const generate = () =>
  crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;

const publicJwk = async (pair: CryptoKeyPair, kid: string) => ({
  ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey),
  kid,
});

async function sign(pair: CryptoKeyPair, header: object, claims: object): Promise<string> {
  const h = encJson(header);
  const p = encJson(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}

const claims = (over: Record<string, unknown> = {}) => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  exp: nowSec() + 600,
  email: "admin@example.com",
  ...over,
});

let good: CryptoKeyPair;
let other: CryptoKeyPair;
let goodJwk: JsonWebKey & { kid: string };
let fetchCalls: string[];
let domainCounter = 0;

// The verifier caches signing keys per team domain for an hour, so every test uses its own domain.
const freshEnv = (over: Partial<Env> = {}) => {
  const domain = `team${domainCounter++}.cloudflareaccess.com`;
  return { env: { CV_DATA: {}, ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: AUD, ...over } as unknown as Env, domain };
};
const request = (token: string | null, url = "https://site.example/api/admin/verify", headers: Record<string, string> = {}) =>
  new Request(url, { headers: { ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}), ...headers } });

beforeEach(async () => {
  good ??= await generate();
  other ??= await generate();
  goodJwk ??= (await publicJwk(good, "kid-1")) as JsonWebKey & { kid: string };
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetchCalls.push(String(url));
      return new Response(JSON.stringify({ keys: [goodJwk] }), { status: 200 });
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

const header = { alg: "RS256", kid: "kid-1" };
const tokenFor = (domain: string, over: Record<string, unknown> = {}, pair = good, h: object = header) =>
  sign(pair, h, claims({ iss: `https://${domain}`, ...over }));

describe("authenticate: valid and invalid tokens", () => {
  it("accepts a correctly signed token and reports the email as actor", async () => {
    const { env, domain } = freshEnv();
    expect(await authenticate(request(await tokenFor(domain)), env)).toEqual({ actor: "admin@example.com" });
    expect(fetchCalls).toEqual([`https://${domain}/cdn-cgi/access/certs`]);
  });

  it("accepts aud as a string, as a list with another app, and falls back to common_name then sub", async () => {
    const { env, domain } = freshEnv();
    expect(await authenticate(request(await tokenFor(domain, { aud: AUD })), env)).not.toBeNull();
    expect(await authenticate(request(await tokenFor(domain, { aud: ["x", AUD] })), env)).not.toBeNull();
    const service = { ...claims({ iss: `https://${domain}` }), email: undefined };
    expect((await authenticate(request(await sign(good, header, { ...service, common_name: "svc" })), env))?.actor).toBe("svc");
    expect((await authenticate(request(await sign(good, header, { ...service, sub: "sub-1" })), env))?.actor).toBe("sub-1");
  });

  it("rejects another application's audience, a wrong issuer, expiry and not-yet-valid tokens", async () => {
    const { env, domain } = freshEnv();
    expect(await authenticate(request(await tokenFor(domain, { aud: ["other-app"] })), env)).toBeNull();
    expect(await authenticate(request(await tokenFor(domain, { iss: "https://evil.cloudflareaccess.com" })), env)).toBeNull();
    expect(await authenticate(request(await tokenFor(domain, { exp: nowSec() - 120 })), env)).toBeNull();
    expect(await authenticate(request(await tokenFor(domain, { exp: nowSec() - 30 })), env)).not.toBeNull(); // inside the 60 s skew
    expect(await authenticate(request(await tokenFor(domain, { exp: undefined })), env)).toBeNull();
    expect(await authenticate(request(await tokenFor(domain, { nbf: nowSec() + 600 })), env)).toBeNull();
  });

  it("rejects wrong keys, tampered payloads and pinned-algorithm violations", async () => {
    const { env, domain } = freshEnv();
    expect(await authenticate(request(await tokenFor(domain, {}, other)), env)).toBeNull();

    const [h, , s] = (await tokenFor(domain)).split(".");
    expect(await authenticate(request(`${h}.${encJson(claims({ iss: `https://${domain}`, email: "attacker@evil.com" }))}.${s}`), env)).toBeNull();

    const forged = `${encJson({ alg: "none", kid: "kid-1" })}.${encJson(claims({ iss: `https://${domain}` }))}.`;
    expect(await authenticate(request(forged), env)).toBeNull();
    expect(await authenticate(request(await tokenFor(domain, {}, good, { alg: "HS256", kid: "kid-1" })), env)).toBeNull();
    expect(await authenticate(request(await tokenFor(domain, {}, good, { alg: "RS256" })), env)).toBeNull();
  });

  it("never throws on malformed, empty or oversized tokens", async () => {
    const { env } = freshEnv();
    for (const token of ["", "abc", "a.b", "a.b.c.d", "!!!.@@@.###", "x".repeat(9000)]) {
      expect(await authenticate(request(token), env)).toBeNull();
    }
    expect(await authenticate(request(null), env)).toBeNull();
  });

  it("rejects the old forgeable cookie", async () => {
    const { env } = freshEnv();
    expect(await authenticate(request(null, undefined, { Cookie: "auth=true" }), env)).toBeNull();
  });
});

describe("authenticate: configuration fails closed", () => {
  it("rejects when a setting is missing or the team domain is not *.cloudflareaccess.com (and never fetches)", async () => {
    const { env, domain } = freshEnv();
    const token = await tokenFor(domain);
    expect(await authenticate(request(token), { ...env, ACCESS_AUD: undefined })).toBeNull();
    expect(await authenticate(request(token), { ...env, ACCESS_TEAM_DOMAIN: undefined })).toBeNull();
    expect(await authenticate(request(token), { ...env, ACCESS_TEAM_DOMAIN: "evil.example.com" })).toBeNull();
    expect(await authenticate(request(token), { ...env, ACCESS_TEAM_DOMAIN: "evil.com/x.cloudflareaccess.com" })).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  it("tolerates a scheme and trailing slash in the team domain", async () => {
    const { env, domain } = freshEnv();
    const withScheme = { ...env, ACCESS_TEAM_DOMAIN: `https://${domain}/` } as Env;
    expect(await authenticate(request(await tokenFor(domain)), withScheme)).not.toBeNull();
  });

  it("fails closed when the key endpoint errors or returns no usable keys", async () => {
    for (const make of [
      () => { throw new Error("network down"); },
      () => new Response("boom", { status: 500 }),
      () => new Response(JSON.stringify({ keys: [] })),
    ]) {
      vi.stubGlobal("fetch", vi.fn(async () => make()));
      const { env, domain } = freshEnv();
      expect(await authenticate(request(await tokenFor(domain)), env)).toBeNull();
    }
  });

  it("shares one key fetch between concurrent cold requests", async () => {
    const { env, domain } = freshEnv();
    const token = await tokenFor(domain);
    const results = await Promise.all(Array.from({ length: 8 }, () => authenticate(request(token), env)));
    expect(results.every((r) => r?.actor === "admin@example.com")).toBe(true);
    expect(fetchCalls).toHaveLength(1);
  });

  it("refreshes keys for an unknown kid at most once a minute (key rotation)", async () => {
    const second = await generate();
    let keys: unknown[] = [goodJwk];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetchCalls.push(String(url));
      return new Response(JSON.stringify({ keys }));
    }));
    const { env, domain } = freshEnv();
    expect(await authenticate(request(await tokenFor(domain)), env)).not.toBeNull();
    expect(fetchCalls).toHaveLength(1);

    keys = [goodJwk, await publicJwk(second, "kid-2")];
    const rotated = await tokenFor(domain, {}, second, { alg: "RS256", kid: "kid-2" });
    expect(await authenticate(request(rotated), env)).toBeNull(); // throttled: no refetch inside 60 s
    expect(fetchCalls).toHaveLength(1);

    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      const later = await tokenFor(domain, { exp: Math.floor((realNow() + 61_000) / 1000) + 600 }, second, { alg: "RS256", kid: "kid-2" });
      expect(await authenticate(request(later), env)).not.toBeNull();
      expect(fetchCalls).toHaveLength(2);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("authenticate: local development bypass", () => {
  const bypass = (over: Partial<Env> = {}) =>
    ({ CV_DATA: {}, ALLOW_INSECURE_LOCAL_AUTH: "true", ...over }) as unknown as Env;

  it("works only on localhost, only when the flag is exactly 'true', and never via the edge", async () => {
    expect(await authenticate(request(null, "http://localhost:8788/x"), bypass())).toEqual({ actor: "local-dev" });
    expect(await authenticate(request(null, "http://127.0.0.1:8788/x"), bypass())).toEqual({ actor: "local-dev" });
    expect(await authenticate(request(null, "https://site.example/x"), bypass())).toBeNull();
    expect(await authenticate(request(null, "http://localhost/x", { "CF-Ray": "1-KUL" }), bypass())).toBeNull();
    for (const value of [undefined, "", "false", "1", "TRUE"]) {
      expect(await authenticate(request(null, "http://localhost/x"), bypass({ ALLOW_INSECURE_LOCAL_AUTH: value }))).toBeNull();
    }
  });
});

describe("isSameOriginJson (CSRF guard)", () => {
  const post = (headers: Record<string, string>) =>
    new Request("https://site.example/api/admin/content", { method: "POST", headers });

  it("allows reads, and same-origin JSON writes", () => {
    expect(isSameOriginJson(new Request("https://site.example/x"))).toBe(true);
    expect(isSameOriginJson(post({ Origin: "https://site.example", "Content-Type": "application/json" }))).toBe(true);
    expect(isSameOriginJson(post({ Origin: "https://site.example", "Content-Type": "application/json; charset=utf-8" }))).toBe(true);
  });

  it("blocks writes without a same-origin Origin or without a JSON content type", () => {
    expect(isSameOriginJson(post({ "Content-Type": "application/json" }))).toBe(false);
    expect(isSameOriginJson(post({ Origin: "https://evil.example", "Content-Type": "application/json" }))).toBe(false);
    expect(isSameOriginJson(post({ Origin: "https://site.example", "Content-Type": "text/plain" }))).toBe(false);
    expect(isSameOriginJson(post({ Origin: "https://site.example" }))).toBe(false);
    expect(isSameOriginJson(post({ Origin: "null", "Content-Type": "application/json" }))).toBe(false);
  });
});
