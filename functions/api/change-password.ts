
interface Env {
  CV_DATA: KVNamespace;
  ADMIN_PASSWORD?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  try {
    const { currentPassword, newPassword } = await request.json() as { currentPassword: string, newPassword: string };

    if (!newPassword || newPassword.length < 6) {
        return new Response(JSON.stringify({ success: false, error: "New password must be at least 6 characters" }), { status: 400 });
    }

    // specific validation logic matches login.ts
    let storedPassword = await env.CV_DATA.get("admin_password");
    const CORRECT_PASSWORD = storedPassword || env.ADMIN_PASSWORD || "admin123";

    if (currentPassword !== CORRECT_PASSWORD) {
        return new Response(JSON.stringify({ success: false, error: "Current password incorrect" }), { status: 401 });
    }

    await env.CV_DATA.put("admin_password", newPassword);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: "Failed to change password" }), { status: 500 });
  }
}
