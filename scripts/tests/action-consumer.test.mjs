import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { consumeOnce } from '../../relay/scripts/consume-actions.mjs';

test('routes full feedback context and checkpoints only successful events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noticeboard-consumer-'));
  try {
    const first = { id: 'event-one', cursor: 1, agentId: 'trader', actionId: 'report-feedback', feedback: { text: 'Review sizing', page: { id: 'snapshot', markdown: 'Original thesis' } } };
    const second = { id: 'event-two', cursor: 2, agentId: 'research', actionId: 'report-feedback' };
    const stateFile = join(dir, 'cursor.json');
    const options = { relay: 'https://relay.example', token: 'test-secret', handler: '/trusted/handler', stateFile };
    const received = [];
    await assert.rejects(consumeOnce({ ...options, fetcher: async () => Response.json({ actions: [first, second] }), run: event => { if (event.id === second.id) throw new Error('offline'); received.push(event); } }), /handler failed/);
    assert.deepEqual(received, [first]);
    assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), { cursor: 1 });
    const result = await consumeOnce({ ...options, fetcher: async url => { assert.match(url, /cursor=1/); return Response.json({ actions: [second] }); }, run: event => received.push(event) });
    assert.equal(result.cursor, 2);
    assert.deepEqual(received, [first, second]);
    await assert.rejects(consumeOnce({ ...options, fetcher: async () => Response.json({ actions: [first] }), run: () => assert.fail('must not replay old sequence') }), /Invalid action sequence/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('passes message text as stdin data rather than shell commands', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noticeboard-handler-'));
  try {
    const handler = join(dir, 'handler.mjs'), output = join(dir, 'event.json');
    await writeFile(handler, `#!/usr/bin/env node\nimport{readFileSync,writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(output)},readFileSync(0));\n`, { mode: 0o700 });
    const event = { id: 'injection-test', cursor: 1, feedback: { text: '$(touch /tmp/should-not-run); echo unexpected' } };
    await consumeOnce({ relay: 'https://relay.example', token: 'test-secret', stateFile: join(dir, 'cursor.json'), handler, fetcher: async () => Response.json({ actions: [event] }) });
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), event);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
