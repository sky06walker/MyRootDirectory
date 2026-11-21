import type { Env } from "../_lib/common";
import { handleChat } from "../_lib/twin/handler";

// Public endpoint (visitors). Logic and its abuse controls live in _lib/twin/handler.ts.
// Other methods fall through to the JSON 404 catch-all.
export const onRequestPost: PagesFunction<Env> = ({ request, env }) => handleChat(request, env);
