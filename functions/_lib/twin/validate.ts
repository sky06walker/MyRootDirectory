export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  session?: string;
  turnstileToken?: string;
}

export const LIMITS = {
  maxBodyBytes: 16 * 1024,
  maxMessages: 12, // 6 turns
  maxUserChars: 500,
  maxAssistantChars: 2000,
  maxTotalChars: 8000,
  maxSessionChars: 600,
  maxTokenChars: 2048,
} as const;

export type Validation =
  | { ok: true; value: ChatRequest }
  | { ok: false; message: string };

const ALLOWED_KEYS = new Set(["messages", "session", "turnstileToken"]);

/** NFC-normalise, drop control characters except newline/tab, trim. */
export function cleanText(text: string): string {
  return text
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

const fail = (message: string): Validation => ({ ok: false, message });

export function validateChatRequest(raw: unknown): Validation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("Request body must be a JSON object.");
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return fail(`Unknown field: ${key.slice(0, 40)}`);
  }

  const { messages, session, turnstileToken } = body;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > LIMITS.maxMessages) {
    return fail(`messages must contain 1 to ${LIMITS.maxMessages} items.`);
  }

  const cleaned: ChatMessage[] = [];
  let total = 0;
  for (const item of messages) {
    if (typeof item !== "object" || item === null) return fail("Invalid message.");
    const { role, content, ...rest } = item as Record<string, unknown>;
    if (Object.keys(rest).length > 0) return fail("Invalid message fields.");
    if (role !== "user" && role !== "assistant") return fail("Invalid message role.");
    if (typeof content !== "string") return fail("Message content must be text.");

    const text = cleanText(content);
    const max = role === "user" ? LIMITS.maxUserChars : LIMITS.maxAssistantChars;
    if (text.length < 1) return fail("Message is empty.");
    if (text.length > max) return fail(`Message is too long (max ${max} characters).`);
    total += text.length;
    cleaned.push({ role, content: text });
  }

  if (total > LIMITS.maxTotalChars) return fail("Conversation is too long.");
  if (cleaned[cleaned.length - 1].role !== "user") return fail("The last message must be from the user.");

  if (session !== undefined && (typeof session !== "string" || session.length > LIMITS.maxSessionChars)) {
    return fail("Invalid session.");
  }
  if (
    turnstileToken !== undefined &&
    (typeof turnstileToken !== "string" || turnstileToken.length > LIMITS.maxTokenChars)
  ) {
    return fail("Invalid verification token.");
  }

  return { ok: true, value: { messages: cleaned, session, turnstileToken } };
}
