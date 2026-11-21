import type { Env } from "../common";

export const OPENROUTER_HOST = "openrouter.ai";
export const DEFAULT_PROVIDER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface TwinConfig {
  apiKey: string;
  /** Full chat-completions endpoint (https). */
  providerUrl: string;
  models: string[];
  /** Admin ticked "this may cost money": ids need not end in :free. */
  allowPaid: boolean;
  hmacSecret: string;
  requireTurnstile: boolean;
  turnstileSecret: string;
  dataCollectionDeny: boolean;
  limits: { ipPerMin: number; ipPerDay: number; globalDailyCap: number };
}

/** Everything in TwinConfig that never comes from the admin page (infrastructure and secrets). */
export type InfraConfig = Pick<
  TwinConfig,
  "hmacSecret" | "requireTurnstile" | "turnstileSecret" | "dataCollectionDeny" | "limits"
>;

// Free-only default: unless the admin ticks "allow paid", only ":free" ids can ever be sent upstream.
const FREE_MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*:free$/i;

/**
 * OpenRouter's own "Free Models Router": picks a free model automatically (its listed price is 0
 * for prompt and completion). The OTHER openrouter/* routers (auto, auto-code, ...) have variable
 * pricing and can bill, so they are deliberately NOT here.
 */
export const FREE_ROUTER_IDS: ReadonlySet<string> = new Set(["openrouter/free"]);

/** True for ids that are free by construction on OpenRouter: `vendor/model:free` or the free router. */
export const isFreeOpenRouterId = (id: string): boolean => id.endsWith(":free") || FREE_ROUTER_IDS.has(id);
export const MODEL_CHARSET = /^[A-Za-z0-9][A-Za-z0-9._~:/+-]{0,99}$/;
export const MAX_MODELS = 3;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const intEnv = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** Environment-variable models (fallback path): strictly free OpenRouter ids. */
export function parseModels(value: string | undefined): string[] | null {
  const models = (value ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length < 1 || models.length > MAX_MODELS) return null;
  return models.every((m) => FREE_MODEL_PATTERN.test(m) || FREE_ROUTER_IDS.has(m)) ? models : null;
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

/** The configured host(s) only (so previews cannot bypass the WAF), plus local dev. */
export function isAllowedHost(request: Request, env: Env): boolean {
  if (isLocalRequest(request)) return true;
  return parseHosts(env.TWIN_ALLOWED_HOSTS).includes(new URL(request.url).hostname.toLowerCase());
}

/** What is missing from the infrastructure side (D1, secrets, Turnstile). Empty = fine. */
export function infraProblems(env: Env): string[] {
  const problems: string[] = [];
  if (!env.TWIN_DB) problems.push("TWIN_DB (D1 database binding) is not set up");
  if (!env.TWIN_HMAC_SECRET || env.TWIN_HMAC_SECRET.length < 32) {
    problems.push("TWIN_HMAC_SECRET secret must be at least 32 characters");
  }
  if (env.TWIN_REQUIRE_TURNSTILE !== "false" && !env.TURNSTILE_SECRET_KEY) {
    problems.push("TURNSTILE_SECRET_KEY secret is not set");
  }
  return problems;
}

export type InfraResult = { ok: true; config: InfraConfig } | { ok: false; reason: string };

export function readInfra(env: Env): InfraResult {
  const problems = infraProblems(env);
  if (problems.length > 0) return { ok: false, reason: problems.join("; ") };
  return {
    ok: true,
    config: {
      hmacSecret: env.TWIN_HMAC_SECRET as string,
      requireTurnstile: env.TWIN_REQUIRE_TURNSTILE !== "false",
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

export type ConfigResult = { ok: true; config: TwinConfig } | { ok: false; reason: string };

/**
 * Environment-only configuration (used when nothing has been saved from the admin page).
 * The env API key only ever goes to the built-in OpenRouter endpoint.
 */
export function readConfig(env: Env): ConfigResult {
  const models = parseModels(env.TWIN_MODELS);
  if (!models) return { ok: false, reason: "TWIN_MODELS must list 1-3 ids ending in :free" };
  if (!env.OPENROUTER_API_KEY) return { ok: false, reason: "OPENROUTER_API_KEY is not set" };
  const infra = readInfra(env);
  if (!infra.ok) return infra;
  return {
    ok: true,
    config: {
      apiKey: env.OPENROUTER_API_KEY,
      providerUrl: DEFAULT_PROVIDER_URL,
      models,
      allowPaid: false,
      ...infra.config,
    },
  };
}
