import { z } from "zod";
import {
  Action,
  ActivityContent,
  Content,
  contentForStorage,
  initialContent,
  NotifyRequest,
  Page,
  PageWrite,
  Tokens,
  Widgets,
  WidgetInstanceWrite,
  FeedbackRequest,
  PageId,
} from "../../shared/schema";
import { generatedWidgetPage, withWidgetPages, namedWidgetPages } from "./widget-pages";
import { reportFeedback, feedbackContextForPage } from "./feedback";
import { widgetCatalog } from "./widget-catalog";
import { equal, hash, mergePatch, secret } from "./security";
import { drain, jobStatement } from "./outbox";
import type { Device, Env, Push } from "./types";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
async function body(req: Request) {
  const value = await req.text();
  if (value.length > 131072) fail(413, "Body too large");
  try {
    return JSON.parse(value);
  } catch {
    fail(400, "Invalid JSON");
  }
}
async function bot(req: Request, env: Env) {
  if (
    !env.BOT_TOKEN ||
    !(await equal(
      req.headers.get("authorization") ?? "",
      `Bearer ${env.BOT_TOKEN}`,
    ))
  )
    fail(401, "Unauthorized");
}
async function device(req: Request, env: Env) {
  const id = req.headers.get("x-device-id") ?? "";
  const row = await env.DB.prepare("SELECT * FROM devices WHERE id=?")
    .bind(id)
    .first<Device>();
  const token = (req.headers.get("authorization") ?? "").replace(
    /^Bearer /,
    "",
  );
  if (!row || !(await equal(await hash(token), row.secret_hash)))
    fail(401, "Unauthorized");
  return row!;
}
async function reader(req: Request, env: Env) {
  if (
    env.BOT_TOKEN &&
    (await equal(
      req.headers.get("authorization") ?? "",
      `Bearer ${env.BOT_TOKEN}`,
    ))
  )
    await bot(req, env);
  else await device(req, env);
}
type PageRow = {
  id: string;
  title: string;
  markdown: string;
  keep_until: number | null;
  updated_at: string;
};
function storedPage(row: PageRow) {
  return Page.parse({
    id: row.id,
    title: row.title,
    markdown: row.markdown,
    updatedAt: row.updated_at,
    ...(row.keep_until == null
      ? {}
      : { keepUntil: new Date(row.keep_until).toISOString() }),
  });
}
function routePageId(path: string) {
  let value = "";
  try {
    value = decodeURIComponent(path.slice("/pages/".length));
  } catch {
    return null;
  }
  const parsed = PageWrite.shape.id.safeParse(value);
  return parsed.success ? parsed.data : null;
}
async function visiblePage(env: Env, id: string) {
  return env.DB.prepare(
    "SELECT id,title,markdown,keep_until,updated_at FROM pages WHERE id=? AND (keep_until IS NULL OR keep_until>=?)",
  )
    .bind(id, Date.now())
    .first<PageRow>();
}
async function state(env: Env) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO state(id,revision,content,updated_at) VALUES(1,0,?,?)",
  )
    .bind(
      JSON.stringify(contentForStorage(Content.parse(initialContent))),
      new Date().toISOString(),
    )
    .run();
  const row = await env.DB.prepare("SELECT * FROM state WHERE id=1").first<{
    revision: number;
    content: string;
    updated_at: string;
  }>();
  return {
    ...JSON.parse(row!.content),
    revision: row!.revision,
    updatedAt: row!.updated_at,
  };
}
async function setState(env: Env, content: unknown, revision: number) {
  const stored = contentForStorage(Content.parse(content));
  // Agents may round-trip GET /state. Derived snapshot links must not stick
  // to new content when they patch or replace that response.
  for (const kind of ["botCard", "metric", "chart"] as const) {
    const widget = (stored.widgets as Partial<z.infer<typeof Widgets>>)[kind];
    if (widget && generatedWidgetPage(widget.pageId)) delete widget.pageId;
  }

  const updatedAt = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE state SET content=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?",
  )
    .bind(JSON.stringify(stored), updatedAt, revision)
    .run();
  if (!result.meta.changes)
    fail(409, "Revision conflict; fetch current state and retry");
  return { ...stored, revision: revision + 1, updatedAt };
}
async function devices(env: Env, deviceId?: string) {
  const rows = await (
    deviceId
      ? env.DB.prepare("SELECT * FROM devices WHERE id=?").bind(deviceId)
      : env.DB.prepare("SELECT * FROM devices")
  ).all<Device>();
  if (deviceId && !rows.results.length) fail(404, "Unknown device");
  return rows.results;
}
async function queue(env: Env, entries: { device: Device; push: Push }[]) {
  if (!entries.length) return [];
  const ids = entries.map(() => crypto.randomUUID());
  await env.DB.batch(
    entries.map((entry, i) =>
      jobStatement(env, "apns", entry.device.id, entry.push, ids[i]),
    ),
  );
  return ids;
}
async function widgetPush(env: Env) {
  const entries = [];
  for (const d of await devices(env)) {
    const t = Tokens.parse(JSON.parse(d.tokens));
    if (t.widget)
      entries.push({
        device: d,
        push: {
          token: t.widget,
          type: "widgets" as const,
          // WidgetKit topics use the containing app's bundle ID.
          topic: `${env.BUNDLE_ID}.push-type.widgets`,
          body: { aps: { "content-changed": true } },
          collapseId: "widgets",
        },
      });
  }
  // All widget notifications mean "fetch latest"; only retain one pending job per device.
  for (const e of entries)
    await env.DB.prepare(
      "DELETE FROM outbox WHERE device_id=? AND status='pending' AND locked_until=0 AND kind='apns' AND json_extract(payload,'$.type')='widgets'",
    )
      .bind(e.device.id)
      .run();
  return queue(env, entries);
}
async function handle(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const path = new URL(req.url).pathname;
  const method = req.method;
  if (path === "/health" && method === "GET")
    return json({ ok: true, schemaVersion: 1 });
  if (path === "/register" && method === "POST") {
    const input = z
      .object({
        pairingCode: z.string().max(128).optional(),
        name: z.string().min(1).max(100).optional(),
        tokens: Tokens.optional(),
      })
      .strict()
      .parse(await body(req));
    if (input.pairingCode) {
      const now = Date.now();
      const key = `pair:${req.headers.get("cf-connecting-ip") ?? "local"}`;
      const limit = await env.DB.prepare(
        "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count",
      )
        .bind(key, now + 60000, now, now)
        .first<{ count: number }>();
      if (limit!.count > 10) fail(429, "Too many pairing attempts");
      const consumed = await env.DB.prepare(
        "DELETE FROM pairings WHERE code_hash=? AND expires_at>? RETURNING code_hash",
      )
        .bind(await hash(input.pairingCode), now)
        .first();
      if (!consumed) fail(401, "Pairing code invalid or expired");
      const id = crypto.randomUUID(),
        credential = secret(),
        stamp = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO devices(id,secret_hash,name,tokens,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
        .bind(
          id,
          await hash(credential),
          input.name ?? "iPhone",
          JSON.stringify(input.tokens ?? {}),
          stamp,
          stamp,
        )
        .run();
      return json({ deviceId: id, secret: credential }, 201);
    }
    // App, extension and ActivityKit can rotate tokens concurrently. CAS prevents
    // one registration from dropping another source's newly registered token.
    for (let attempt = 0; attempt < 5; attempt++) {
      const d = await device(req, env);
      const tokens = Tokens.parse({ ...JSON.parse(d.tokens), ...input.tokens });
      if (input.tokens?.activities) {
        const map = new Map<string, { id: string; token: string }>(
          (JSON.parse(d.tokens).activities ?? []).map((a: { id: string; token: string }) => [a.id, a]),
        );
        for (const a of input.tokens.activities) map.set(a.id, a);
        tokens.activities = Array.from(map.values()).slice(-20);
      }
      const updated = await env.DB.prepare(
        "UPDATE devices SET tokens=?,name=?,updated_at=? WHERE id=? AND tokens=?",
      ).bind(JSON.stringify(tokens), input.name ?? d.name, new Date().toISOString(), d.id, d.tokens).run();
      if (updated.meta.changes) return json({ registered: true, deviceId: d.id });
    }
    fail(409, "Concurrent token registration; retry");
  }
  if (path === "/state" && method === "GET") {
    await reader(req, env);
    const current = await state(env);
    // Pre-widget-link template builds strictly validate the default widgets.
    // Only upgraded clients opt into generated links and the named catalog.
    if (new URL(req.url).searchParams.get("widgets") !== "1") return json(current);
    const snapshot = await withWidgetPages(env, current);
    return json({ ...snapshot, widgetInstances: (await namedWidgetPages(env, await widgetCatalog(env))).map(({ agentId: _agentId, ...item }) => item) });
  }
  if (path === "/widgets" && method === "GET") {
    await reader(req, env);
    return json({ widgets: await namedWidgetPages(env, await widgetCatalog(env)) });
  }
  if (path === "/feedback" && method === "POST") {
    const d = await device(req, env);
    const result = await reportFeedback(env, d.id, FeedbackRequest.parse(await body(req)));
    ctx.waitUntil(drain(env));
    return json(result.body, result.status);
  }
  if (path === "/action" && method === "POST") {
    const d = await device(req, env);
    const input = Action.parse(await body(req));
    const payload = { ...input, deviceId: d.id };
    const stamp = new Date().toISOString();
    const insert = env.DB.prepare(
      "INSERT OR IGNORE INTO actions(id,device_id,payload,created_at) VALUES(?,?,?,?)",
    ).bind(input.id, d.id, JSON.stringify(payload), stamp);
    const eventId = `${d.id}:${input.id}`;
    const statements = [insert];
    if (env.WEBHOOK_URL && env.WEBHOOK_SECRET)
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO outbox(id,kind,device_id,payload,available_at,created_at) VALUES(?,'webhook',?,?,?,?)",
        ).bind(eventId, d.id, JSON.stringify(payload), Date.now(), Date.now()),
      );
    await env.DB.batch(statements);
    ctx.waitUntil(drain(env));
    return json({ accepted: true, id: input.id }, 202);
  }
  if (path === "/pages" && method === "GET") {
    await reader(req, env);
    const { results } = await env.DB.prepare(
      "SELECT id,title,markdown,keep_until,updated_at FROM pages WHERE keep_until IS NULL OR keep_until>=? ORDER BY updated_at DESC",
    )
      .bind(Date.now())
      .all<PageRow>();
    return json({ pages: results.map(storedPage) });
  }
  if (path.startsWith("/pages/") && method === "GET") {
    await reader(req, env);
    const id = routePageId(path);
    const row = id ? await visiblePage(env, id) : null;
    if (!row) fail(404, "Page not found");
    return json(new URL(req.url).searchParams.get("feedback") === "1"
      ? { ...storedPage(row!), feedbackContext: await feedbackContextForPage(env, row!.id) } : storedPage(row!));
  }
  await bot(req, env);
  if (path === "/pages" && method === "POST") {
    const input = PageWrite.parse(await body(req));
    const updatedAt = new Date().toISOString();
    const keepUntil = input.keepUntil == null ? null : Date.parse(input.keepUntil);
    if (keepUntil != null && !Number.isFinite(keepUntil))
      fail(400, "Invalid keepUntil");
    await env.DB.prepare(
      "INSERT INTO pages(id,title,markdown,keep_until,updated_at,feedback_context) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,markdown=excluded.markdown,keep_until=excluded.keep_until,updated_at=excluded.updated_at,feedback_context=excluded.feedback_context",
    )
      .bind(input.id, input.title, input.markdown, keepUntil, updatedAt, JSON.stringify(input.agentId ? { agentId: input.agentId } : {}))
      .run();
    const row = await env.DB.prepare(
      "SELECT id,title,markdown,keep_until,updated_at FROM pages WHERE id=?",
    )
      .bind(input.id)
      .first<PageRow>();
    if (!row) fail(500, "Page was not stored");
    return json(storedPage(row!));
  }
  if (path.startsWith("/pages/") && method === "DELETE") {
    const id = routePageId(path);
    if (!id) fail(404, "Page not found");
    const removed = await env.DB.prepare("DELETE FROM pages WHERE id=?")
      .bind(id)
      .run();
    if (!removed.meta.changes) fail(404, "Page not found");
    return json({ deleted: true });
  }
  if (path === "/pairings" && method === "POST") {
    const code = secret().slice(0, 24);
    const expiresAt = Date.now() + 10 * 60000;
    await env.DB.prepare(
      "INSERT INTO pairings(code_hash,expires_at) VALUES(?,?)",
    )
      .bind(await hash(code), expiresAt)
      .run();
    const relay = new URL(req.url).origin;
    return json(
      {
        code,
        expiresAt,
        qrPayload: `agentnoticeboard://pair?relay=${encodeURIComponent(relay)}&code=${code}`,
      },
      201,
    );
  }
  if (path.startsWith("/devices/") && method === "DELETE") {
    const id = path.split("/")[2];
    await env.DB.batch([
      env.DB.prepare("DELETE FROM devices WHERE id=?").bind(id),
      env.DB.prepare(
        "UPDATE outbox SET status='cancelled' WHERE device_id=? AND status='pending'",
      ).bind(id),
    ]);
    return json({ revoked: true });
  }
  if (path === "/devices" && method === "GET") {
    return json({
      devices: (await devices(env)).map((d) => ({
        id: d.id,
        name: d.name,
        registeredTokens: Object.keys(JSON.parse(d.tokens)),
      })),
    });
  }
  if (path === "/state" && method === "POST") {
    const input = z
      .object({
        mode: z.enum(["replace", "patch"]),
        revision: z.number().int().nonnegative(),
        state: z.unknown(),
      })
      .strict()
      .parse(await body(req));
    const current = await state(env);
    const { revision, updatedAt, ...content } = current;
    const result = await setState(
      env,
      input.mode === "replace" ? input.state : mergePatch(content, input.state),
      input.revision,
    );
    const jobs = await widgetPush(env);
    ctx.waitUntil(drain(env));
    return json({ state: result, jobs });
  }
  if (path.startsWith("/widgets/") && method === "DELETE") {
    const id = PageId.parse(path.slice("/widgets/".length));
    const revision = z.coerce.number().int().positive().parse(new URL(req.url).searchParams.get("revision"));
    const result = await env.DB.prepare("DELETE FROM widget_instances WHERE id=? AND revision=?").bind(id, revision).run();
    if (!result.meta.changes) fail(409, "Widget missing or revision conflict; fetch /widgets and retry");
    const jobs = await widgetPush(env);
    ctx.waitUntil(drain(env));
    return json({ deleted: true, jobs });
  }
  if (path === "/widget" && method === "POST") {
    const input = z
      .object({
        kind: z.enum(["botCard", "metric", "buttonGrid", "chart"]),
        data: z.unknown(),
        id: PageId.optional(),
        name: z.string().trim().min(1).max(80).optional(),
        agentId: PageId.optional(),
        revision: z.number().int().nonnegative().optional(),
      })
      .strict()
      .parse(await body(req));
    if (input.id) {
      if (!input.name || input.revision === undefined) fail(400, "Named widgets require name and revision (0 to create)");
      const parsed = WidgetInstanceWrite.parse({ kind: input.kind, data: input.data });
      if (parsed.kind !== "buttonGrid" && generatedWidgetPage(parsed.data.pageId)) {
        const context = await feedbackContextForPage(env, parsed.data.pageId!);
        if (context.sourcePageId) parsed.data.pageId = context.sourcePageId;
        else delete parsed.data.pageId;
      }
      const stamp = new Date().toISOString();
      const result = input.revision === 0
        ? await env.DB.prepare("INSERT OR IGNORE INTO widget_instances(id,name,kind,data,revision,updated_at,agent_id) SELECT ?,?,?,?,1,?,? WHERE (SELECT count(*) FROM widget_instances)<100")
          .bind(input.id, input.name, parsed.kind, JSON.stringify(parsed.data), stamp, input.agentId ?? null).run()
        : await env.DB.prepare("UPDATE widget_instances SET name=?,data=?,revision=revision+1,updated_at=?,agent_id=COALESCE(?,agent_id) WHERE id=? AND kind=? AND revision=?")
          .bind(input.name, JSON.stringify(parsed.data), stamp, input.agentId ?? null, input.id, parsed.kind, input.revision).run();
      if (!result.meta.changes) fail(409, "Widget revision/kind conflict or catalog limit (100); fetch /widgets and retry");
      const jobs = await widgetPush(env);
      ctx.waitUntil(drain(env));
      return json({ id: input.id, revision: input.revision! + 1, jobs, status: "queued" }, 202);
    }
    if (input.name !== undefined || input.revision !== undefined || input.agentId !== undefined) fail(400, "name/revision require a widget id");
    const current = await state(env);
    const { revision, updatedAt, ...content } = current;
    const widgets = Widgets.parse({
      ...content.widgets,
      [input.kind]: input.data,
    });
    const result = await setState(env, { ...content, widgets }, revision);
    const jobs = await widgetPush(env);
    ctx.waitUntil(drain(env));
    return json({ revision: result.revision, jobs, status: "queued" }, 202);
  }
  if (path === "/notify" && method === "POST") {
    const input = NotifyRequest.parse(await body(req));
    if (input.pageId && !(await visiblePage(env, input.pageId)))
      fail(404, "Page not found");
    const entries = [];
    for (const d of await devices(env, input.deviceId)) {
      const token = JSON.parse(d.tokens).device;
      if (token)
        entries.push({
          device: d,
          push: {
            token,
            type: input.silent ? ("background" as const) : ("alert" as const),
            topic: env.BUNDLE_ID,
            body: {
              aps: input.silent
                ? { "content-available": 1 }
                : {
                    alert: {
                      title: input.title ?? "Agent Noticeboard",
                      body: input.body ?? "",
                    },
                    sound: "default",
                  },
              ...(input.pageId ? { pageId: input.pageId } : {}),
            },
          },
        });
    }
    const jobs = await queue(env, entries);
    ctx.waitUntil(drain(env));
    return json({ status: "queued", jobs }, 202);
  }
  if (path === "/activity" && method === "POST") {
    const input = z
      .object({
        deviceId: z.string(),
        event: z.enum(["start", "update", "end"]),
        activityId: z.string().min(1).max(128),
        content: ActivityContent,
      })
      .strict()
      .parse(await body(req));
    const [d] = await devices(env, input.deviceId);
    const tokens = Tokens.parse(JSON.parse(d.tokens));
    const token =
      input.event === "start"
        ? tokens.pushToStart
        : tokens.activities?.find((a) => a.id === input.activityId)?.token;
    if (!token) fail(409, "Required activity token not registered yet");
    const aps: Record<string, unknown> = {
      timestamp: Math.floor(Date.now() / 1000),
      event: input.event,
      "content-state": input.content,
    };
    if (input.event === "start")
      Object.assign(aps, {
        "attributes-type": "AgentActivityAttributes",
        attributes: { activityId: input.activityId },
        alert: { title: input.content.title, body: input.content.status },
        "input-push-token": 1,
      });
    if (input.event === "end")
      aps["dismissal-date"] = Math.floor(Date.now() / 1000);
    const jobs = await queue(env, [
      {
        device: d,
        push: {
          token: token!,
          type: "liveactivity",
          topic: `${env.BUNDLE_ID}.push-type.liveactivity`,
          body: { aps },
        },
      },
    ]);
    ctx.waitUntil(drain(env));
    return json({ status: "queued", jobs }, 202);
  }
  if (path === "/actions" && method === "GET") {
    const params = new URL(req.url).searchParams;
    const cursor = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(params.get("cursor") ?? 0);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(params.get("limit") ?? 50);
    const { results } = await env.DB.prepare(
      "SELECT seq,payload FROM actions WHERE seq>? ORDER BY seq LIMIT ?",
    )
      .bind(cursor, limit)
      .all<{ seq: number; payload: string }>();
    return json({
      actions: results.map((r) => ({
        ...JSON.parse(r.payload),
        cursor: r.seq,
      })),
      nextCursor: results.at(-1)?.seq ?? cursor,
    });
  }
  if (path === "/deliveries" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id,kind,device_id,status,attempts,last_error,created_at FROM outbox ORDER BY created_at DESC LIMIT 100",
    ).all();
    return json({ deliveries: results });
  }
  return json({ error: "Not found" }, 404);
}
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof z.ZodError)
        return json(
          {
            error: "Validation failed",
            issues: e.issues.map((i) => ({ path: i.path, message: i.message })),
          },
          400,
        );
      console.error("Request failed", e instanceof Error ? e.name : "Unknown");
      return json({ error: "Internal error" }, 500);
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        await drain(env);
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
        await env.DB.batch([
          env.DB.prepare("DELETE FROM actions WHERE created_at<?").bind(cutoff),
          env.DB.prepare(
            "DELETE FROM outbox WHERE status!='pending' AND created_at<?",
          ).bind(Date.now() - 30 * 86400000),
          env.DB.prepare("DELETE FROM pairings WHERE expires_at<?").bind(
            Date.now(),
          ),
          env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(
            Date.now(),
          ),
          env.DB.prepare(
            "DELETE FROM pages WHERE keep_until IS NOT NULL AND keep_until<?",
          ).bind(Date.now()),
        ]);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
