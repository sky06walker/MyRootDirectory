
interface Env {
  CV_DATA: KVNamespace;
  ADMIN_PASSWORD?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const { password } = await request.json() as { password: string };
  
  
  // Try to get password from KV first, fall back to Env or default
  let storedPassword = await env.CV_DATA.get("admin_password");
  const CORRECT_PASSWORD = storedPassword || env.ADMIN_PASSWORD || "admin123";

  if (password === CORRECT_PASSWORD) {
    // Set a simple cookie
    return new Response(JSON.stringify({ success: true }), {
      headers: { 
        "Set-Cookie": `auth=true; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`, // 1 hour
        "Content-Type": "application/json"
      }
    });
  }

  return new Response(JSON.stringify({ success: false, error: "Invalid password" }), { 
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}
