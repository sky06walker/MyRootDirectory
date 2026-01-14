
interface Env {
  CV_DATA: KVNamespace;
  ADMIN_PASSWORD?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  try {
    const data = await env.CV_DATA.get("cv_content");
    if (!data) {
      // Return default data if nothing in KV
      return new Response(JSON.stringify({ message: "No data found" }), { 
          status: 404,
          headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(data, {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Failed to fetch data" }), { status: 500 });
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  
  // Basic Auth Check (In production usage, use a proper session/cookie check)
  // For simplicity here, we check a custom header 'x-admin-password' or similar, 
  // or rely on a previous login that sets a cookie. 
  // Let's assume the client sends the password in a header for this simple implementation
  // OR we implement a proper cookie based session.
  
  // Checking for Cookie 'auth_token' which we will set in /api/login
  const cookie = request.headers.get("Cookie");
  // Simple check: "auth=true"
  if (!cookie || !cookie.includes("auth=true")) {
      return new Response("Unauthorized", { status: 401 });
  }

  try {
    const data = await request.json();
    await env.CV_DATA.put("cv_content", JSON.stringify(data));
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e: any) {
    console.error("Save Error:", e.message, e.stack);
    return new Response(JSON.stringify({ error: "Failed to save data", details: e.message }), { status: 500 });
  }
}
