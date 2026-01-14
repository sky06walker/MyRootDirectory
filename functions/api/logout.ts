
export const onRequestPost: PagesFunction = async () => {
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "Set-Cookie": "auth=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
      "Content-Type": "application/json"
    },
  });
};
