import { type Env, json } from "../../_lib/common";
import { AVATAR_PREFIX, loadAvatarHash } from "../../_lib/twin/avatar";

const TYPES = new Set(["image/png", "image/webp"]);

// Public. Serves the custom avatar saved from the admin page. The URL carries the picture's
// content hash (?h=...), so it is immutable and cacheable; a stale or wrong hash is a 404 and the
// launcher falls back to the built-in picture. Hardened because it serves user-supplied bytes:
// type from our own stored metadata (PNG/WebP only, checked at upload), nosniff, sandboxing CSP.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const requested = new URL(request.url).searchParams.get("h");
  const current = await loadAvatarHash(env);
  if (!requested || !current || requested !== current) return json({ error: "Not found" }, 404);

  const blob = await env.CV_DATA.getWithMetadata<{ type?: string }>(AVATAR_PREFIX + current, "arrayBuffer");
  const type = blob.metadata?.type;
  if (!blob.value || !type || !TYPES.has(type)) return json({ error: "Not found" }, 404);

  return new Response(blob.value, {
    headers: {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
