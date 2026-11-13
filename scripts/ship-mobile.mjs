import { createFingerprintAsync } from '@expo/fingerprint';
import { releasePlan, selectBaseline } from './release-policy.mjs';
import { app, queryBuilds } from './eas-api.mjs';
import { spawnSync } from 'node:child_process';

const { hash } = await createFingerprintAsync(app, { platforms: ['ios'] });
const commit = process.env.GITHUB_SHA ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: app, encoding: 'utf8' }).stdout.trim();
const builds = await queryBuilds(hash);
const plan = releasePlan(builds, hash, commit, process.argv.includes('--force-build'));
console.log(JSON.stringify({ runtime: hash, action: plan.kind, buildId: plan.build?.id }));
if (process.argv.includes('--dry-run')) process.exit(0);
if (plan.kind === 'wait') throw new Error(`Build/submission ${plan.build.id} is still active. Rerun after it finishes; no duplicate was queued.`);
function eas(args) {
  const result = spawnSync('npx', ['--yes', 'eas-cli@27.9.0', ...args], { cwd: app, stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) throw new Error('EAS command did not finish successfully. Inspect EAS, then rerun this script; do not blindly queue another build.');
}
if (plan.kind === 'submit') {
  eas(['submit', '-p', 'ios', '--id', plan.build.id, '--profile', 'production', '--non-interactive', '--wait']);
  if (!selectBaseline(await queryBuilds(hash), hash)) throw new Error('Submission is not confirmed finished; OTA withheld');
}
if (plan.kind === 'update' || plan.kind === 'submit') {
  eas(['update', '--channel', 'production', '--platform', 'ios', '--environment', 'production', '--non-interactive', '--message', `Release ${commit} (${hash})`]);
} else {
  const started = Date.now();
  eas(['build', '-p', 'ios', '--profile', 'production', '--auto-submit', '--non-interactive', '--wait']);
  // Auto-submit can still be running when the build command returns.
  const finished = (await queryBuilds(hash)).filter(build => build.gitCommitHash === commit && Date.parse(build.createdAt) >= started - 60000);
  if (!selectBaseline(finished, hash)) throw new Error('Build completed but its submission is not confirmed. Rerun after checking EAS submission status.');
}
