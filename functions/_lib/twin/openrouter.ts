import type { ChatMessage } from "./validate";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type UpstreamErrorKind =
  | "quota_daily" // free-tier daily request cap reached (account-wide)
  | "rate_limited" // per-minute / provider throttling
  | "payment" // 402: credits / budget problem
  | "unavailable" // 5xx, network error, auth/config problem
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
  /** Already validated as ":free" ids. */
  models: string[];
  system: string;
  messages: ChatMessage[];
  dataCollectionDeny?: boolean;
  url?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const MAX_RESPONSE_CHARS = 100_000;

export function classifyError(status: number, message: string): UpstreamErrorKind {
  if (status === 402) return "payment";
  if (status === 429) return /per[- ]?day|daily/i.test(message) ? "quota_daily" : "rate_limited";
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
  // `models` = ordered fallback list inside ONE upstream request (all ids are :free).
  if (opts.models.length > 1) body.models = opts.models;
  else body.model = opts.models[0];
  if (opts.dataCollectionDeny) body.provider = { data_collection: "deny" };

  let res: Response;
  try {
    res = await doFetch(opts.url ?? OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, kind: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable" };
  }

  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, kind: "unavailable" };
  }
  if (text.length > MAX_RESPONSE_CHARS) return { ok: false, kind: "bad_response" };

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
