// Installed outside the checkout by install-maintenance.mjs. Built-ins only.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
const checkout = process.env.NOTICEBOARD_CHECKOUT;
const directory = process.env.NOTICEBOARD_MAINTENANCE_DIR;
if (!checkout || !directory) throw new Error('Maintenance installation is not configured');
process.umask(0o077);
mkdirSync(directory, {recursive:true,mode:0o700});
const lock = join(directory, 'running');
try { mkdirSync(lock); } catch {
  let owner;
  try { owner = Number(readFileSync(join(lock,'pid'),'utf8')); } catch {}
  if (Number.isInteger(owner) && owner > 0) {
    try { process.kill(owner,0); throw new Error('Maintenance is already running'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  } else if (Date.now()-statSync(lock).mtimeMs < 600000) {
    throw new Error('Maintenance lock is being initialized');
  }
  rmSync(lock,{recursive:true});
  mkdirSync(lock);
}
writeFileSync(join(lock,'pid'),String(process.pid));
const log = openSync(join(directory,'latest.log'),'w',0o600);
let previous = {};
try { previous = JSON.parse(readFileSync(join(directory,'status.json'),'utf8')); } catch {}
const status = { checkedAt:new Date().toISOString(), lastBackupAt:previous.lastBackupAt, ok:false };
function run(command,args,cwd=checkout,capture=false) {
  const child=spawnSync(command,args,{cwd,encoding:'utf8',timeout:90*60000,maxBuffer:16*1024*1024,stdio:['ignore',capture?'pipe':log,log]});
  if(child.error || child.status!==0) throw new Error(`${command} ${args[0]} failed; see private latest.log`);
  return child.stdout?.trim();
}
try {
  if (run('git',['status','--porcelain','--untracked-files=normal'],checkout,true)) throw new Error('Maintenance checkout has local changes; refusing to replace them');
  run('git',['fetch','origin','main']);
  run('git',['checkout','--detach','origin/main']);
  status.commit=run('git',['rev-parse','HEAD'],checkout,true);
  run('npm',['ci']);
  // A healthy query returns JSON and exit 0. Renewal warnings return JSON and exit 1.
  const age=spawnSync(process.execPath,['scripts/check-build-age.mjs','--local-session'],{cwd:checkout,encoding:'utf8',timeout:120000,stdio:['ignore','pipe',log]});
  if(age.error || !age.stdout?.trim()) throw new Error('Build-age check failed');
  status.buildAge=JSON.parse(age.stdout);
  if(!['healthy','renew-soon','renew-now','expired','missing'].includes(status.buildAge.status)) throw new Error('Unknown build-age status');
  if(status.buildAge.renewalNeeded) {
    run('npm',['run','lint','--workspace','app']);
    run('npm',['run','typecheck']);
    run('npm',['test']);
    run(process.execPath,['--test','scripts/tests/action-consumer.test.mjs','scripts/tests/skip-audit.test.mjs']);
    run(process.execPath,['scripts/test-widget-selection.mjs']);
    run('npx',['expo','export','--platform','ios'],join(checkout,'app'));
    run(process.execPath,['scripts/ship-mobile.mjs','--local-session','--force-build']);
  }
  const apple=JSON.parse(run('npx',['--yes','eas-cli@27.9.0','submit:status','-p','ios','--json','--non-interactive'],join(checkout,'app'),true));
  status.apple=(apple.ios?.testFlightBuilds ?? []).map(b=>({build:b.buildNumber,processing:b.processingState,internal:b.internalState,expired:b.expired}));
  if(!status.apple.some(b=>b.processing==='VALID' && b.internal==='IN_BETA_TESTING' && !b.expired)) throw new Error('No valid internal TestFlight build was confirmed');
  if(process.env.NOTICEBOARD_RELAY_URL) {
    const response=await fetch(`${process.env.NOTICEBOARD_RELAY_URL}/health`,{signal:AbortSignal.timeout(15000)});
    status.relay=await response.json();
    if(!response.ok || !status.relay.ok) throw new Error('Relay health check failed');
  }
  if(!status.lastBackupAt || Date.now()-Date.parse(status.lastBackupAt)>7*86400000) {
    run(process.execPath,['scripts/backup-d1.mjs']);
    status.lastBackupAt=new Date().toISOString();
  }
  status.ok=true;
} catch(error) { status.error=error.message; process.exitCode=1; }
finally {
  writeFileSync(join(directory,'status.json'),JSON.stringify(status,null,2),{mode:0o600});
  closeSync(log);
  rmSync(lock,{recursive:true});
}
console.log(JSON.stringify(status));
