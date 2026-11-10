import { WidgetInstance, type NamedWidget } from '../../shared/schema';
import type { Env } from './types';
export async function widgetCatalog(env: Env): Promise<NamedWidget[]> {
  const rows = await env.DB.prepare('SELECT * FROM widget_instances ORDER BY name COLLATE NOCASE,id').all<{
    id: string; name: string; kind: string; agent_id: string | null; data: string; revision: number; updated_at: string;
  }>();
  return rows.results.map(row => WidgetInstance.parse({
    id: row.id, name: row.name, kind: row.kind, ...(row.agent_id ? { agentId: row.agent_id } : {}), data: JSON.parse(row.data), revision: row.revision, updatedAt: row.updated_at,
  }));
}
