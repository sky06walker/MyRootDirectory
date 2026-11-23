/**
 * Cloudflare Access only sits in front of the hosts listed in the Access application, which is
 * `myrootdirectory.pages.dev`. On any other public host (a custom domain) the admin cannot sign in,
 * so the admin link and the /admin route send the visitor to the canonical admin origin instead.
 *
 * The target is a constant, never derived from the URL, so this cannot be used as an open redirect.
 * Pure (no DOM) so it can be unit-tested.
 */
export const ADMIN_ORIGIN = "https://myrootdirectory.pages.dev";
const ADMIN_HOST = new URL(ADMIN_ORIGIN).hostname;

const isLocalHost = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");

/** The absolute admin URL to use from `hostname`, or null when /admin works on this host itself. */
export function adminRedirectTarget(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (host === ADMIN_HOST || isLocalHost(host)) return null;
  // Per-deployment and preview hosts (<hash>.myrootdirectory.pages.dev) stay as they are.
  if (host.endsWith(`.${ADMIN_HOST}`)) return null;
  return `${ADMIN_ORIGIN}/admin`;
}
