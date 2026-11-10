import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { inspect, scan } from '../public-scrub.mjs';
const fakeToken = ['ghp', '_', 'FAKE'.repeat(8)].join('');
const repoURL = 'https://github.com/' + ['matts', 'uthe'].join('') + '/agent-noticeboard';
test('redacts findings and allows only the exact public repository URL', () => {
  assert.deepEqual(inspect(repoURL + '/pull/1'), []);
  assert.ok(inspect(repoURL + '-personal').includes('personal identity'));
  assert.ok(inspect(fakeToken).includes('credential'));
  assert.ok(inspect('prefix example-deployment suffix', ['example-deployment']).includes('deployment identifier'));
  assert.deepEqual(inspect('https://your-relay.workers.dev'), []);
  assert.ok(inspect('https://real-project.' + 'workers.dev').includes('deployment host'));
});
test('scans workflows, fails closed, handles initial pushes, and never logs matches', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'scrub-test-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', ['test', '@', 'example.invalid'].join(''));
    writeFileSync(join(cwd, 'README.md'), 'Safe template'); git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD');
    mkdirSync(join(cwd, '.github/workflows'), { recursive: true });
    writeFileSync(join(cwd, '.github/workflows/public-scrub.yml'), fakeToken);
    git('add', '.'); git('commit', '-m', 'fixture'); const head = git('rev-parse', 'HEAD');
    assert.ok(scan({ base, head, cwd }).findings.includes('credential'));
    assert.ok(scan({ base: '0'.repeat(40), head, cwd }).findings.includes('credential'));
    assert.throws(() => scan({ base: 'missing-ref', head, cwd }));
    const script = resolve('scripts/public-scrub.mjs');
    for (const [start, status] of [[base, 1], ['missing-ref', 2]]) {
      const result = spawnSync(process.execPath, [script, start, head], { cwd, encoding: 'utf8' });
      assert.equal(result.status, status);
      assert.ok(!(result.stdout + result.stderr).includes(fakeToken));
      assert.ok(!(result.stdout + result.stderr).includes('.github/workflows/public-scrub.yml'));
    }
    assert.deepEqual(scan({ base: head, head, cwd }).findings, []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
