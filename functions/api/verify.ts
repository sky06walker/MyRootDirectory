
interface Env {
  CV_DATA: KVNamespace;
  ADMIN_PASSWORD?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const cookie = request.headers.get("Cookie");

  if (cookie && cookie.includes("auth=true")) {
    return new Response(JSON.stringify({ authenticated: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ authenticated: false }), { 
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}
