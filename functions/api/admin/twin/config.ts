import { type AdminData, type Env, json } from "../../../_lib/common";
import { getConfigView, readJsonLimited, saveConfig } from "../../../_lib/twin/admin";

// Authentication and the CSRF guard are applied by functions/api/admin/_middleware.ts.
const NO_STORE = { "Cache-Control": "no-store" };

export const onRequestGet: PagesFunction<Env, string, AdminData> = async ({ env }) => {
  const result = await getConfigView(env);
  return json(result.body, result.status, NO_STORE);
};

export const onRequestPost: PagesFunction<Env, string, AdminData> = async ({ request, env, data }) => {
  const body = await readJsonLimited(request, 8 * 1024);
  if (!body.ok) return json(body.result.body, body.result.status, NO_STORE);
  const result = await saveConfig(env, body.value, {
    actor: data.admin.actor,
    requestId: crypto.randomUUID(),
    ray: request.headers.get("CF-Ray") ?? undefined,
    ownHost: new URL(request.url).hostname,
  });
  return json(result.body, result.status, NO_STORE);
};
