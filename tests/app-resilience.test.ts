import { afterEach, expect, it, vi } from 'vitest';
import { fetchJSON, RelayError } from '../app/src/http';
import { readPages, savePage } from '../app/src/page-cache';
const page = { id: 'report', title: 'Report', markdown: 'Body', updatedAt: '2026-11-01T00:00:00Z' };
afterEach(() => vi.unstubAllGlobals());
it('bounds hanging network requests without replaying writes', async () => {
  const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchJSON('https://relay.test/action', {method:'POST'}, 5)).rejects.toThrow('timed out');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('handles an HTML outage and preserves HTTP authentication errors', async () => {
  vi.stubGlobal('fetch', async () => new Response('<html>down</html>', {status:503}));
  await expect(fetchJSON('https://relay.test')).rejects.toMatchObject({status:503, retryable:true});
  vi.stubGlobal('fetch', async () => Response.json({error:'Unauthorized'}, {status:401}));
  await expect(fetchJSON('https://relay.test')).rejects.toMatchObject({status:401, retryable:false});
  expect(new RelayError('missing',404).retryable).toBe(false);
});
it('ignores corrupt cache, bounds reports and respects expiry', () => {
  expect(readPages('{broken')).toEqual([]);
  expect(readPages(JSON.stringify([{page, savedAt:'invalid'}]))).toEqual([]);
  const many = Array.from({length:25},(_,i)=>({page:{...page,id:`p${i}`},savedAt:page.updatedAt}));
  expect(readPages(JSON.stringify(many))).toHaveLength(20);
  expect(readPages(JSON.stringify([{page:{...page,keepUntil:'2026-11-02T00:00:00Z'},savedAt:page.updatedAt}]),Date.parse('2026-11-03'))).toEqual([]);
  const entries = savePage(many, page);
  expect(entries).toHaveLength(20);
  expect(savePage(entries, {...page,title:'New'})[0].page.title).toBe('New');
  expect(savePage(entries,page).filter(entry=>entry.page.id==='report')).toHaveLength(1);
});
