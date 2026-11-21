import {
  type AdminData,
  type Env,
  authenticate,
  isSameOriginJson,
  json,
} from "../../_lib/common";

const NO_STORE = { "Cache-Control": "no-store" };

// Single choke point for everything under /api/admin/*: a new admin route cannot be
// added without authentication, and unmatched paths are covered too.
export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const admin = await authenticate(context.request, context.env);
  if (!admin) {
    return json({ error: "Unauthorized" }, 401, NO_STORE);
  }
  if (!isSameOriginJson(context.request)) {
    return json({ error: "Forbidden" }, 403, NO_STORE);
  }

  context.data.admin = admin;

  const response = await context.next();
  const guarded = new Response(response.body, response);
  guarded.headers.set("Cache-Control", "no-store");
  return guarded;
};
