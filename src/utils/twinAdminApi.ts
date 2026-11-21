// Client for the admin-only Digital twin settings API (/api/admin/twin/*). It sits behind
// Cloudflare Access: without a valid sign-in the request is redirected, so we use
// redirect: 'manual' and report "not signed in" instead of failing mysteriously.
// The API never returns the AI API key; this client never stores it beyond the form field.

export interface TwinSettingsView {
  enabled: boolean;
  providerUrl: string;
  models: string[];
  allowPaid: boolean;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface TwinAdminState {
  source: 'kv' | 'env';
  settings: TwinSettingsView;
  ready: boolean;
  problems: string[];
  avatarHash: string | null;
  defaults: { providerUrl: string };
  encryptionSecretSet: boolean;
  notice?: string;
}

export interface TwinSavePayload {
  enabled: boolean;
  providerUrl: string;
  models: string[];
  allowPaid: boolean;
  apiKey?: string;
  removeApiKey?: boolean;
  expectedUpdatedAt: number | null;
}

export interface TwinTestResult {
  ok: boolean;
  model?: string;
  kind?: string;
}

export type AdminCall<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; signedOut?: boolean };

async function call<T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<AdminCall<T>> {
  try {
    const res = await fetch(`/api/admin/twin${path}`, {
      method: init?.method ?? 'GET',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: init ? JSON.stringify(init.body) : undefined,
    });
    if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, signedOut: true, message: 'Your sign-in has expired. Open /admin in a new tab to sign in again.' };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data: data as T };
    return {
      ok: false,
      status: res.status,
      message: typeof data.message === 'string' ? data.message : `The server answered ${res.status}.`,
    };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server. Check your connection.' };
  }
}

export const loadTwinAdmin = () => call<TwinAdminState>('/config');
export const saveTwinSettings = (payload: TwinSavePayload) =>
  call<TwinAdminState>('/config', { method: 'POST', body: payload });
export const testTwinConnection = () => call<TwinTestResult>('/test', { method: 'POST', body: {} });
export const saveTwinAvatar = (image: string) =>
  call<{ avatarHash: string | null }>('/avatar', { method: 'POST', body: { image } });
export const resetTwinAvatar = () =>
  call<{ avatarHash: string | null }>('/avatar', { method: 'POST', body: { reset: true } });
