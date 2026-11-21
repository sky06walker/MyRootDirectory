import { type AdminData, type Env, json } from "../../../_lib/common";
import { readJsonLimited, saveAvatar } from "../../../_lib/twin/admin";
import { AVATAR_MAX_DATA_URL_CHARS } from "../../../_lib/twin/avatar";

const NO_STORE = { "Cache-Control": "no-store" };

// The image arrives as JSON ({ image: "data:image/webp;base64,..." }) because the admin
// middleware only accepts application/json for writes. { reset: true } restores the built-in picture.
export const onRequestPost: PagesFunction<Env, string, AdminData> = async ({ request, env, data }) => {
  const body = await readJsonLimited(request, AVATAR_MAX_DATA_URL_CHARS + 1024);
  if (!body.ok) return json(body.result.body, body.result.status, NO_STORE);
  const result = await saveAvatar(env, body.value, {
    actor: data.admin.actor,
    requestId: crypto.randomUUID(),
    ray: request.headers.get("CF-Ray") ?? undefined,
    ownHost: new URL(request.url).hostname,
  });
  return json(result.body, result.status, NO_STORE);
};
