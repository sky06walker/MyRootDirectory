import { type Env, isSameOriginJson, json } from "../common";
import { isAllowedHost, isLocalRequest } from "./config";
import { loadAvatarHash } from "./avatar";
import { loadCv, loadFaq, toTwinCv } from "./cv";
import { loadTwinConfig } from "./settings";
import {
  D1TwinStore,
  type TwinStore,
  checkLimits,
  getRestingUntil,
  hashIp,
  nextUtcMidnight,
  setRestingUntil,
  signSession,
  verifySession,
  verifyTurnstile,
} from "./guard";
import { callOpenRouter } from "./openrouter";
import { PROMPT_VERSION, buildSystemPrompt, filterAnswer } from "./prompt";
import { LIMITS, validateChatRequest } from "./validate";

const NO_STORE = { "Cache-Control": "no-store" };
const PROVIDER_THROTTLE_SECONDS = 60;
const PAYMENT_PAUSE_SECONDS = 900;

export interface HandlerDeps {
  store?: TwinStore;
  fetchImpl?: typeof fetch;
  /** Epoch milliseconds. */
  now?: () => number;
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Response =>
  json({ error, ...extra }, status, NO_STORE);

async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? "0") > LIMITS.maxBodyBytes) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).length > LIMITS.maxBodyBytes ? null : text;
}

/**
 * Public chat endpoint core. Order is cheapest check first. Errors are generic: neither
 * upstream text nor internals are ever echoed, and message content is never logged.
 */
export async function handleChat(
  request: Request,
  env: Env,
  deps: HandlerDeps = {},
): Promise<Response> {
  const clock = deps.now ?? Date.now;
  const started = clock();
  const nowSec = Math.floor(started / 1000);
  const rid = crypto.randomUUID();
  const meta: Record<string, unknown> = {};
  const done = (outcome: string, response: Response): Response => {
    console.log(
      JSON.stringify({
        event: "twin_chat",
        rid,
        at: new Date(started).toISOString(),
        outcome,
        total_ms: clock() - started,
        prompt_version: PROMPT_VERSION,
        ...meta, // lengths, model, ip hash: never message text
      }),
    );
    return response;
  };

  if (!isAllowedHost(request, env)) return done("forbidden_host", fail(403, "forbidden"));
  // One source of truth (kill switch > saved admin settings > environment); see settings.ts.
  const loaded = await loadTwinConfig(env);
  if (loaded.state === "disabled") return done("disabled", fail(503, "disabled"));
  if (loaded.state === "misconfigured") {
    console.error("Digital twin misconfigured:", loaded.reason);
    return done("misconfigured", fail(503, "unavailable"));
  }
  const { config } = loaded;
  meta.config_source = loaded.source;

  if (!isSameOriginJson(request)) return done("forbidden_origin", fail(403, "forbidden"));

  const bodyText = await readBody(request);
  if (bodyText === null) return done("too_large", fail(413, "too_large"));
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return done("invalid", fail(400, "invalid_request", { message: "Body must be valid JSON." }));
  }
  const validation = validateChatRequest(parsed);
  if (!validation.ok) {
    return done("invalid", fail(400, "invalid_request", { message: validation.message }));
  }
  const { messages, session, turnstileToken } = validation.value;
  meta.in_chars = messages.reduce((sum, m) => sum + m.content.length, 0);

  const store = deps.store ?? new D1TwinStore(env.TWIN_DB as D1Database);
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  let newSession: string | undefined;

  try {
    const restingUntil = await getRestingUntil(store, nowSec);
    if (restingUntil) {
      return done(
        "resting",
        fail(503, "resting", { resetsAt: new Date(restingUntil * 1000).toISOString() }),
      );
    }

    const iph = await hashIp(ip, config.hmacSecret, nowSec);
    meta.ip_hash = iph;

    // Bot check: a valid session proves Turnstile passed recently for this client.
    if (config.requireTurnstile) {
      const sessionOk = session ? await verifySession(session, iph, config.hmacSecret, nowSec) : false;
      if (!sessionOk) {
        const tokenOk = turnstileToken
          ? await verifyTurnstile(turnstileToken, config.turnstileSecret, ip, deps.fetchImpl)
          : false;
        if (!tokenOk) return done("verification_failed", fail(403, "verification_failed"));
        newSession = await signSession(iph, config.hmacSecret, nowSec);
      }
    }

    const limit = await checkLimits(store, iph, config.limits, nowSec);
    if (!limit.ok) {
      if (limit.scope === "global") {
        return done(
          "resting",
          fail(503, "resting", { resetsAt: new Date(nextUtcMidnight(nowSec) * 1000).toISOString() }),
        );
      }
      return done(
        `limited_${limit.scope}`,
        fail(429, "rate_limited", { scope: limit.scope, retryAfterSec: limit.retryAfterSec }),
      );
    }

    const [cvData, faq] = await Promise.all([loadCv(env.CV_DATA), loadFaq(env.CV_DATA)]);
    const cv = toTwinCv(cvData);
    const system = buildSystemPrompt({ cv, faq, asOf: new Date(started) });

    const result = await callOpenRouter({
      apiKey: config.apiKey,
      models: config.models,
      system,
      messages,
      dataCollectionDeny: config.dataCollectionDeny,
      url: isLocalRequest(request) && env.TWIN_UPSTREAM_URL ? env.TWIN_UPSTREAM_URL : config.providerUrl,
      fetchImpl: deps.fetchImpl,
    });

    if (!result.ok) {
      switch (result.kind) {
        case "quota_daily": {
          const until = nextUtcMidnight(nowSec);
          await setRestingUntil(store, until);
          return done(
            "upstream_quota",
            fail(503, "resting", { resetsAt: new Date(until * 1000).toISOString() }),
          );
        }
        case "payment": {
          const until = nowSec + PAYMENT_PAUSE_SECONDS;
          await setRestingUntil(store, until);
          return done(
            "upstream_payment",
            fail(503, "resting", { resetsAt: new Date(until * 1000).toISOString() }),
          );
        }
        case "rate_limited": {
          const wait = result.retryAfterSec ?? PROVIDER_THROTTLE_SECONDS;
          await setRestingUntil(store, nowSec + wait);
          return done("upstream_rate_limited", fail(503, "busy", { retryAfterSec: wait }));
        }
        case "timeout":
          return done("timeout", fail(504, "timeout"));
        default:
          return done("upstream_unavailable", fail(502, "upstream_unavailable"));
      }
    }

    const { text, filtered } = filterAnswer(result.answer, cvData.profile.name);
    meta.model_served = result.model;
    meta.out_chars = text.length;
    meta.prompt_tokens = result.promptTokens;
    meta.completion_tokens = result.completionTokens;

    return done(
      filtered ? "filtered" : "ok",
      json({ answer: text, requestId: rid, ...(newSession ? { session: newSession } : {}) }, 200, NO_STORE),
    );
  } catch (e) {
    // D1/KV failures fail CLOSED: no upstream call without working counters.
    console.error("Digital twin error:", e instanceof Error ? e.message : e);
    return done("error", fail(503, "unavailable"));
  }
}

/** Public, cheap, no quota spent: tells the launcher whether to show up and in which state. */
export async function handleStatus(request: Request, env: Env, deps: HandlerDeps = {}): Promise<Response> {
  const clock = deps.now ?? Date.now;
  const headers = { "Cache-Control": "public, max-age=30" };
  if (!isAllowedHost(request, env)) return json({ enabled: false }, 200, headers);
  const loaded = await loadTwinConfig(env);
  if (loaded.state === "misconfigured") {
    console.error("Digital twin misconfigured:", loaded.reason);
    return json({ enabled: false }, 200, headers);
  }
  if (loaded.state === "disabled") return json({ enabled: false }, 200, headers);

  // Custom avatar (set in the admin page), if any; the launcher falls back to the built-in picture.
  const avatarHash = await loadAvatarHash(env).catch(() => null);
  try {
    const store = deps.store ?? new D1TwinStore(env.TWIN_DB as D1Database);
    const restingUntil = await getRestingUntil(store, Math.floor(clock() / 1000));
    return json(
      restingUntil
        ? {
            enabled: true,
            available: false,
            reason: "resting",
            resetsAt: new Date(restingUntil * 1000).toISOString(),
            avatarHash,
          }
        : { enabled: true, available: true, avatarHash },
      200,
      headers,
    );
  } catch (e) {
    console.error("Digital twin status error:", e instanceof Error ? e.message : e);
    return json({ enabled: true, available: false, reason: "resting", avatarHash }, 200, headers);
  }
}
