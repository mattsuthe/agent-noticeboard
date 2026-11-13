import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const runner=fileURLToPath(new URL('../maintenance-runner.mjs',import.meta.url));
for(const scenario of ['healthy','renew','dirty','failed-query','stale-lock']) test(`local maintenance ${scenario}`,()=>{
 const directory=mkdtempSync(join(tmpdir(),'noticeboard-maintenance-test-'));
 try {
  const checkout=join(directory,'checkout'), bin=join(directory,'bin');
  for(const path of [join(checkout,'scripts/tests'),join(checkout,'app'),bin]) mkdirSync(path,{recursive:true});
  const log=join(directory,'commands');
  const fake=`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';appendFileSync(process.env.TEST_COMMANDS,process.argv.slice(1).join(' ')+'\\n');`;
  writeFileSync(join(bin,'git'),fake+`if(process.argv[2]==='status')console.log(${JSON.stringify(scenario==='dirty'?' M app/example':'')});if(process.argv[2]==='rev-parse')console.log('commit');`,{mode:0o700});
  writeFileSync(join(bin,'npm'),fake,{mode:0o700});
  writeFileSync(join(bin,'npx'),fake+`if(process.argv.includes('submit:status'))console.log(JSON.stringify({ios:{testFlightBuilds:[{buildNumber:'14',processingState:'VALID',internalState:'IN_BETA_TESTING',expired:false}]}}));`,{mode:0o700});
  for(const name of ['backup-d1','ship-mobile','test-widget-selection']) writeFileSync(join(checkout,`scripts/${name}.mjs`),`import {appendFileSync} from 'node:fs';appendFileSync(process.env.TEST_COMMANDS,'${name}\\n');`);
  for(const name of ['action-consumer','skip-audit']) writeFileSync(join(checkout,`scripts/tests/${name}.test.mjs`),'');
  writeFileSync(join(checkout,'scripts/check-build-age.mjs'),scenario==='failed-query'?'process.exit(1)':`console.log(JSON.stringify({status:'${scenario==='renew'?'renew-soon':'healthy'}',renewalNeeded:${scenario==='renew'}}));process.exit(${scenario==='renew'?1:0});`);
  if(scenario==='stale-lock') { mkdirSync(join(directory,'running')); writeFileSync(join(directory,'running/pid'),'2147483647'); }
  const result=spawnSync(process.execPath,[runner],{env:{...process.env,PATH:bin,NOTICEBOARD_CHECKOUT:checkout,NOTICEBOARD_MAINTENANCE_DIR:directory,TEST_COMMANDS:log},encoding:'utf8'});
  const status=JSON.parse(readFileSync(join(directory,'status.json'),'utf8'));
  assert.equal(status.ok,scenario==='healthy'||scenario==='renew'||scenario==='stale-lock');
  assert.equal(result.status,status.ok?0:1);
  const commands=readFileSync(log,'utf8');
  assert.equal(commands.includes('ship-mobile'),scenario==='renew');
  if(scenario==='dirty')assert.equal(commands.includes('checkout --detach'),false);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
