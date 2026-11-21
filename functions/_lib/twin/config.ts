import type { Env } from "../common";

export interface TwinConfig {
  apiKey: string;
  models: string[];
  hmacSecret: string;
  requireTurnstile: boolean;
  turnstileSecret: string;
  dataCollectionDeny: boolean;
  limits: { ipPerMin: number; ipPerDay: number; globalDailyCap: number };
}

// Only ":free" model ids can ever be sent upstream, so the twin cannot spend money.
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*:free$/i;
const MAX_MODELS = 3;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const intEnv = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export function parseModels(value: string | undefined): string[] | null {
  const models = (value ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length < 1 || models.length > MAX_MODELS) return null;
  return models.every((m) => MODEL_PATTERN.test(m)) ? models : null;
}

export const parseHosts = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

/** localhost without CF-Ray = a developer machine, never edge traffic. */
export function isLocalRequest(request: Request): boolean {
  return (
    !request.headers.has("CF-Ray") &&
    LOCAL_HOSTS.has(new URL(request.url).hostname.toLowerCase())
  );
}

/** The custom domain only (so *.pages.dev and previews cannot bypass its WAF), plus local dev. */
export function isAllowedHost(request: Request, env: Env): boolean {
  if (isLocalRequest(request)) return true;
  return parseHosts(env.TWIN_ALLOWED_HOSTS).includes(new URL(request.url).hostname.toLowerCase());
}

export type ConfigResult = { ok: true; config: TwinConfig } | { ok: false; reason: string };

/** Validates everything the twin needs. Anything missing -> the twin stays off (fail closed). */
export function readConfig(env: Env): ConfigResult {
  const models = parseModels(env.TWIN_MODELS);
  if (!models) return { ok: false, reason: "TWIN_MODELS must list 1-3 ids ending in :free" };
  if (!env.OPENROUTER_API_KEY) return { ok: false, reason: "OPENROUTER_API_KEY is not set" };
  if (!env.TWIN_HMAC_SECRET || env.TWIN_HMAC_SECRET.length < 32) {
    return { ok: false, reason: "TWIN_HMAC_SECRET must be at least 32 characters" };
  }
  if (!env.TWIN_DB) return { ok: false, reason: "TWIN_DB (D1) binding is missing" };

  const requireTurnstile = env.TWIN_REQUIRE_TURNSTILE !== "false";
  if (requireTurnstile && !env.TURNSTILE_SECRET_KEY) {
    return { ok: false, reason: "TURNSTILE_SECRET_KEY is not set" };
  }

  return {
    ok: true,
    config: {
      apiKey: env.OPENROUTER_API_KEY,
      models,
      hmacSecret: env.TWIN_HMAC_SECRET,
      requireTurnstile,
      turnstileSecret: env.TURNSTILE_SECRET_KEY ?? "",
      dataCollectionDeny: env.TWIN_DATA_COLLECTION_DENY === "true",
      limits: {
        ipPerMin: intEnv(env.TWIN_IP_PER_MIN, 3, 1, 60),
        ipPerDay: intEnv(env.TWIN_IP_PER_DAY, 10, 1, 1000),
        globalDailyCap: intEnv(env.TWIN_GLOBAL_DAILY_CAP, 45, 1, 100000),
      },
    },
  };
}
