import { z } from "zod";
import { AgentReply, MessageSubmission } from "../../shared/conversations";
import { Page, FeedbackContext } from "../../shared/schema";
import { hash } from "./security";
import type { Env } from "./types";
type Thread = {
  id: string;
  device_id: string;
  agent_id: string | null;
  snapshot: string;
};
const result = (status: number, body: unknown) => ({ status, body });

export async function threadForReport(
  env: Env,
  deviceId: string,
  pageId: string,
  version: string,
) {
  return env.DB.prepare(
    "SELECT * FROM report_threads WHERE device_id=? AND page_id=? AND page_updated_at=?",
  )
    .bind(deviceId, pageId, version)
    .first<Thread>();
}
export async function threadById(env: Env, id: string, deviceId?: string) {
  const query = deviceId
    ? env.DB.prepare(
        "SELECT * FROM report_threads WHERE id=? AND device_id=?",
      ).bind(id, deviceId)
    : env.DB.prepare("SELECT * FROM report_threads WHERE id=?").bind(id);
  return query.first<Thread>();
}
export async function readThread(env: Env, thread: Thread) {
  const rows = await env.DB.prepare(
    "SELECT id,role,text,created_at AS createdAt,received_at AS receivedAt,reply_to AS replyTo FROM thread_messages WHERE thread_id=? ORDER BY seq",
  )
    .bind(thread.id)
    .all();
  return {
    id: thread.id,
    page: JSON.parse(thread.snapshot),
    ...(thread.agent_id ? { agentId: thread.agent_id } : {}),
    messages: rows.results,
  };
}
export async function submitMessage(
  env: Env,
  deviceId: string,
  input: z.infer<typeof MessageSubmission>,
) {
  // Deterministic thread IDs keep concurrent first messages on the same snapshot.
  const threadId = await hash(
    JSON.stringify([deviceId, input.pageId, input.pageUpdatedAt]),
  );
  const existing = await env.DB.prepare(
    "SELECT thread_id,text,role FROM thread_messages WHERE id=?",
  )
    .bind(input.id)
    .first<{ thread_id: string; text: string; role: string }>();
  if (existing)
    return existing.thread_id === threadId &&
      existing.text === input.text &&
      existing.role === "user"
      ? result(202, { id: input.id, threadId, status: "submitted" })
      : result(409, { error: "Message ID already used" });
  let thread = await threadForReport(
    env,
    deviceId,
    input.pageId,
    input.pageUpdatedAt,
  );
  if (!thread) {
    const row = await env.DB.prepare("SELECT * FROM pages WHERE id=?")
      .bind(input.pageId)
      .first<{
        id: string;
        title: string;
        markdown: string;
        sections: string | null;
        updated_at: string;
        keep_until: string | number | null;
        feedback_context: string | null;
      }>();
    const expires =
      row?.keep_until == null
        ? Infinity
        : typeof row.keep_until === "number"
          ? row.keep_until
          : Date.parse(row.keep_until);
    if (!row || expires <= Date.now())
      return result(404, {
        error: "This report is no longer available. Your draft is saved.",
      });
    if (row.updated_at !== input.pageUpdatedAt)
      return result(409, {
        error:
          "This report changed. Refresh before starting a conversation. Your draft is saved.",
      });
    const context = FeedbackContext.parse(
      row.feedback_context ? JSON.parse(row.feedback_context) : {},
    );
    const page = Page.parse({
      id: row.id,
      title: row.title,
      markdown: row.markdown,
      ...(row.sections ? { sections: JSON.parse(row.sections) } : {}),
      updatedAt: row.updated_at,
      feedbackContext: context,
    });
    thread = {
      id: threadId,
      device_id: deviceId,
      agent_id: context.agentId ?? null,
      snapshot: JSON.stringify(page),
    };
  }
  const now = new Date().toISOString();
  const page = JSON.parse(thread.snapshot);
  const payload = JSON.stringify({
    id: input.id,
    actionId: "report-feedback",
    source: "app",
    deviceId,
    timestamp: now,
    ...page.feedbackContext,
    threadId,
    messageId: input.id,
    feedback: { text: input.text, page },
  });
  const statements = [
    env.DB.prepare(
      "INSERT OR IGNORE INTO report_threads(id,device_id,page_id,page_updated_at,agent_id,snapshot,created_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(
      threadId,
      deviceId,
      input.pageId,
      input.pageUpdatedAt,
      thread.agent_id,
      thread.snapshot,
      now,
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO actions(id,device_id,payload,created_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM thread_messages WHERE id=?)",
    ).bind(input.id, deviceId, payload, now, input.id),
    env.DB.prepare(
      "INSERT OR IGNORE INTO thread_messages(id,thread_id,role,text,created_at) SELECT ?,?,'user',?,? WHERE EXISTS (SELECT 1 FROM actions WHERE id=? AND device_id=? AND payload=?)",
    ).bind(input.id, threadId, input.text, now, input.id, deviceId, payload),
  ];
  if (env.WEBHOOK_URL && env.WEBHOOK_SECRET)
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO outbox(id,kind,device_id,payload,available_at,created_at) SELECT ?,'webhook',?,?,?,? WHERE EXISTS (SELECT 1 FROM actions WHERE id=? AND device_id=? AND payload=?)",
      ).bind(
        `${deviceId}:${input.id}`,
        deviceId,
        payload,
        Date.now(),
        Date.now(),
        input.id,
        deviceId,
        payload,
      ),
    );
  await env.DB.batch(statements);
  const saved = await env.DB.prepare(
    "SELECT thread_id,text,role FROM thread_messages WHERE id=?",
  )
    .bind(input.id)
    .first<{ thread_id: string; text: string; role: string }>();
  return saved?.thread_id === threadId &&
    saved.text === input.text &&
    saved.role === "user"
    ? result(202, { id: input.id, threadId, status: "submitted" })
    : result(409, { error: "Message ID already used" });
}
export async function acknowledge(env: Env, messageId: string) {
  const update = await env.DB.prepare(
    "UPDATE thread_messages SET received_at=COALESCE(received_at,?) WHERE id=? AND role='user'",
  )
    .bind(new Date().toISOString(), messageId)
    .run();
  return update.meta.changes
    ? result(200, { received: true })
    : result(404, { error: "Message not found" });
}
export async function reply(env: Env, input: z.infer<typeof AgentReply>) {
  const parent = await env.DB.prepare(
    "SELECT thread_id FROM thread_messages WHERE id=? AND role='user'",
  )
    .bind(input.messageId)
    .first<{ thread_id: string }>();
  if (!parent) return result(404, { error: "Message not found" });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO thread_messages(id,thread_id,role,text,created_at,reply_to) VALUES(?,?,'agent',?,?,?)",
    ).bind(input.id, parent.thread_id, input.text, now, input.messageId),
    env.DB.prepare(
      "UPDATE thread_messages SET received_at=COALESCE(received_at,?) WHERE id=? AND EXISTS (SELECT 1 FROM thread_messages WHERE id=? AND role='agent' AND reply_to=? AND text=?)",
    ).bind(now, input.messageId, input.id, input.messageId, input.text),
  ]);
  const saved = await env.DB.prepare(
    "SELECT role,text,reply_to FROM thread_messages WHERE id=?",
  )
    .bind(input.id)
    .first<{ role: string; text: string; reply_to: string }>();
  return saved?.role === "agent" &&
    saved.text === input.text &&
    saved.reply_to === input.messageId
    ? result(200, { replied: true, id: input.id })
    : result(409, { error: "Reply ID already used" });
}
