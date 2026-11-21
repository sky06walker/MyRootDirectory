import type { Env } from "../common";
import { writeAudit } from "./audit";
import {
  AVATAR_POINTER_KEY,
  AVATAR_PREFIX,
  avatarHash,
  isAvatarHash,
  parseAvatarDataUrl,
} from "./avatar";
import { DEFAULT_PROVIDER_URL, infraProblems, parseModels } from "./config";
import { resetTwinCaches } from "./cv";
import { callOpenRouter } from "./openrouter";
import {
  MIN_ENC_SECRET_LENGTH,
  SETTINGS_KEY,
  type StoredSettings,
  decryptApiKey,
  encryptApiKey,
  parseStoredSettings,
  validateApiKey,
  validateModels,
  validateProviderUrl,
} from "./settings";

// Logic behind the admin "Digital twin" card. The route files under functions/api/admin/twin/
// are thin wrappers; authentication and the CSRF guard come from functions/api/admin/_middleware.ts.
// Nothing here ever returns the API key (only whether one is saved and its last 4 characters) and
// nothing logs values: audit rows carry field NAMES only.

export interface AdminContext {
  actor: string;
  requestId: string;
  ray?: string;
  /** The site's own host name (a provider URL may not point at it). */
  ownHost: string;
}

export interface AdminResult {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, error: string, message: string): AdminResult => ({
  status,
  body: { error, message },
});

// ---------------------------------------------------------------- view

interface ReadResult {
  stored: StoredSettings | null;
  /** A record exists but did not validate. */
  corrupt: string | null;
}

async function readStored(env: Env): Promise<ReadResult> {
  const raw = await env.CV_DATA.get(SETTINGS_KEY); // fresh read, not the 30 s cache
  if (raw === null) return { stored: null, corrupt: null };
  const parsed = parseStoredSettings(raw);
  return parsed.ok ? { stored: parsed.value, corrupt: null } : { stored: null, corrupt: parsed.message };
}

async function currentAvatarHash(env: Env): Promise<string | null> {
  const value = await env.CV_DATA.get(AVATAR_POINTER_KEY);
  return isAvatarHash(value) ? value : null;
}

async function buildView(env: Env, read: ReadResult): Promise<Record<string, unknown>> {
  const { stored, corrupt } = read;
  const problems: string[] = [];
  let settings: Record<string, unknown>;
  const encKeySet = !!env.TWIN_CONFIG_ENC_KEY && env.TWIN_CONFIG_ENC_KEY.length >= MIN_ENC_SECRET_LENGTH;

  if (stored) {
    settings = {
      enabled: stored.enabled,
      providerUrl: stored.providerUrl,
      models: stored.models,
      allowPaid: stored.allowPaid,
      hasApiKey: !!stored.apiKey,
      apiKeyLast4: stored.apiKey?.last4 ?? null,
      updatedAt: stored.updatedAt,
      updatedBy: stored.updatedBy,
    };
    if (!stored.apiKey) problems.push("No API key is saved");
    else if (!encKeySet) problems.push("TWIN_CONFIG_ENC_KEY secret is missing or too short");
    else if (!(await decryptApiKey(stored.apiKey, env.TWIN_CONFIG_ENC_KEY as string, new URL(stored.providerUrl).origin))) {
      problems.push("The saved API key cannot be decrypted; enter it again");
    }
  } else {
    // Nothing saved yet: show what the environment would give (the fallback source).
    settings = {
      enabled: env.TWIN_ENABLED === "true",
      providerUrl: DEFAULT_PROVIDER_URL,
      models: parseModels(env.TWIN_MODELS) ?? [],
      allowPaid: false,
      hasApiKey: !!env.OPENROUTER_API_KEY,
      apiKeyLast4: null,
      updatedAt: null,
      updatedBy: null,
    };
    if (corrupt) problems.push(corrupt);
    else if (!env.OPENROUTER_API_KEY) problems.push("No API key is configured");
    if (!(settings.models as string[]).length) problems.push("No model is configured");
  }
  problems.push(...infraProblems(env));

  return {
    source: stored || corrupt ? "kv" : "env",
    settings,
    ready: settings.enabled === true && problems.length === 0,
    problems,
    avatarHash: await currentAvatarHash(env),
    defaults: { providerUrl: DEFAULT_PROVIDER_URL },
    encryptionSecretSet: encKeySet,
  };
}

export async function getConfigView(env: Env): Promise<AdminResult> {
  return { status: 200, body: await buildView(env, await readStored(env)) };
}

// ---------------------------------------------------------------- save

const SAVE_KEYS = new Set(["enabled", "providerUrl", "models", "allowPaid", "apiKey", "removeApiKey", "expectedUpdatedAt"]);

export async function saveConfig(env: Env, body: unknown, ctx: AdminContext): Promise<AdminResult> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(400, "invalid", "Request body must be a JSON object.");
  }
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!SAVE_KEYS.has(key)) return fail(400, "invalid", `Unknown field: ${key.slice(0, 40)}`);
  }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") return fail(400, "invalid", "enabled must be true or false.");
  if (input.allowPaid !== undefined && typeof input.allowPaid !== "boolean") return fail(400, "invalid", "allowPaid must be true or false.");
  if (input.removeApiKey !== undefined && typeof input.removeApiKey !== "boolean") return fail(400, "invalid", "removeApiKey must be true or false.");
  if (input.removeApiKey === true && input.apiKey !== undefined) return fail(400, "invalid", "Either enter a new API key or remove the saved one, not both.");

  const read = await readStored(env);
  const current = read.stored;
  // Optimistic concurrency: a save must be based on what the admin last saw (skipped when the
  // saved record is broken, so it can always be repaired).
  if (!read.corrupt) {
    const expected = input.expectedUpdatedAt ?? null;
    if (expected !== (current?.updatedAt ?? null)) {
      return fail(409, "stale", "These settings were changed somewhere else. Reload the page and try again.");
    }
  }

  const base: StoredSettings = current ?? {
    v: 1,
    enabled: false,
    providerUrl: DEFAULT_PROVIDER_URL,
    models: [],
    allowPaid: false,
    updatedAt: 0,
    updatedBy: "",
  };
  const allowPaid = typeof input.allowPaid === "boolean" ? input.allowPaid : base.allowPaid;

  const url = validateProviderUrl(input.providerUrl ?? base.providerUrl, ctx.ownHost);
  if (!url.ok) return fail(400, "invalid", url.message);
  const providerHost = new URL(url.value).hostname;
  const models = validateModels(input.models ?? base.models, allowPaid, providerHost, true);
  if (!models.ok) return fail(400, "invalid", models.message);

  const originChanged = new URL(base.providerUrl).origin !== new URL(url.value).origin;
  const changed: string[] = [];
  if ((typeof input.enabled === "boolean" ? input.enabled : base.enabled) !== base.enabled) changed.push("enabled");
  if (url.value !== base.providerUrl) changed.push("providerUrl");
  if (JSON.stringify(models.value) !== JSON.stringify(base.models)) changed.push("models");
  if (allowPaid !== base.allowPaid) changed.push("allowPaid");

  let apiKey = base.apiKey;
  if (input.removeApiKey === true) {
    if (apiKey) changed.push("apiKey:removed");
    apiKey = undefined;
  } else if (input.apiKey !== undefined) {
    const key = validateApiKey(input.apiKey);
    if (!key.ok) return fail(400, "invalid", key.message);
    const secret = env.TWIN_CONFIG_ENC_KEY;
    if (!secret || secret.length < MIN_ENC_SECRET_LENGTH) {
      return fail(
        400,
        "invalid",
        "The TWIN_CONFIG_ENC_KEY secret (32+ characters) must be set in Cloudflare before an API key can be saved. See docs/digital-twin-ops.md.",
      );
    }
    apiKey = await encryptApiKey(key.value, secret, new URL(url.value).origin);
    changed.push("apiKey:set");
  } else if (originChanged && apiKey) {
    // Never carry a saved key over to a different host: it must be entered again.
    apiKey = undefined;
    changed.push("apiKey:dropped");
  }

  const next: StoredSettings = {
    v: 1,
    enabled: typeof input.enabled === "boolean" ? input.enabled : base.enabled,
    providerUrl: url.value,
    models: models.value,
    allowPaid,
    apiKey,
    updatedAt: Math.max(Date.now(), (current?.updatedAt ?? 0) + 1),
    updatedBy: ctx.actor.slice(0, 200),
  };
  await env.CV_DATA.put(SETTINGS_KEY, JSON.stringify(next));
  resetTwinCaches();
  await writeAudit(env, {
    actor: ctx.actor,
    action: "settings_saved",
    fields: changed,
    requestId: ctx.requestId,
    ray: ctx.ray,
  });

  const view = await buildView(env, { stored: next, corrupt: null });
  const notice = changed.includes("apiKey:dropped")
    ? "The provider changed, so the saved API key was removed. Enter the key for the new provider."
    : undefined;
  return { status: 200, body: { ...view, notice } };
}

/** Reads a JSON body with a hard size limit (checked on Content-Length and on the bytes read). */
export async function readJsonLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; result: AdminResult }> {
  if (Number(request.headers.get("Content-Length") ?? "0") > maxBytes) {
    return { ok: false, result: fail(413, "too_large", "Request is too large.") };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, result: fail(413, "too_large", "Request is too large.") };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, result: fail(400, "invalid", "Body must be valid JSON.") };
  }
}

// ---------------------------------------------------------------- test connection

const TEST_INTERVAL_MS = 10_000;
const TEST_TIMEOUT_MS = 10_000;
let lastTestAt = 0;

export const resetTestThrottle = (): void => {
  lastTestAt = 0;
};

export interface TestOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Local development only: replaces the provider URL (see TWIN_UPSTREAM_URL). */
  urlOverride?: string;
}

/** One tiny completion with the SAVED settings. Returns only ok/kind: never upstream text. */
export async function testConnection(env: Env, ctx: AdminContext, opts: TestOptions = {}): Promise<AdminResult> {
  const now = (opts.now ?? Date.now)();
  if (now - lastTestAt < TEST_INTERVAL_MS) {
    const retryAfterSec = Math.ceil((TEST_INTERVAL_MS - (now - lastTestAt)) / 1000);
    return { status: 429, body: { error: "too_soon", message: `Wait ${retryAfterSec} seconds before testing again.`, retryAfterSec } };
  }
  lastTestAt = now;

  const read = await readStored(env);
  let apiKey: string | null;
  let providerUrl: string;
  let models: string[];
  let usedUpdatedAt: number | null = null;

  if (read.stored) {
    const s = read.stored;
    usedUpdatedAt = s.updatedAt;
    providerUrl = s.providerUrl;
    models = s.models;
    const secret = env.TWIN_CONFIG_ENC_KEY;
    if (!s.apiKey) return fail(400, "not_ready", "No API key is saved.");
    if (!secret || secret.length < MIN_ENC_SECRET_LENGTH) {
      return fail(400, "not_ready", "TWIN_CONFIG_ENC_KEY secret is missing or too short.");
    }
    apiKey = await decryptApiKey(s.apiKey, secret, new URL(s.providerUrl).origin);
    if (!apiKey) return fail(400, "not_ready", "The saved API key cannot be decrypted. Enter it again.");
  } else {
    if (read.corrupt) return fail(400, "not_ready", read.corrupt);
    const envModels = parseModels(env.TWIN_MODELS);
    if (!env.OPENROUTER_API_KEY || !envModels) {
      return fail(400, "not_ready", "Save an API key and a model first.");
    }
    apiKey = env.OPENROUTER_API_KEY;
    providerUrl = DEFAULT_PROVIDER_URL;
    models = envModels;
  }

  const result = await callOpenRouter({
    apiKey,
    models,
    system: "Reply with the single word OK.",
    messages: [{ role: "user", content: "ping" }],
    url: opts.urlOverride ?? providerUrl,
    timeoutMs: TEST_TIMEOUT_MS,
    fetchImpl: opts.fetchImpl,
  });
  await writeAudit(env, { actor: ctx.actor, action: result.ok ? "connection_test_ok" : `connection_test_${result.kind}`, requestId: ctx.requestId, ray: ctx.ray });
  return {
    status: 200,
    body: result.ok
      ? { ok: true, model: result.model, usedUpdatedAt }
      : { ok: false, kind: result.kind, usedUpdatedAt },
  };
}

// ---------------------------------------------------------------- avatar

export async function saveAvatar(env: Env, body: unknown, ctx: AdminContext): Promise<AdminResult> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(400, "invalid", "Request body must be a JSON object.");
  }
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (key !== "image" && key !== "reset") return fail(400, "invalid", `Unknown field: ${key.slice(0, 40)}`);
  }
  const previous = await currentAvatarHash(env);

  if (input.reset === true && input.image === undefined) {
    if (previous) await env.CV_DATA.delete(AVATAR_PREFIX + previous);
    await env.CV_DATA.delete(AVATAR_POINTER_KEY);
    resetTwinCaches();
    await writeAudit(env, { actor: ctx.actor, action: "avatar_reset", requestId: ctx.requestId, ray: ctx.ray });
    return { status: 200, body: { avatarHash: null } };
  }
  if (input.image === undefined || input.reset !== undefined) {
    return fail(400, "invalid", "Send either an image or reset: true.");
  }

  const image = parseAvatarDataUrl(input.image);
  if (!image.ok) return fail(400, "invalid", image.message);
  const hash = await avatarHash(image.value.bytes);
  const buffer = image.value.bytes.buffer.slice(
    image.value.bytes.byteOffset,
    image.value.bytes.byteOffset + image.value.bytes.byteLength,
  ) as ArrayBuffer;
  await env.CV_DATA.put(AVATAR_PREFIX + hash, buffer, { metadata: { type: image.value.type } });
  await env.CV_DATA.put(AVATAR_POINTER_KEY, hash);
  if (previous && previous !== hash) await env.CV_DATA.delete(AVATAR_PREFIX + previous);
  resetTwinCaches();
  await writeAudit(env, { actor: ctx.actor, action: "avatar_changed", requestId: ctx.requestId, ray: ctx.ray });
  return { status: 200, body: { avatarHash: hash } };
}
