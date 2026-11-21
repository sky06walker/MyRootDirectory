import { type AdminData, type Env, json } from "../../_lib/common";

// Reaching this handler means _middleware.ts already authenticated the request.
export const onRequestGet: PagesFunction<Env, string, AdminData> = async () =>
  json({ authenticated: true });
