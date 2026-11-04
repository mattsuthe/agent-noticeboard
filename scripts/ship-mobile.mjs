import { createFingerprintAsync } from '@expo/fingerprint';
import { selectBaseline } from './release-policy.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const app = fileURLToPath(new URL('../app/', import.meta.url));
const projectId = '00000000-0000-0000-0000-000000000002';
if (!process.env.EXPO_TOKEN) throw new Error('EXPO_TOKEN is required for unattended shipping');
const { hash } = await createFingerprintAsync(app, { platforms: ['ios'] });
const response = await fetch('https://api.expo.dev/graphql', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.EXPO_TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    query: `query AgentReleaseBaseline($appId: String!, $filter: BuildFilter) {
      app { byId(appId: $appId) { builds(offset: 0, limit: 100, filter: $filter) {
        id status distribution buildProfile isForIosSimulator createdAt
        fingerprint { hash } submissions { status }
      } } }
    }`,
    variables: { appId: projectId, filter: { platform: 'IOS', status: 'FINISHED', distribution: 'STORE', buildProfile: 'production', fingerprintHash: hash } },
  }),
  signal: AbortSignal.timeout(30000),
});
const result = await response.json();
if (!response.ok || result.errors) throw new Error('Unable to verify EAS release baseline; refusing to guess between OTA and build');
const builds = result.data?.app?.byId?.builds;
if (!Array.isArray(builds)) throw new Error('Unexpected EAS release response');
// EAS build completion alone is insufficient: a failed/unsubmitted build cannot be an OTA baseline.
const baseline = selectBaseline(builds, hash);
const force = process.argv.includes('--force-build');
const args = baseline && !force
  ? ['update', '--channel', 'production', '--platform', 'ios', '--environment', 'production', '--non-interactive', '--message', `GitHub ${process.env.GITHUB_SHA ?? 'manual'} (${hash})`]
  : ['build', '-p', 'ios', '--profile', 'production', '--auto-submit', '--non-interactive', '--wait'];
console.log(baseline && !force ? `Publishing OTA for submitted runtime ${hash}` : `Building and submitting runtime ${hash}`);
const command = spawnSync('eas', args, { cwd: app, stdio: 'inherit', env: process.env });
if (command.error) throw command.error;
process.exit(command.status ?? 1);
