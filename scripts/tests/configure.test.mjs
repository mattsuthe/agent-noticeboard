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
  cpSync(resolve('scripts/check-production.mjs'),join(dir,'scripts/check-production.mjs'));
  // Fixed fixtures keep this test useful after the repository itself is configured.
  const fixtures = {
   'app/app.config.ts': 'bundleIdentifier: "com.example.agentcompanion"',
   'app/plugins/withAgentWidgets.cjs': 'group.com.example.agentcompanion',
   'app/modules/agent-native/ios/AgentShared.swift': 'group.com.example.agentcompanion',
   'relay/wrangler.jsonc': 'com.example.agentcompanion.widgets 00000000-0000-0000-0000-000000000001',
   '.github/workflows/verify.yml': 'com.example.agentcompanion',
   'scripts/tests/configure.test.mjs': 'com.example.agentcompanion',
  };
  for(const [file, contents] of Object.entries(fixtures)) {
   mkdirSync(join(dir,file,'..'),{recursive:true});writeFileSync(join(dir,file),contents);
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
  assert.equal(readFileSync(join(dir,'scripts/tests/configure.test.mjs'),'utf8'), 'com.example.agentcompanion');
  result=spawnSync(process.execPath,[join(dir,'scripts/check-production.mjs')],{cwd:dir,env:{...process.env,EXPO_TOKEN:'test-only',EXPO_PROJECT_ID:'test-only',EXPO_OWNER:'test-only',CLOUDFLARE_API_TOKEN:'test-only',CLOUDFLARE_ACCOUNT_ID:'test-only'}});
  assert.equal(result.status,0,result.stderr.toString());
 } finally {rmSync(dir,{recursive:true,force:true});}
});
