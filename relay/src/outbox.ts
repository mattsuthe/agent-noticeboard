import { sendPush } from "./apns";
import { signature } from "./security";
import type { Env, Job, Push, Device } from "./types";
export function jobStatement(
  env: Env,
  kind: Job["kind"],
  deviceId: string | null,
  payload: unknown,
  id = crypto.randomUUID(),
) {
  const now = Date.now();
  return env.DB.prepare(
    "INSERT INTO outbox(id,kind,device_id,payload,available_at,created_at) VALUES(?,?,?,?,?,?)",
  ).bind(id, kind, deviceId, JSON.stringify(payload), now, now);
}
export async function drain(env: Env) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT * FROM outbox WHERE status='pending' AND available_at<=? AND locked_until<=? ORDER BY created_at LIMIT 25",
  )
    .bind(now, now)
    .all<Job>();
  for (const job of results) {
    const lock = await env.DB.prepare(
      "UPDATE outbox SET locked_until=?,attempts=attempts+1 WHERE id=? AND status='pending' AND locked_until<=?",
    )
      .bind(now + 60000, job.id, now)
      .run();
    if (!lock.meta.changes) continue;
    try {
      let response: Response;
      if (job.kind === "webhook") {
        if (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET)
          throw new Error("Webhook configuration missing");
        const timestamp = String(Math.floor(Date.now() / 1000));
        response = await fetch(env.WEBHOOK_URL, {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            "x-agent-timestamp": timestamp,
            "x-agent-signature": await signature(
              env.WEBHOOK_SECRET,
              timestamp,
              job.payload,
            ),
            "x-agent-event-id": job.id,
          },
          body: job.payload,
          signal: AbortSignal.timeout(10000),
        });
      } else {
        const device = await env.DB.prepare("SELECT * FROM devices WHERE id=?")
          .bind(job.device_id)
          .first<Device>();
        if (!device) {
          await finish(env, job.id, "cancelled", "Device revoked");
          continue;
        }
        const push = JSON.parse(job.payload) as Push;
        // A revoked/rotated token must not remain reachable through old jobs.
        const tokens = JSON.parse(device.tokens);
        const current =
          push.type === "widgets"
            ? tokens.widget
            : push.type === "liveactivity"
              ? [
                  tokens.pushToStart,
                  ...(tokens.activities ?? []).map(
                    (a: { token: string }) => a.token,
                  ),
                ]
              : tokens.device;
        if (
          Array.isArray(current)
            ? !current.includes(push.token)
            : current !== push.token
        ) {
          await finish(env, job.id, "cancelled", "Token superseded");
          continue;
        }
        if (push.type === "widgets") {
          const slot = await env.DB.prepare(
            "INSERT INTO throttles(device_id,last_sent) VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET last_sent=excluded.last_sent WHERE throttles.last_sent<=?",
          )
            .bind(job.device_id, now, now - 60000)
            .run();
          if (!slot.meta.changes) {
            await env.DB.prepare(
              "UPDATE outbox SET available_at=?,locked_until=0,attempts=attempts-1 WHERE id=?",
            )
              .bind(now + 60000, job.id)
              .run();
            continue;
          }
        }
        response = await sendPush(env, push);
        if (response.status === 410 || response.status === 400) {
          const error = await response
            .clone()
            .json<{ reason?: string }>()
            .catch(() => ({ reason: "APNs rejected request" }));
          if (
            response.status === 410 ||
            error.reason === "BadDeviceToken" ||
            error.reason === "Unregistered"
          ) {
            for (const k of ["device", "widget", "pushToStart"])
              if (tokens[k] === push.token) delete tokens[k];
            tokens.activities = (tokens.activities ?? []).filter(
              (a: { token: string }) => a.token !== push.token,
            );
            await env.DB.prepare(
              "UPDATE devices SET tokens=? WHERE id=? AND tokens=?",
            )
              .bind(JSON.stringify(tokens), device.id, device.tokens)
              .run();
          }
          await finish(
            env,
            job.id,
            "failed",
            error.reason ?? `APNs ${response.status}`,
          );
          continue;
        }
      }
      if (!response.ok) throw new Error(`Delivery HTTP ${response.status}`);
      await finish(env, job.id, "sent", null);
    } catch (error) {
      const attempts = job.attempts + 1;
      await env.DB.prepare(
        "UPDATE outbox SET status=?,last_error=?,available_at=?,locked_until=0 WHERE id=?",
      )
        .bind(
          attempts >= 8 ? "failed" : "pending",
          error instanceof Error ? error.message : "Delivery failed",
          now + Math.min(3600000, 2 ** attempts * 10000),
          job.id,
        )
        .run();
    }
  }
}
async function finish(
  env: Env,
  id: string,
  status: string,
  error: string | null,
) {
  await env.DB.prepare(
    "UPDATE outbox SET status=?,last_error=?,locked_until=0 WHERE id=?",
  )
    .bind(status, error, id)
    .run();
}
