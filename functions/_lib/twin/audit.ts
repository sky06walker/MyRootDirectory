import type { Env } from "../common";

// Audit trail for changes made from the admin page. Rows hold WHO did WHAT and WHEN, with field
// NAMES and flags only: never values, never the API key. Written to D1 (durable, queryable) and
// also logged; if D1 is unavailable the log line is the fallback, and a failure never blocks.

export interface AuditEvent {
  actor: string;
  action: string;
  /** Names of changed fields or flags such as "apiKey:set". Never values. */
  fields?: string[];
  requestId: string;
  ray?: string;
}

const schemaReady = new WeakMap<D1Database, Promise<unknown>>();

function ensureAuditTable(db: D1Database): Promise<unknown> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db
      .prepare(
        "CREATE TABLE IF NOT EXISTS twin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, fields TEXT NOT NULL, request_id TEXT NOT NULL, ray TEXT)",
      )
      .run();
    ready.catch(() => schemaReady.delete(db));
    schemaReady.set(db, ready);
  }
  return ready;
}

export async function writeAudit(env: Env, event: AuditEvent): Promise<void> {
  const at = Date.now();
  const fields = (event.fields ?? []).join(",");
  console.log(
    JSON.stringify({
      event: "twin_admin_audit",
      at: new Date(at).toISOString(),
      actor: event.actor,
      action: event.action,
      fields,
      request_id: event.requestId,
      ray: event.ray,
    }),
  );
  if (!env.TWIN_DB) return;
  try {
    await ensureAuditTable(env.TWIN_DB);
    await env.TWIN_DB.prepare(
      "INSERT INTO twin_audit (at, actor, action, fields, request_id, ray) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(at, event.actor, event.action, fields, event.requestId, event.ray ?? null)
      .run();
  } catch (e) {
    console.error("Audit write failed:", e instanceof Error ? e.message : e);
  }
}
