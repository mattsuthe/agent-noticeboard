import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'js-yaml';
const workflow = YAML.load(readFileSync(new URL('../../.github/workflows/skip-audit.yml', import.meta.url), 'utf8'));
const script = workflow.jobs['skip-directives'].steps[0].with.script;
async function audit(files, messages, title = 'Routine update') {
  let failed = false;
  const github = { rest: { pulls: { listFiles: 'files', listCommits: 'commits' } }, paginate: async method => method === 'files' ? files.map(filename => ({filename})) : messages.map(message => ({commit:{message}})) };
  const context = { repo: {}, payload: {pull_request:{number:1,title}} };
  await new (Object.getPrototypeOf(async function(){}).constructor)('github','context','core',script)(github,context,{setFailed:()=>{failed=true;}});
  return failed;
}
test('metadata audit rejects every GitHub skip form on production inputs',async()=>{
 for(const file of ['app/src/a.ts','relay/src/index.ts','scripts/ship.mjs','tsconfig.json','.github/workflows/ship.yml','shared/schema.ts'])
  for(const message of ['[skip ci]','[ci skip]','[no ci]','[skip actions]','[actions skip]','skip-checks: true'])
   assert.equal(await audit([file],[message]),true,`${file} ${message}`);
 assert.equal(await audit(['app/src/a.ts'],['normal'],'Change [skip ci]'),true);
 assert.equal(await audit(['docs/OPERATIONS.md'],['[skip ci]']),false);
 assert.equal(await audit(['app/src/a.ts'],['normal']),false);
 assert.deepEqual(workflow.permissions,{'contents':'read','pull-requests':'read'});
 assert.equal(workflow.jobs['skip-directives'].steps.length,1);
});
