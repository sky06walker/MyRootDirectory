import { type Env, json } from "../_lib/common";

const CONTENT_KEY = "cv_content";

// Public, read-only. Writes live in functions/api/admin/content.ts (behind Cloudflare Access).
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const data = await env.CV_DATA.get(CONTENT_KEY);
    if (!data) {
      return json({ message: "No data found" }, 404);
    }
    return new Response(data, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Fetch Error:", e);
    return json({ error: "Failed to fetch data" }, 500);
  }
};
