import { z } from 'zod';
import { FeedbackContext, FeedbackRequest } from '../../shared/schema';
import type { Env } from './types';

export async function reportFeedback(env: Env, deviceId: string, input: z.infer<typeof FeedbackRequest>) {
  const existing = await env.DB.prepare('SELECT device_id,payload FROM actions WHERE id=?').bind(input.id).first<{device_id: string; payload: string}>();
  const delivery = env.WEBHOOK_URL && env.WEBHOOK_SECRET ? 'webhook' : 'polling';
  if (existing) {
    const event = JSON.parse(existing.payload);
    if (existing.device_id !== deviceId || event.actionId !== 'report-feedback' || event.feedback?.text !== input.text || event.feedback?.page?.id !== input.pageId || event.feedback?.page?.updatedAt !== input.pageUpdatedAt)
      return { status: 409, body: { error: 'Feedback ID already used for another message' } };
    return { status: 202, body: { accepted: true, id: input.id, delivery } };
  }
  const page = await env.DB.prepare('SELECT id,title,markdown,updated_at,keep_until,feedback_context FROM pages WHERE id=?').bind(input.pageId).first<{
    id: string; title: string; markdown: string; updated_at: string; keep_until: string | number | null; feedback_context: string | null;
  }>();
  const expires = page?.keep_until == null ? Infinity : typeof page.keep_until === 'number' ? page.keep_until : Date.parse(page.keep_until);
  if (!page || expires <= Date.now()) return { status: 404, body: { error: 'These report details are no longer available' } };
  if (page.updated_at !== input.pageUpdatedAt) return { status: 409, body: { error: 'This report changed. Refresh it before sending your feedback.' } };
  const context = FeedbackContext.parse(page.feedback_context ? JSON.parse(page.feedback_context) : {});
  const timestamp = new Date().toISOString();
  const payload = {
    id: input.id, actionId: 'report-feedback', source: 'app', deviceId, timestamp,
    ...context,
    feedback: { text: input.text, page: { id: page.id, title: page.title, markdown: page.markdown, updatedAt: page.updated_at } },
  };
  const statements = [env.DB.prepare('INSERT OR IGNORE INTO actions(id,device_id,payload,created_at) VALUES(?,?,?,?)').bind(input.id, deviceId, JSON.stringify(payload), timestamp)];
  if (delivery === 'webhook') {
    // Only enqueue if this request owns the saved event. The UUID is globally unique.
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO outbox(id,kind,device_id,payload,available_at,created_at) SELECT ?,'webhook',?,?,?,? WHERE EXISTS (SELECT 1 FROM actions WHERE id=? AND device_id=? AND payload=?)")
      .bind(`${deviceId}:${input.id}`, deviceId, JSON.stringify(payload), Date.now(), Date.now(), input.id, deviceId, JSON.stringify(payload)));
  }
  await env.DB.batch(statements);
  const saved = await env.DB.prepare('SELECT device_id,payload FROM actions WHERE id=?').bind(input.id).first<{device_id: string; payload: string}>();
  const accepted = saved && saved.device_id === deviceId && JSON.parse(saved.payload).feedback?.text === input.text && JSON.parse(saved.payload).feedback?.page?.id === input.pageId && JSON.parse(saved.payload).feedback?.page?.updatedAt === input.pageUpdatedAt;
  return accepted ? { status: 202, body: { accepted: true, id: input.id, delivery } } : { status: 409, body: { error: 'Feedback ID already used for another message' } };
}

export async function feedbackContextForPage(env: Env, id: string) {
  const row = await env.DB.prepare('SELECT feedback_context FROM pages WHERE id=?').bind(id).first<{feedback_context: string | null}>();
  return FeedbackContext.parse(row?.feedback_context ? JSON.parse(row.feedback_context) : {});
}
