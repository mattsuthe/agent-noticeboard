import { Widgets, type NamedWidget, FeedbackContext } from '../../shared/schema';
import type { z } from 'zod';
import { hash } from './security';
import type { Env } from './types';

export function generatedWidgetPage(id: string | undefined) {
  return !!id && /^widget-(botCard|metric|chart)-[a-f0-9]{64}$/.test(id);
}

type WidgetData = Pick<NamedWidget, 'kind' | 'data'>;
// Keep the discriminant correlated with its payload.
type TypedData = { [K in NamedWidget['kind']]: Extract<NamedWidget, { kind: K }> extends infer W
  ? W extends NamedWidget ? Pick<W, 'kind' | 'data'> : never : never }[NamedWidget['kind']];
type PageInsert = [string, string, string, string | number | null, string, string];
type SourcePage = { id: string; title: string; markdown: string; updated_at: string; keep_until: string | number | null; feedback_context: string | null };
async function linkedData(inserts: PageInsert[], item: TypedData, updatedAt: string, context: z.infer<typeof FeedbackContext> = {}, sources = new Map<string, SourcePage>()): Promise<WidgetData['data']> {
  if (item.kind === 'buttonGrid') return item.data;
  if (item.data.pageId) {
    if (!context.widgetId) return item.data;
    const source = sources.get(item.data.pageId);
    const expires = source?.keep_until == null ? Infinity : typeof source.keep_until === 'number' ? source.keep_until : Date.parse(source.keep_until);
    if (!source || expires <= Date.now()) return item.data;
    const sourceContext = FeedbackContext.parse(source.feedback_context ? JSON.parse(source.feedback_context) : {});
    const linkedContext = { ...context, ...(context.agentId || !sourceContext.agentId ? {} : { agentId: sourceContext.agentId }), sourcePageId: source.id };
    const id = `widget-${item.kind}-${await hash(JSON.stringify({ source, context: linkedContext }))}`;
    inserts.push([id, source.title, source.markdown, source.keep_until, source.updated_at, JSON.stringify(linkedContext)]);
    return { ...item.data, pageId: id };
  }
  const id = `widget-${item.kind}-${await hash(JSON.stringify(Object.keys(context).length ? { data: item.data, context } : item.data))}`;
  let title: string;
  let markdown: string;
  if (item.kind === 'botCard') {
    title = item.data.title;
    markdown = item.data.body;
    updatedAt = item.data.timestamp;
  } else if (item.kind === 'metric') {
    title = item.data.label;
    markdown = `${item.data.value}${item.data.delta ? `\n\n${item.data.delta}` : ''}`;
  } else {
    title = item.data.title;
    const chart = item.data;
    markdown = chart.points.length
      ? chart.points.map(point => `- ${point.label}: ${point.value}${chart.unit ? ` ${chart.unit}` : ''}`).join('\n')
      : 'No data in this snapshot.';
    if (chart.target !== undefined) markdown += `\n\nTarget: ${chart.target}${chart.unit ? ` ${chart.unit}` : ''}`;
  }
  inserts.push([id, title || 'Widget details', markdown || 'No details in this snapshot.', null, updatedAt, JSON.stringify(context)]);
  return { ...item.data, pageId: id };
}

// A full catalog must stay within D1's per-request query and bind limits.
async function insertPages(env: Env, rows: PageInsert[]) {
  const statements = [];
  for (let i = 0; i < rows.length; i += 16) {
    const chunk = rows.slice(i, i + 16);
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO pages(id,title,markdown,keep_until,updated_at,feedback_context) VALUES ${chunk.map(() => '(?,?,?,?,?,?)').join(',')}`,
    ).bind(...chunk.flat()));
  }
  if (statements.length) await env.DB.batch(statements);
}

/** Link agent payloads to immutable copies of the content they displayed.
 * Authored pageIds take precedence; never persist generated ids into state.
 */
export async function withWidgetPages(env: Env, snapshot: { widgets: unknown; updatedAt: string }) {
  const inserts: PageInsert[] = [];
  const parsed = Widgets.parse(snapshot.widgets);
  const widgets = { ...(snapshot.widgets as Record<string, unknown>) };
  for (const kind of ['botCard', 'metric', 'chart'] as const) {
    if (!(kind in widgets)) continue;
    widgets[kind] = await linkedData(inserts, { kind, data: parsed[kind] } as TypedData, snapshot.updatedAt);
  }
  await insertPages(env, inserts);
  return { ...snapshot, widgets };
}
export async function namedWidgetPages(env: Env, instances: NamedWidget[]) {
  const ids = [...new Set(instances.flatMap(item => item.kind !== 'buttonGrid' && item.data.pageId ? [item.data.pageId] : []))];
  const rows = ids.length ? (await env.DB.prepare(`SELECT id,title,markdown,keep_until,updated_at,feedback_context FROM pages WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<SourcePage>()).results : [];
  const sources = new Map(rows.map(row => [row.id, row]));
  const inserts: PageInsert[] = [];
  const result = await Promise.all(instances.map(async instance => ({
    ...instance, data: await linkedData(inserts, instance, instance.updatedAt, {
      ...(instance.agentId ? { agentId: instance.agentId } : {}),
      widgetId: instance.id, widgetKind: instance.kind, widgetRevision: instance.revision,
    }, sources),
  })));
  await insertPages(env, inserts);
  return result;
}
