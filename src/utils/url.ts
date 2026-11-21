/**
 * Returns the URL only if it is an http(s) link, otherwise undefined.
 * CV content is admin-editable data, so it must never be able to inject
 * `javascript:` / `data:` URLs into an href.
 */
export function safeHref(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url, window.location.origin);
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
