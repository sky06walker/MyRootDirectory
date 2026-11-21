import { json } from "../_lib/common";

// Catch-all for unknown /api/* paths and unsupported methods on known routes, so the
// API never falls through to the SPA's index.html with a 200.
export const onRequest: PagesFunction = async () => json({ error: "Not found" }, 404);
