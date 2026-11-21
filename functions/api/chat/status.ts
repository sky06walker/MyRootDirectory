import type { Env } from "../../_lib/common";
import { handleStatus } from "../../_lib/twin/handler";

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => handleStatus(request, env);
