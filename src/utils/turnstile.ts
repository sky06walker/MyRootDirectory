// Cloudflare Turnstile loader. The script is fetched only when a visitor sends their first
// message, never with the page. Without VITE_TURNSTILE_SITE_KEY nothing is loaded (the server
// then has to run with TWIN_REQUIRE_TURNSTILE=false, i.e. local development only).

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TIMEOUT_MS = 30_000;

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // allow a retry
      reject(new Error('Turnstile failed to load'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Resolves with a one-time token, or undefined when Turnstile is not configured for this build. */
export async function getTurnstileToken(container: HTMLElement): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  await loadScript();
  const api = window.turnstile;
  if (!api) throw new Error('Turnstile unavailable');

  return new Promise<string>((resolve, reject) => {
    const widget: { id?: string } = {};
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      if (widget.id) api.remove(widget.id);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('Turnstile timed out'))), TIMEOUT_MS);
    widget.id = api.render(container, {
      sitekey: SITE_KEY,
      execution: 'execute',
      appearance: 'interaction-only', // visible only if an interactive challenge is needed
      callback: (token: string) => finish(() => resolve(token)),
      'error-callback': () => finish(() => reject(new Error('Turnstile error'))),
      'timeout-callback': () => finish(() => reject(new Error('Turnstile expired'))),
    });
    api.execute(widget.id);
  });
}
