import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/configure.mjs /path/to/installation.json (see installation.example.json)');
const values = JSON.parse(readFileSync(file, 'utf8'));
const fields = {
 bundleId: ['com.example.agentcompanion', /^(?!com\.example\.)[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*){2,}$/],
 expoOwner: ['YOUR_EXPO_OWNER', /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,60}$/],
 expoProjectId: ['00000000-0000-0000-0000-000000000002', /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/],
 appleTeamId: ['YOUR_TEAM_ID', /^[A-Z0-9]{10}$/],
 ascAppId: ['YOUR_ASC_APP_ID', /^[0-9]{6,20}$/],
 d1DatabaseId: ['00000000-0000-0000-0000-000000000001', /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/],
};
for (const [key, [placeholder, regex]] of Object.entries(fields)) {
 if (typeof values[key] !== 'string' || !regex.test(values[key]) || values[key] === placeholder)
  throw new Error(`Invalid or placeholder ${key}; no files changed`);
}
const ignored = new Set(['node_modules','.git','.expo','.wrangler','dist']);
const files = [];
function visit(dir) {
 for (const entry of readdirSync(dir, {withFileTypes:true})) {
  if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
  const path = join(dir,entry.name);
  if (path === join(root,"app/ios") || path === join(root,"app/android")) continue;
  if (entry.isDirectory()) visit(path);
  else if (/\.(ts|tsx|swift|cjs|json|jsonc|yml|mjs)$/.test(path) && !path.endsWith('configure.mjs') && !path.endsWith('installation.example.json') && path !== resolve(file)) files.push(path);
 }
}
visit(root);
let changed=0;
for (const file of files) {
 const before=readFileSync(file,'utf8'); let after=before;
 for (const [key,[placeholder]] of Object.entries(fields)) after=after.replaceAll(placeholder,values[key]);
 if (before!==after) {writeFileSync(file,after);changed++;}
}
if (!changed) throw new Error('No template placeholders found. To reconfigure an existing deployment, start with a fresh template copy.');
console.log(`Configured ${changed} source files. Review git diff, set GitHub variables/secrets, then verify before shipping.`);
