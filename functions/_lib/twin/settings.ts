import { type Env, base64UrlToBytes, bytesToBase64Url } from "../common";
import {
  MAX_MODELS,
  MODEL_CHARSET,
  OPENROUTER_HOST,
  type TwinConfig,
  readConfig,
  readInfra,
} from "./config";
import { cached, isKilled } from "./cv";

// Settings saved from the admin page: ONE KV record (`twin_config`) holding the non-secret
// settings together with the encrypted API key, so a reader can never see a new provider URL
// next to an old key. The key is AES-GCM encrypted with a key derived from the dedicated
// TWIN_CONFIG_ENC_KEY secret and bound (as additional authenticated data) to the provider
// origin: a ciphertext moved to another host fails to decrypt.

export const SETTINGS_KEY = "twin_config";

export interface StoredKey {
  v: 1;
  iv: string;
  ct: string;
  last4: string;
}

export interface StoredSettings {
  v: 1;
  enabled: boolean;
  /** Full chat-completions endpoint. */
  providerUrl: string;
  models: string[];
  /** Admin accepted that models/providers outside the free-only guard may cost money. */
  allowPaid: boolean;
  apiKey?: StoredKey;
  /** Milliseconds since epoch; also the optimistic-concurrency token. */
  updatedAt: number;
  updatedBy: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };
const bad = (message: string): { ok: false; message: string } => ({ ok: false, message });

// ---------------------------------------------------------------- validation

/**
 * The URL is the FULL chat-completions endpoint. Strict on purpose: it receives the API key.
 * `ownHost` (the site's own host name) is rejected so the twin cannot be pointed at itself.
 */
export function validateProviderUrl(input: unknown, ownHost?: string): Checked<string> {
  if (typeof input !== "string" || input.length === 0 || input.length > 300) {
    return bad("Provider URL must be 1 to 300 characters.");
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return bad("Provider URL is not a valid URL.");
  }
  if (url.protocol !== "https:") return bad("Provider URL must start with https://");
  if (url.username || url.password) return bad("Provider URL must not contain a user name or password.");
  if (url.port) return bad("Provider URL must not use a custom port.");
  if (url.search || url.hash) return bad("Provider URL must not contain ? or # parts.");

  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || /^[\d.]+$/.test(host)) return bad("Use a host name, not an IP address.");
  if (
    !host.includes(".") ||
    host.endsWith(".") ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return bad("Provider host must be a public domain name.");
  }
  if (ownHost && host === ownHost.toLowerCase()) return bad("Provider URL cannot point at this site itself.");
  if (url.pathname.length < 2) {
    return bad(
      "Provider URL must be the full chat-completions endpoint, for example https://openrouter.ai/api/v1/chat/completions",
    );
  }
  return { ok: true, value: url.href };
}

/** `providerHost` decides which cost guard applies: free-only is only meaningful on OpenRouter. */
export function validateModels(input: unknown, allowPaid: boolean, providerHost: string): Checked<string[]> {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_MODELS) {
    return bad(`Enter 1 to ${MAX_MODELS} model ids.`);
  }
  const models: string[] = [];
  for (const item of input) {
    const model = typeof item === "string" ? item.trim() : "";
    if (!MODEL_CHARSET.test(model)) return bad("A model id contains characters that are not allowed.");
    if (models.includes(model)) return bad("Model ids must be different from each other.");
    models.push(model);
  }
  if (providerHost !== OPENROUTER_HOST && !allowPaid) {
    return bad(
      "The free-only protection only covers OpenRouter. For any other provider, tick \"allow paid models\" to confirm you accept possible charges.",
    );
  }
  if (!allowPaid && !models.every((m) => m.endsWith(":free"))) {
    return bad("Model ids must end in :free, unless you tick \"allow paid models\" (which may cost money).");
  }
  return { ok: true, value: models };
}

export function validateApiKey(input: unknown): Checked<string> {
  if (typeof input !== "string" || !/^[\x21-\x7e]{8,400}$/.test(input)) {
    return bad("API key must be 8 to 400 visible characters without spaces.");
  }
  return { ok: true, value: input };
}

// ---------------------------------------------------------------- key encryption

const encoder = new TextEncoder();
export const MIN_ENC_SECRET_LENGTH = 32;

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("twin-config-v1"),
      info: encoder.encode("api-key-aes-gcm"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const aad = (origin: string): Uint8Array => encoder.encode(`twin-api-key-v1|${origin}`);

export async function encryptApiKey(apiKey: string, secret: string, origin: string): Promise<StoredKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(origin) },
    await deriveKey(secret),
    encoder.encode(apiKey),
  );
  return { v: 1, iv: bytesToBase64Url(iv), ct: bytesToBase64Url(new Uint8Array(ct)), last4: apiKey.slice(-4) };
}

/** Null when the secret changed, the provider origin differs, or the record was tampered with. */
export async function decryptApiKey(stored: StoredKey, secret: string, origin: string): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(stored.iv), additionalData: aad(origin) },
      await deriveKey(secret),
      base64UrlToBytes(stored.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- stored record

const isStoredKey = (v: unknown): v is StoredKey => {
  const k = v as Partial<StoredKey> | null;
  return (
    typeof k === "object" &&
    k !== null &&
    k.v === 1 &&
    typeof k.iv === "string" &&
    typeof k.ct === "string" &&
    typeof k.last4 === "string" &&
    k.last4.length <= 4
  );
};

/** Defensive: a stored record that does not validate is treated as broken (fail closed), never trusted. */
export function parseStoredSettings(raw: string): Checked<StoredSettings> {
  let data: Partial<StoredSettings>;
  try {
    data = JSON.parse(raw) as Partial<StoredSettings>;
  } catch {
    return bad("Saved settings are not valid JSON.");
  }
  if (!data || data.v !== 1) return bad("Saved settings have an unknown version.");
  if (typeof data.enabled !== "boolean" || typeof data.allowPaid !== "boolean") {
    return bad("Saved settings are incomplete.");
  }
  const url = validateProviderUrl(data.providerUrl);
  if (!url.ok) return bad(`Saved provider URL is invalid: ${url.message}`);
  const models = validateModels(data.models, data.allowPaid, new URL(url.value).hostname);
  if (!models.ok) return bad(`Saved models are invalid: ${models.message}`);
  if (data.apiKey !== undefined && !isStoredKey(data.apiKey)) return bad("Saved API key record is malformed.");
  if (typeof data.updatedAt !== "number" || !Number.isFinite(data.updatedAt)) {
    return bad("Saved settings have no timestamp.");
  }
  return {
    ok: true,
    value: {
      v: 1,
      enabled: data.enabled,
      providerUrl: url.value,
      models: models.value,
      allowPaid: data.allowPaid,
      apiKey: data.apiKey,
      updatedAt: data.updatedAt,
      updatedBy: typeof data.updatedBy === "string" ? data.updatedBy.slice(0, 200) : "",
    },
  };
}

// ---------------------------------------------------------------- effective configuration

export type LoadResult =
  | { state: "ready"; config: TwinConfig; source: "kv" | "env" }
  | { state: "disabled" }
  | { state: "misconfigured"; reason: string; source: "kv" | "env" };

/**
 * One source of truth, never a field-by-field mix:
 *  1. kill switch (KV `twin_disabled` = 1) always wins;
 *  2. if a settings record exists in KV it is the ONLY source (invalid or undecryptable = off);
 *  3. otherwise environment variables (TWIN_ENABLED, TWIN_MODELS, OPENROUTER_API_KEY) as before.
 * The environment API key is only ever used with the built-in OpenRouter endpoint.
 */
export async function loadTwinConfig(env: Env): Promise<LoadResult> {
  if (await isKilled(env.CV_DATA)) return { state: "disabled" };

  const raw = await cached("settings", () => env.CV_DATA.get(SETTINGS_KEY));
  if (raw === null) {
    if (env.TWIN_ENABLED !== "true") return { state: "disabled" };
    const fromEnv = readConfig(env);
    return fromEnv.ok
      ? { state: "ready", config: fromEnv.config, source: "env" }
      : { state: "misconfigured", reason: fromEnv.reason, source: "env" };
  }

  const parsed = parseStoredSettings(raw);
  if (!parsed.ok) return { state: "misconfigured", reason: parsed.message, source: "kv" };
  const settings = parsed.value;
  if (!settings.enabled) return { state: "disabled" };

  const misconfigured = (reason: string): LoadResult => ({ state: "misconfigured", reason, source: "kv" });
  if (!settings.apiKey) return misconfigured("No API key is saved");
  const encSecret = env.TWIN_CONFIG_ENC_KEY;
  if (!encSecret || encSecret.length < MIN_ENC_SECRET_LENGTH) {
    return misconfigured("TWIN_CONFIG_ENC_KEY secret is missing or too short");
  }
  const apiKey = await decryptApiKey(settings.apiKey, encSecret, new URL(settings.providerUrl).origin);
  if (!apiKey) return misconfigured("The saved API key cannot be decrypted; enter it again in the admin page");

  const infra = readInfra(env);
  if (!infra.ok) return misconfigured(infra.reason);

  return {
    state: "ready",
    source: "kv",
    config: {
      apiKey,
      providerUrl: settings.providerUrl,
      models: settings.models,
      allowPaid: settings.allowPaid,
      ...infra.config,
    },
  };
}
