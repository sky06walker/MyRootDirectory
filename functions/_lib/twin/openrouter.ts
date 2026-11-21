import type { ChatMessage } from "./validate";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type UpstreamErrorKind =
  | "quota_daily" // free-tier daily request cap reached (account-wide)
  | "rate_limited" // per-minute / provider throttling
  | "payment" // 402: credits / budget problem
  | "rejected_key" // 401/403: the provider refused the API key (or the key may not use this model)
  | "bad_request" // 400/404/422: the provider does not accept the request, usually a wrong model id
  | "unavailable" // 5xx, network error
  | "timeout"
  | "bad_response";

export type UpstreamResult =
  | {
      ok: true;
      answer: string;
      model: string;
      finish: string;
      promptTokens?: number;
      completionTokens?: number;
    }
  | { ok: false; kind: UpstreamErrorKind; retryAfterSec?: number };

interface CallOptions {
  apiKey: string;
  /** Already validated (":free" ids unless the admin allowed paid models). */
  models: string[];
  system: string;
  messages: ChatMessage[];
  dataCollectionDeny?: boolean;
  /** Full chat-completions endpoint; defaults to OpenRouter. */
  url?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const MAX_RESPONSE_BYTES = 100_000;

/** Reads at most `maxBytes` of the body (stops and cancels beyond it); null = too large. */
async function readLimited(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function classifyError(status: number, message: string): UpstreamErrorKind {
  if (status === 402) return "payment";
  if (status === 429) return /per[- ]?day|daily/i.test(message) ? "quota_daily" : "rate_limited";
  if (status === 401 || status === 403) return "rejected_key";
  if (status === 400 || status === 404 || status === 422) return "bad_request";
  return "unavailable";
}

const parseRetryAfter = (header: string | null): number | undefined => {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 3600) : undefined;
};

/** Single non-streaming chat completion. Never throws; never returns upstream text except the answer. */
export async function callOpenRouter(opts: CallOptions): Promise<UpstreamResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    messages: [{ role: "system", content: opts.system }, ...opts.messages],
    temperature: 0.2,
    max_tokens: 400,
    stream: false,
  };
  const targetUrl = opts.url ?? OPENROUTER_URL;
  let isOpenRouter = false;
  try {
    isOpenRouter = new URL(targetUrl).hostname === "openrouter.ai";
  } catch {
    return { ok: false, kind: "unavailable" };
  }
  if (isOpenRouter) {
    // OpenRouter extensions: `models` = ordered fallback list inside ONE upstream request, and an
    // optional provider-privacy preference. Other providers get the plain OpenAI-compatible body.
    if (opts.models.length > 1) body.models = opts.models;
    else body.model = opts.models[0];
    if (opts.dataCollectionDeny) body.provider = { data_collection: "deny" };
  } else {
    body.model = opts.models[0];
  }

  let res: Response;
  try {
    res = await doFetch(targetUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // The provider URL is admin-set and receives the API key: never follow a redirect to another
      // host. "manual" returns the 3xx response itself, which is rejected just below. Do not use
      // "error": the Workers runtime does not support it, and every provider call then fails.
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, kind: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable" };
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, kind: "unavailable" };

  let text: string | null;
  try {
    text = await readLimited(res, MAX_RESPONSE_BYTES);
  } catch {
    return { ok: false, kind: "unavailable" };
  }
  if (text === null) return { ok: false, kind: "bad_response" };

  let data: {
    error?: { message?: unknown; code?: unknown };
    choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
    model?: unknown;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!res.ok || data?.error) {
    const status = !res.ok ? res.status : typeof data?.error?.code === "number" ? data.error.code : 502;
    const message = typeof data?.error?.message === "string" ? data.error.message : "";
    const kind = classifyError(status, message);
    return { ok: false, kind, retryAfterSec: parseRetryAfter(res.headers.get("Retry-After")) };
  }

  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || content.trim() === "") return { ok: false, kind: "bad_response" };

  return {
    ok: true,
    answer: content,
    model: typeof data?.model === "string" ? data.model : opts.models[0],
    finish: typeof choice?.finish_reason === "string" ? choice.finish_reason : "stop",
    promptTokens: typeof data?.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : undefined,
    completionTokens:
      typeof data?.usage?.completion_tokens === "number" ? data.usage.completion_tokens : undefined,
  };
}
