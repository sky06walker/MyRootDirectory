import { type AdminData, type Env, json } from "../../../_lib/common";
import { isLocalRequest } from "../../../_lib/twin/config";
import { testConnection } from "../../../_lib/twin/admin";

const NO_STORE = { "Cache-Control": "no-store" };

// Sends one tiny request with the SAVED settings. Throttled; never returns upstream text.
export const onRequestPost: PagesFunction<Env, string, AdminData> = async ({ request, env, data }) => {
  const result = await testConnection(
    env,
    {
      actor: data.admin.actor,
      requestId: crypto.randomUUID(),
      ray: request.headers.get("CF-Ray") ?? undefined,
      ownHost: new URL(request.url).hostname,
    },
    { urlOverride: isLocalRequest(request) && env.TWIN_UPSTREAM_URL ? env.TWIN_UPSTREAM_URL : undefined },
  );
  return json(result.body, result.status, NO_STORE);
};
