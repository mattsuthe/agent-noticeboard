import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'darwin') throw new Error('This optional local scheduler uses macOS launchd');
process.umask(0o077);
const root=fileURLToPath(new URL('../',import.meta.url));
const state=join(homedir(),'Library/Application Support/AgentNoticeboard/maintenance');
const checkout=join(state,'checkout');
mkdirSync(state,{recursive:true,mode:0o700});
function git(args) {
 const result=spawnSync('git',args,{cwd:root,stdio:'inherit'});
 if(result.status!==0) throw new Error('Maintenance worktree setup failed');
}
if(!existsSync(checkout)) { git(['fetch','origin','main']); git(['worktree','add','--detach',checkout,'origin/main']); }
const runner=join(state,'runner.mjs');
copyFileSync(fileURLToPath(new URL('./maintenance-runner.mjs',import.meta.url)),runner);
const label='com.agentnoticeboard.maintenance';
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const env={PATH:`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,NOTICEBOARD_CHECKOUT:checkout,NOTICEBOARD_MAINTENANCE_DIR:state,...(process.env.NOTICEBOARD_RELAY_URL ? {NOTICEBOARD_RELAY_URL:process.env.NOTICEBOARD_RELAY_URL}:{})};
const plist=join(homedir(),'Library/LaunchAgents',`${label}.plist`);
writeFileSync(plist,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(runner)}</string></array>
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k,v])=>`<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>20</integer></dict>
<key>StandardOutPath</key><string>${xml(join(state,'launch.log'))}</string><key>StandardErrorPath</key><string>${xml(join(state,'launch-error.log'))}</string>
</dict></plist>`,{mode:0o600});
const target=`gui/${process.getuid()}`;
spawnSync('launchctl',['bootout',`${target}/${label}`],{stdio:'ignore'});
const result=spawnSync('launchctl',['bootstrap',target,plist],{stdio:'inherit'});
if(result.status!==0) throw new Error('launchd registration failed');
console.log(`Installed daily local maintenance. Status: ${join(state,'status.json')}`);
console.log(`Run now: launchctl kickstart ${target}/${label}`);
