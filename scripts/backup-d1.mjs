import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

process.umask(0o077);
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(process.env.NOTICEBOARD_BACKUP_DIR ?? join(homedir(), 'Library/Application Support/AgentNoticeboard/backups'));
mkdirSync(destination, { recursive: true, mode: 0o700 });
if (realpathSync(destination).startsWith(realpathSync(root) + sep) || realpathSync(destination) === realpathSync(root))
  throw new Error('Backups contain private data and must be stored outside the repository');
const config = readFileSync(join(root, 'relay/wrangler.jsonc'), 'utf8');
const names = [...config.matchAll(/"database_name"\s*:\s*"([^"]+)"/g)];
if (names.length !== 1) throw new Error('Expected exactly one configured D1 database');
const directory = mkdtempSync(join(destination, new Date().toISOString().replaceAll(':', '-') + '-'));
const output = join(directory, 'database.sql');
const run = spawnSync(join(root, 'node_modules/.bin/wrangler'), ['d1', 'export', names[0][1], '--remote', '--output', output], { cwd: join(root, 'relay'), encoding: 'utf8', timeout: 300000 });
if (run.status !== 0) { console.error('D1 export failed; no backup was marked complete. Check Wrangler authentication.'); process.exit(1); }
chmodSync(output, 0o600);
const sql = readFileSync(output);
const validation = join(directory, 'validation.sqlite');
const db = new DatabaseSync(validation);
try {
  db.exec(sql.toString());
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  for (const name of ['state', 'pages', 'devices', 'actions', 'outbox']) if (!tables.includes(name)) throw new Error(`Backup missing ${name}`);
  writeFileSync(join(directory, 'verified.json'), JSON.stringify({ exportedAt: new Date().toISOString(), bytes: sql.length, sha256: createHash('sha256').update(sql).digest('hex'), tables, integrity: 'ok' }, null, 2), { mode: 0o600 });
} finally { db.close(); rmSync(validation, { force: true }); }
console.log(`Verified private D1 export: ${directory}`);
// No restore, remote execute, pruning, or deletion of D1 data is supported here.
