import React, { useEffect, useId, useState } from 'react';
import {
  loadTwinAdmin,
  resetTwinAvatar,
  saveTwinAvatar,
  saveTwinSettings,
  testTwinConnection,
  type TwinAdminState,
} from '../../utils/twinAdminApi';

const MODEL_SLOTS = 3;
const AVATAR_SIZE = 192;
const AVATAR_MAX_BYTES = 100 * 1024;

const TEST_FAILURE_TEXT: Record<string, string> = {
  quota_daily: 'The provider says the daily free limit is used up.',
  rate_limited: 'The provider is limiting requests right now. Try again in a minute.',
  payment: 'The provider refused: a credits or billing problem.',
  rejected_key: 'The provider refused the API key (or this key is not allowed to use that model). Check the key and paste it again.',
  bad_request: 'The provider does not accept the request. Most often a model id is wrong: check every model id (OpenRouter ids look like vendor/model:free, or use openrouter/free) and the provider URL.',
  unavailable: 'Could not reach the provider, or it had an internal error. Check the provider URL and try again in a minute.',
  timeout: 'The provider took too long to answer.',
  bad_response: 'The provider answered in a way the twin cannot use.',
};

const approxBytes = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

/** Centre-crops to a square, shrinks to 192x192 and encodes as WebP (PNG fallback) under 100 KB. */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  if (file.size > 10 * 1024 * 1024) throw new Error('That image is too large (10 MB at most).');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('That image could not be read. Try a PNG, JPEG or WebP file.');
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot resize images.');
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  for (const quality of [0.92, 0.8, 0.65, 0.5]) {
    const url = canvas.toDataURL('image/webp', quality);
    if (url.startsWith('data:image/webp') && approxBytes(url) <= AVATAR_MAX_BYTES) return url;
  }
  const png = canvas.toDataURL('image/png');
  if (approxBytes(png) <= AVATAR_MAX_BYTES) return png;
  throw new Error('That picture is too detailed to shrink under 100 KB. Try a simpler one.');
}

interface FormState {
  enabled: boolean;
  providerUrl: string;
  models: string[];
  allowPaid: boolean;
  apiKey: string;
  removeApiKey: boolean;
}

const formFrom = (state: TwinAdminState): FormState => ({
  enabled: state.settings.enabled,
  providerUrl: state.settings.providerUrl,
  models: [...state.settings.models, ...Array(MODEL_SLOTS).fill('')].slice(0, MODEL_SLOTS),
  allowPaid: state.settings.allowPaid,
  apiKey: '',
  removeApiKey: false,
});

type Message = { kind: 'ok' | 'error'; text: string };

export const TwinSettings: React.FC = () => {
  const id = useId();
  const [state, setState] = useState<TwinAdminState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'avatar' | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [stale, setStale] = useState(false);
  const [testResult, setTestResult] = useState<Message | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);

  const apply = (next: TwinAdminState) => {
    setState(next);
    setForm(formFrom(next));
  };

  const reload = () => {
    setStale(false);
    setMessage(null);
    loadTwinAdmin().then((r) => (r.ok ? apply(r.data) : setLoadError(r.message)));
  };

  useEffect(() => {
    loadTwinAdmin().then((r) => (r.ok ? apply(r.data) : setLoadError(r.message)));
  }, []);

  if (loadError) {
    return (
      <div className="card">
        <h3>Digital twin (AI chat)</h3>
        <p role="alert" style={{ color: 'red' }}>{loadError}</p>
      </div>
    );
  }
  if (!state || !form) {
    return (
      <div className="card">
        <h3>Digital twin (AI chat)</h3>
        <p>Loading…</p>
      </div>
    );
  }

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  const save = async () => {
    setBusy('save');
    setMessage(null);
    setTestResult(null);
    const result = await saveTwinSettings({
      enabled: form.enabled,
      providerUrl: form.providerUrl.trim(),
      models: form.models.map((m) => m.trim()).filter(Boolean),
      allowPaid: form.allowPaid,
      ...(form.apiKey ? { apiKey: form.apiKey } : {}),
      ...(form.removeApiKey ? { removeApiKey: true } : {}),
      expectedUpdatedAt: state.settings.updatedAt,
    });
    setBusy(null);
    if (result.ok) {
      apply(result.data);
      setMessage({ kind: 'ok', text: result.data.notice ?? 'Saved. Visitors see the change within a minute or two.' });
    } else {
      setStale(result.status === 409);
      setMessage({ kind: 'error', text: result.message });
    }
  };

  const test = async () => {
    setBusy('test');
    setTestResult(null);
    const result = await testTwinConnection();
    setBusy(null);
    if (!result.ok) setTestResult({ kind: 'error', text: result.message });
    else if (result.data.ok) setTestResult({ kind: 'ok', text: `It works. The provider answered using ${result.data.model ?? 'the model'}.` });
    else setTestResult({ kind: 'error', text: TEST_FAILURE_TEXT[result.data.kind ?? ''] ?? 'The test failed.' });
  };

  const chooseFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMessage(null);
    try {
      setPendingAvatar(await fileToAvatarDataUrl(file));
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'That image could not be used.' });
    }
  };

  const changeAvatar = async (action: 'save' | 'reset') => {
    setBusy('avatar');
    const result = action === 'save' && pendingAvatar ? await saveTwinAvatar(pendingAvatar) : await resetTwinAvatar();
    setBusy(null);
    if (result.ok) {
      setState({ ...state, avatarHash: result.data.avatarHash });
      setPendingAvatar(null);
      setMessage({ kind: 'ok', text: action === 'save' ? 'Avatar saved. Visitors see it within a minute or two.' : 'Back to the built-in avatar.' });
    } else {
      setMessage({ kind: 'error', text: result.message });
    }
  };

  const isOpenRouter = /^https:\/\/openrouter\.ai\//i.test(form.providerUrl.trim());
  const avatarSrc = pendingAvatar ?? (state.avatarHash ? `/api/twin/avatar?h=${state.avatarHash}` : '/twin/avatar-128.png');
  const statusText = !state.settings.enabled
    ? 'Off: visitors do not see the twin.'
    : state.ready
      ? 'On and ready: visitors can chat.'
      : `On, but not ready: ${state.problems.join('; ')}.`;

  return (
    <div className="card">
      <h3>Digital twin (AI chat)</h3>
      <p role="status" style={{ fontWeight: 'bold' }}>{statusText}</p>
      {state.source === 'env' && (
        <p style={{ fontSize: '0.85rem' }}>
          Currently using the values from your Cloudflare settings. Saving below switches to the values on this page.
        </p>
      )}
      {!state.ready && state.settings.enabled === false && state.problems.length > 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
          Before you switch it on: {state.problems.join('; ')}.
        </p>
      )}

      <div className="form-group">
        <label>
          <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Show the digital
          twin to visitors
        </label>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-url`}>AI provider URL</label>
        <input id={`${id}-url`} className="form-input" value={form.providerUrl} onChange={(e) => set({ providerUrl: e.target.value })} spellCheck={false} />
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
          The full chat-completions address, https only. Default: {state.defaults.providerUrl}. If you change the provider you must enter its key again.
        </p>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-model-0`}>AI model</label>
        {form.models.map((model, index) => (
          <input
            key={index}
            id={`${id}-model-${index}`}
            className="form-input"
            style={{ marginBottom: '0.5rem' }}
            placeholder={index === 0 ? 'Model id (required)' : `Fallback model ${index} (optional)`}
            aria-label={index === 0 ? 'AI model' : `Fallback model ${index}`}
            value={model}
            onChange={(e) => set({ models: form.models.map((m, i) => (i === index ? e.target.value : m)) })}
            spellCheck={false}
          />
        ))}
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
          OpenRouter free models look like <code>vendor/model:free</code>. For the automatic free mode use <code>openrouter/free</code>.
          Models are tried in order{isOpenRouter ? '' : ' (only the first is used with this provider)'}.
        </p>
        <label>
          <input type="checkbox" checked={form.allowPaid} onChange={(e) => set({ allowPaid: e.target.checked })} /> Allow paid models
        </label>
        {(form.allowPaid || !isOpenRouter) && (
          <p role="note" style={{ fontSize: '0.8rem', color: '#b45309' }}>
            Warning: with paid models, or any provider other than OpenRouter, the free-only protection is off and each visitor
            question may cost you money. Set a spending limit at the provider, and keep the daily cap low.
          </p>
        )}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-key`}>AI API key</label>
        <input
          id={`${id}-key`}
          className="form-input"
          type="password"
          autoComplete="new-password"
          value={form.apiKey}
          disabled={form.removeApiKey}
          placeholder={
            state.source === 'env' && state.settings.hasApiKey
              ? 'Using the key from your Cloudflare settings. Type to replace it.'
              : state.settings.hasApiKey
                ? `Saved (ends in ${state.settings.apiKeyLast4 ?? '····'}). Type to replace it.`
                : 'Paste the key from your AI provider'
          }
          onChange={(e) => set({ apiKey: e.target.value })}
        />
        {state.source === 'kv' && state.settings.hasApiKey && (
          <label style={{ display: 'block', marginTop: '0.4rem' }}>
            <input type="checkbox" checked={form.removeApiKey} onChange={(e) => set({ removeApiKey: e.target.checked, apiKey: '' })} /> Remove the saved
            key when I save
          </label>
        )}
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
          The key is encrypted before it is stored and can never be shown again, only replaced or removed.
        </p>
        {!state.encryptionSecretSet && (
          <p role="alert" style={{ fontSize: '0.85rem', color: 'red' }}>
            The TWIN_CONFIG_ENC_KEY secret is not set in Cloudflare, so a key cannot be saved yet (see docs/digital-twin-ops.md).
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn" onClick={save} disabled={busy !== null}>{busy === 'save' ? 'Saving…' : 'Save twin settings'}</button>
        <button className="btn" onClick={test} disabled={busy !== null} style={{ backgroundColor: '#4b5563' }}>
          {busy === 'test' ? 'Testing…' : 'Test saved settings'}
        </button>
        {stale && <button className="btn" onClick={reload} style={{ backgroundColor: '#4b5563' }}>Reload settings</button>}
      </div>
      {testResult && (
        <p role="status" style={{ color: testResult.kind === 'ok' ? 'green' : 'red', marginTop: '0.5rem' }}>{testResult.text}</p>
      )}
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} style={{ color: message.kind === 'ok' ? 'green' : 'red', marginTop: '0.5rem' }}>
          {message.text}
        </p>
      )}

      <hr style={{ margin: '1.25rem 0', border: 0, borderTop: '1px solid var(--color-border)' }} />

      <div className="form-group">
        <span className="form-label">Avatar</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <img src={avatarSrc} alt="Current avatar" width={64} height={64} style={{ borderRadius: '50%', objectFit: 'cover' }} />
          <div>
            <input type="file" accept="image/*" aria-label="Choose a new avatar picture" onChange={chooseFile} />
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
              Any picture: it is cropped to a square and shrunk automatically.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          {pendingAvatar && (
            <>
              <button className="btn" onClick={() => changeAvatar('save')} disabled={busy !== null}>{busy === 'avatar' ? 'Saving…' : 'Save this avatar'}</button>
              <button className="btn" onClick={() => setPendingAvatar(null)} disabled={busy !== null} style={{ backgroundColor: '#4b5563' }}>Cancel</button>
            </>
          )}
          {!pendingAvatar && state.avatarHash && (
            <button className="btn" onClick={() => changeAvatar('reset')} disabled={busy !== null} style={{ backgroundColor: '#4b5563' }}>Use the built-in avatar</button>
          )}
        </div>
      </div>
    </div>
  );
};
