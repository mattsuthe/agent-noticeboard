import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getConfig } from '@expo/config';
import { fileURLToPath } from 'node:url';
export const app = fileURLToPath(new URL('../app/', import.meta.url));
export function project() {
  const { exp } = getConfig(app, { skipSDKVersionRequirement: true });
  const id = exp.extra?.eas?.projectId;
  if (!id || exp.runtimeVersion?.policy !== 'fingerprint') throw new Error('Existing project linkage and fingerprint policy are required');
  if ((process.env.EXPO_PROJECT_ID && process.env.EXPO_PROJECT_ID !== id) || (process.env.EXPO_OWNER && process.env.EXPO_OWNER !== exp.owner)) throw new Error('Production account does not match app config');
  return id;
}
function authentication() {
  if (process.env.EXPO_TOKEN) return { authorization: `Bearer ${process.env.EXPO_TOKEN}` };
  if (!process.argv.includes('--local-session') || process.env.CI) throw new Error('EXPO_TOKEN required in CI; on this Mac explicitly use --local-session for the existing EAS login');
  const session = JSON.parse(readFileSync(join(homedir(), '.expo/state.json'), 'utf8')).auth?.sessionSecret;
  if (!session) throw new Error('No existing local Expo session');
  return { 'expo-session': session };
}
// Retry only read-only queries, never build/update/submission mutations.
export async function queryBuilds(hash) {
  const headers = { ...authentication(), 'content-type': 'application/json' };
  const body = JSON.stringify({
    query: `query NoticeboardBuilds($appId: String!, $filter: BuildFilter) {
      app { byId(appId: $appId) { builds(offset: 0, limit: 100, filter: $filter) {
        id status distribution buildProfile isForIosSimulator createdAt appBuildVersion gitCommitHash
        fingerprint { hash } submissions { status }
      } } }
    }`,
    variables: { appId: project(), filter: { platform: 'IOS', distribution: 'STORE', buildProfile: 'production', ...(hash ? { fingerprintHash: hash } : {}) } },
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetch('https://api.expo.dev/graphql', { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) }); }
    catch { if (attempt === 2) throw new Error('EAS query timed out or could not connect; no release attempted'); }
    if (response && response.status !== 429 && response.status < 500) {
      const result = await response.json();
      if (!response.ok || result.errors || !Array.isArray(result.data?.app?.byId?.builds)) throw new Error('Unable to verify EAS builds; refusing to guess');
      return result.data.app.byId.builds;
    }
    if (attempt < 2) await delay(1000 * 2 ** attempt);
  }
  throw new Error('EAS unavailable after three read attempts; no release attempted');
}
