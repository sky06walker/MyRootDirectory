export interface Env {
  CV_DATA: KVNamespace;
  /** Cloudflare Zero Trust team domain, e.g. "myteam.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the single Access application protecting /admin and /api/admin. */
  ACCESS_AUD?: string;
  /** Local development only ("true" in git-ignored .dev.vars). Honoured on localhost only, never via the edge. */
  ALLOW_INSECURE_LOCAL_AUTH?: string;

  // --- Digital twin (see planning/PLAN.md); everything below is optional and the twin fails closed without it ---
  /** "true" enables the twin. Anything else (including unset) keeps it off. */
  TWIN_ENABLED?: string;
  /** Secret. OpenRouter API key (server-side only). */
  OPENROUTER_API_KEY?: string;
  /** Comma-separated OpenRouter model ids, max 3, each must end with ":free". */
  TWIN_MODELS?: string;
  /** Secret. Key for session tokens and IP hashing (32+ random bytes). */
  TWIN_HMAC_SECRET?: string;
  /** Secret. Cloudflare Turnstile secret key. */
  TURNSTILE_SECRET_KEY?: string;
  /** "false" disables the Turnstile requirement (local development only). */
  TWIN_REQUIRE_TURNSTILE?: string;
  /** Comma-separated hostnames allowed to call /api/chat (your custom domain). localhost is always allowed without CF-Ray. */
  TWIN_ALLOWED_HOSTS?: string;
  /** "true" sends provider.data_collection=deny to OpenRouter (may leave no free endpoint). */
  TWIN_DATA_COLLECTION_DENY?: string;
  TWIN_GLOBAL_DAILY_CAP?: string;
  TWIN_IP_PER_MIN?: string;
  TWIN_IP_PER_DAY?: string;
  /** Local development only: replaces the OpenRouter URL (honoured on localhost without CF-Ray). */
  TWIN_UPSTREAM_URL?: string;
  /** D1 database for rate-limit counters, the resting flag and the admin audit log. */
  TWIN_DB?: D1Database;
  /** Secret, 32+ characters. Encrypts the AI API key saved from the admin page (separate from TWIN_HMAC_SECRET on purpose). */
  TWIN_CONFIG_ENC_KEY?: string;
}

export interface AdminIdentity {
  /** Access user email (or service-token common_name / subject); used for the audit log. */
  actor: string;
}

/** Per-request data set by functions/api/admin/_middleware.ts. */
export interface AdminData extends Record<string, unknown> {
  admin: AdminIdentity;
}

export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

// ---------------------------------------------------------------------------
// Admin authentication: Cloudflare Access.
//
// Access (configured in the Cloudflare dashboard, see docs/admin-access-setup.md)
// authenticates the user in front of /admin* and /api/admin/*. We do NOT trust that
// alone: *.pages.dev, previews or a mis-scoped policy could bypass it, so the admin
// middleware re-verifies the signed Cf-Access-Jwt-Assertion header on every request.
// Fails CLOSED when the Access settings are missing or invalid.
// ---------------------------------------------------------------------------

const MAX_TOKEN_LENGTH = 8192;
const CLOCK_SKEW_SECONDS = 60;
const JWKS_TTL_MS = 60 * 60 * 1000; // reuse fetched signing keys for 1h
const JWKS_MIN_REFRESH_MS = 60 * 1000; // never refetch more than once a minute
const JWKS_FETCH_TIMEOUT_MS = 5000;
const TEAM_DOMAIN_PATTERN = /^[a-z0-9-]+\.cloudflareaccess\.com$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

let jwksCache: {
  domain: string;
  fetchedAt: number;
  keys: Map<string, CryptoKey>;
} | null = null;
let jwksInflight: Promise<Map<string, CryptoKey>> | null = null;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value)) throw new Error("invalid base64url segment");
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
}

async function fetchSigningKeys(domain: string): Promise<Map<string, CryptoKey>> {
  // URL comes from validated configuration only, never from the token (no iss/jku/x5u).
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Access JWKS fetch failed with status ${res.status}`);
  const { keys } = (await res.json()) as {
    keys: (JsonWebKey & { kid?: string })[];
  };

  const imported = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    imported.set(
      jwk.kid,
      await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, // algorithm fixed here, not from the token
        false,
        ["verify"],
      ),
    );
  }
  if (imported.size === 0) throw new Error("Access JWKS contained no usable RSA keys");
  jwksCache = { domain, fetchedAt: Date.now(), keys: imported };
  return imported;
}

async function loadSigningKeys(
  domain: string,
  forceRefresh: boolean,
): Promise<Map<string, CryptoKey>> {
  if (jwksCache && jwksCache.domain === domain) {
    const age = Date.now() - jwksCache.fetchedAt;
    if (!forceRefresh && age < JWKS_TTL_MS) return jwksCache.keys;
    // Unknown-kid refreshes are rate limited so a stream of junk tokens cannot
    // turn this endpoint into a request amplifier against Cloudflare.
    if (forceRefresh && age < JWKS_MIN_REFRESH_MS) return jwksCache.keys;
  }
  // Concurrent requests share a single in-flight fetch.
  if (!jwksInflight) {
    jwksInflight = fetchSigningKeys(domain).finally(() => {
      jwksInflight = null;
    });
  }
  return jwksInflight;
}

function isLocalDevBypass(request: Request, env: Env): boolean {
  if (env.ALLOW_INSECURE_LOCAL_AUTH !== "true") return false;
  // Real edge traffic always carries CF-Ray: never honour the bypass for it, even if
  // the variable was set in production by mistake.
  if (request.headers.has("CF-Ray")) {
    console.error(
      "ALLOW_INSECURE_LOCAL_AUTH is set but the request came through the Cloudflare edge; ignoring it",
    );
    return false;
  }
  const { hostname } = new URL(request.url);
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]") {
    return false;
  }
  console.warn("INSECURE local auth bypass is active (localhost only)");
  return true;
}

/** Returns the signed-in admin, or null. Never throws. */
export async function authenticate(
  request: Request,
  env: Env,
): Promise<AdminIdentity | null> {
  if (isLocalDevBypass(request, env)) return { actor: "local-dev" };

  const domain = env.ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const audience = env.ACCESS_AUD?.trim();
  if (!domain || !audience || !TEAM_DOMAIN_PATTERN.test(domain)) {
    console.error(
      "Cloudflare Access is not configured correctly (ACCESS_TEAM_DOMAIN must be <team>.cloudflareaccess.com and ACCESS_AUD must be set); denying admin access",
    );
    return null;
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts;

    // Pin the algorithm: never let the token choose how it is verified.
    const header = decodeJson<{ alg?: string; kid?: string }>(headerPart);
    if (header.alg !== "RS256" || !header.kid) return null;

    let key = (await loadSigningKeys(domain, false)).get(header.kid);
    if (!key) key = (await loadSigningKeys(domain, true)).get(header.kid); // key rotation
    if (!key) return null;

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlToBytes(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) return null;

    const claims = decodeJson<{
      iss?: string;
      aud?: string | string[];
      exp?: number;
      nbf?: number;
      email?: string;
      common_name?: string;
      sub?: string;
    }>(payloadPart);
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];

    if (claims.iss !== `https://${domain}`) return null;
    if (!audiences.includes(audience)) return null;
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= now) return null;
    if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_SECONDS > now) return null;

    return { actor: claims.email ?? claims.common_name ?? claims.sub ?? "unknown" };
  } catch (e) {
    // Never log the token itself.
    console.error("Access JWT verification error:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * CSRF guard for state-changing admin requests: the browser must send a same-origin
 * `Origin` and a JSON content type (a cross-site <form> cannot produce either).
 */
export function isSameOriginJson(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  return (request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json");
}
