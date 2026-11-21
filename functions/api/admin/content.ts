import { type AdminData, type Env, json } from "../../_lib/common";

const CONTENT_KEY = "cv_content";

// Authentication / CSRF checks happen in _middleware.ts before this runs.
export const onRequestPost: PagesFunction<Env, string, AdminData> = async ({
  request,
  env,
  data,
}) => {
  try {
    const body = await request.json();
    await env.CV_DATA.put(CONTENT_KEY, JSON.stringify(body));
    // Audit trail: who changed the public content, and when (no content logged).
    console.log(
      JSON.stringify({
        event: "cv_content_updated",
        actor: data.admin.actor,
        at: new Date().toISOString(),
      }),
    );
    return json({ success: true });
  } catch (e) {
    // Log details server-side only; do not echo internals back to the client.
    console.error("Save Error:", e);
    return json({ error: "Failed to save data" }, 500);
  }
};
