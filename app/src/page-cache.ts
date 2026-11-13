import { Page, type PageRecord } from "../../shared/schema";

type Entry = { page: PageRecord; savedAt: string };
export function readPages(raw: string | null, now = Date.now()): Entry[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => {
      const page = Page.safeParse(entry?.page);
      return page.success && Number.isFinite(Date.parse(entry.savedAt)) &&
        (!page.data.keepUntil || Date.parse(page.data.keepUntil) > now)
        ? [{ page: page.data, savedAt: entry.savedAt as string }] : [];
    }).slice(0, 20);
  } catch { return []; }
}
export function savePage(entries: Entry[], page: PageRecord, now = new Date().toISOString()) {
  return [{ page, savedAt: now }, ...entries.filter(entry => entry.page.id !== page.id)].slice(0, 20);
}
