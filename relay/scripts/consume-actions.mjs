#!/usr/bin/env node
// Model-neutral action receiver. The trusted handler gets one JSON event on stdin.
import { mkdir, readFile, open, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function consumeOnce({ relay, token, stateFile, handler, fetcher = fetch, run }) {
  const origin = new URL(relay);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
    throw new Error('RELAY_URL must be an HTTPS origin');
  if (!token) throw new Error('BOT_TOKEN is required');
  if (!isAbsolute(handler ?? '')) throw new Error('ACTION_HANDLER must be a trusted absolute executable path');
  await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
  const lock = `${stateFile}.lock`;
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Receiver lock exists; another receiver may be running'); throw error; }
  try {
    let cursor = 0;
    try { cursor = JSON.parse(await readFile(stateFile, 'utf8')).cursor; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read receiver cursor; refusing to replay history'); }
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid receiver cursor');
    const response = await fetcher(`${origin.origin}/actions?cursor=${cursor}&limit=100`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Relay returned HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.actions)) throw new Error('Invalid action response');
    let handled = 0;
    for (const event of result.actions) {
      if (!event || typeof event.id !== 'string' || !Number.isSafeInteger(event.cursor) || event.cursor <= cursor)
        throw new Error('Invalid action sequence; cursor retained');
      try {
        if (run) await run(event);
        else execFileSync(handler, [], { input: JSON.stringify(event), timeout: 60000, stdio: ['pipe', 'inherit', 'inherit'] });
      } catch { throw new Error('Action handler failed; cursor retained for retry'); }
      const temporary = `${stateFile}.tmp`;
      const file = await open(temporary, 'w', 0o600);
      try { await file.writeFile(JSON.stringify({ cursor: event.cursor }) + '\n'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, stateFile);
      cursor = event.cursor;
      handled += 1;
    }
    return { handled, cursor };
  } finally { await rm(lock, { recursive: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    do {
      const result = await consumeOnce({
        relay: process.env.RELAY_URL, token: process.env.BOT_TOKEN,
        handler: process.env.ACTION_HANDLER,
        stateFile: resolve(process.env.ACTION_CURSOR_FILE ?? '.agent-state/actions.json'),
      });
      if (result.handled) console.log(`Handled ${result.handled} action(s); cursor ${result.cursor}`);
      if (process.argv.includes('--once')) break;
      if (result.handled < 100) await delay(10000);
    } while (true);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
