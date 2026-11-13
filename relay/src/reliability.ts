import type { Env } from "./types";

export async function writeBudget(env: Env, key: string, maximum: number, now = Date.now()) {
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count,expires_at",
  ).bind(`write:${key}`, now + 60000, now, now).first<{ count: number; expires_at: number }>();
  return row && row.count > maximum ? Math.max(1, Math.ceil((row.expires_at - now) / 1000)) : 0;
}

export async function health(env: Env, detailed: boolean) {
  try {
    // Probe the actual schema, not just the Worker process or a constant SELECT.
    await env.DB.batch([
      env.DB.prepare("SELECT revision FROM state LIMIT 1"),
      env.DB.prepare("SELECT feedback_context FROM pages LIMIT 1"),
      env.DB.prepare("SELECT id FROM widget_instances LIMIT 1"),
    ]);
    const base = { ok: true, schemaVersion: 1, database: "ready" };
    if (!detailed) return Response.json(base, { headers: { "cache-control": "no-store" } });
    const outbox = await env.DB.prepare(
      "SELECT status,COUNT(*) AS count,MIN(created_at) AS oldestCreatedAt FROM outbox GROUP BY status",
    ).all();
    const heartbeat = await env.DB.prepare("SELECT last_success FROM relay_health WHERE id=1").first<{ last_success: number }>();
    const cronAgeSeconds = heartbeat ? Math.max(0, Math.floor((Date.now() - heartbeat.last_success) / 1000)) : null;
    return Response.json({ ...base, cronAgeSeconds, cronHealthy: cronAgeSeconds !== null && cronAgeSeconds < 300, outbox: outbox.results }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, schemaVersion: 1, database: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
