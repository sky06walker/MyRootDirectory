export interface TwinStatus {
  enabled: boolean;
  available?: boolean;
  reason?: string;
  resetsAt?: string;
  /** Hash of the custom avatar set in the admin page; null/absent = built-in picture. */
  avatarHash?: string | null;
}

export interface TwinMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AskErrorCode =
  | 'rate_limited'
  | 'resting'
  | 'busy'
  | 'timeout'
  | 'invalid_request'
  | 'verification_failed'
  | 'unavailable'
  | 'network';

export type AskResult =
  | { ok: true; answer: string; session?: string }
  | { ok: false; code: AskErrorCode; retryAfterSec?: number; resetsAt?: string; message?: string };

/** Never throws: any failure means "no twin" and the page simply shows no avatar. */
export async function fetchTwinStatus(): Promise<TwinStatus> {
  try {
    const res = await fetch('/api/chat/status');
    if (!res.ok) return { enabled: false };
    const data = (await res.json()) as TwinStatus;
    return data && data.enabled === true ? data : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

const KNOWN_CODES: AskErrorCode[] = [
  'rate_limited', 'resting', 'busy', 'timeout', 'invalid_request', 'verification_failed', 'unavailable',
];

export async function askTwin(
  messages: TwinMessage[],
  session?: string,
  turnstileToken?: string,
): Promise<AskResult> {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, session, turnstileToken }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && typeof data.answer === 'string') {
      return { ok: true, answer: data.answer, session: typeof data.session === 'string' ? data.session : undefined };
    }
    const code = KNOWN_CODES.find((c) => c === data.error) ?? 'unavailable';
    return {
      ok: false,
      code,
      retryAfterSec: typeof data.retryAfterSec === 'number' ? data.retryAfterSec : undefined,
      resetsAt: typeof data.resetsAt === 'string' ? data.resetsAt : undefined,
      message: typeof data.message === 'string' ? data.message : undefined,
    };
  } catch {
    return { ok: false, code: 'network' };
  }
}
