import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
test('configuration validates before writing and installs matching native identities', () => {
 const dir=mkdtempSync(join(tmpdir(),'companion-setup-'));
 try {
  mkdirSync(join(dir,'scripts'));
  cpSync(resolve('scripts/configure.mjs'),join(dir,'scripts/configure.mjs'));
  for(const file of ['app/app.config.ts','app/plugins/withAgentWidgets.cjs','app/modules/agent-native/ios/AgentShared.swift','relay/wrangler.jsonc','.github/workflows/verify.yml']) {
   mkdirSync(join(dir,file,'..'),{recursive:true});cpSync(resolve(file),join(dir,file));
  }
  const config=join(dir,'installation.json');
  writeFileSync(config,JSON.stringify({bundleId:'bad'}));
  let result=spawnSync(process.execPath,[join(dir,'scripts/configure.mjs'),config]);
  assert.notEqual(result.status,0);
  assert.match(readFileSync(join(dir,'app/app.config.ts'),'utf8'),/com\.example\.agentcompanion/);
  writeFileSync(config,JSON.stringify({bundleId:'org.sample.companion',expoOwner:'sample-owner',expoProjectId:'12345678-1234-1234-1234-123456789012',appleTeamId:'ABC1234567',ascAppId:'1234567890',d1DatabaseId:'12345678-1234-1234-1234-123456789013'}));
  result=spawnSync(process.execPath,[join(dir,'scripts/configure.mjs'),config]);
  assert.equal(result.status,0,result.stderr.toString());
  assert.match(readFileSync(join(dir,'app/plugins/withAgentWidgets.cjs'),'utf8'),/group\.org\.sample\.companion/);
  assert.match(readFileSync(join(dir,'app/modules/agent-native/ios/AgentShared.swift'),'utf8'),/group\.org\.sample\.companion/);
  assert.match(readFileSync(join(dir,'relay/wrangler.jsonc'),'utf8'),/org\.sample\.companion\.widgets/);
  assert.match(readFileSync(join(dir,'.github/workflows/verify.yml'),'utf8'),/org\.sample\.companion/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
