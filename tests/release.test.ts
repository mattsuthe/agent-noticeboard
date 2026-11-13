import { expect,it } from 'vitest';
import { selectBaseline } from '../scripts/release-policy.mjs';
const now=Date.parse('2026-11-01T12:00:00Z');
const good={id:'build',status:'FINISHED',distribution:'STORE',buildProfile:'production',fingerprint:{hash:'native-a'},isForIosSimulator:false,createdAt:'2026-10-31T12:00:00Z',submissions:[{status:'FINISHED'}]};
it('permits OTA only for a recently submitted production runtime',()=>{expect(selectBaseline([good],'native-a',now)).toEqual(good);});
it('requires a build for a native change, failed submission, simulator, or expiring TestFlight build',()=>{
 expect(selectBaseline([good],'native-b',now)).toBeUndefined();
 for(const changed of [{submissions:[]},{submissions:[{status:'ERRORED'}]},{isForIosSimulator:true},{createdAt:'2026-08-01T00:00:00Z'},{status:'ERRORED'},{distribution:'INTERNAL'},{buildProfile:'development'}])expect(selectBaseline([{...good,...changed}],'native-a',now)).toBeUndefined();
});

import { buildAge, releasePlan } from '../scripts/release-policy.mjs';
it('recovers an exact-source failed submission and waits for active work', () => {
 const failed={...good, gitCommitHash:'commit', submissions:[{status:'ERRORED'}]};
 expect(releasePlan([failed],'native-a','commit',true,now).kind).toBe('submit');
 expect(releasePlan([{...failed,submissions:[{status:'IN_PROGRESS'}]}],'native-a','commit',false,now).kind).toBe('wait');
 expect(releasePlan([{...failed,status:'IN_QUEUE'}],'native-a','commit',false,now).kind).toBe('wait');
 expect(releasePlan([failed],'native-a','different',false,now).kind).toBe('build');
});
it('renews even with unchanged source, but avoids repeating a just-completed renewal', () => {
 expect(releasePlan([{...good,gitCommitHash:'commit'}],'native-a','commit',true,now).kind).toBe('build');
 expect(releasePlan([{...good,gitCommitHash:'commit',createdAt:new Date(now-1000).toISOString()}],'native-a','commit',true,now).kind).toBe('update');
});
it('reports 60/80/90-day thresholds without trusting EAS artifact expiry', () => {
 for (const [days,status] of [[3,'healthy'],[60,'renew-soon'],[80,'renew-now'],[90,'expired']] as const)
  expect(buildAge([{...good,createdAt:new Date(now-days*86400000).toISOString(),expirationDate:'wrong'}],now).status).toBe(status);
 expect(buildAge([{...good,submissions:[]}],now).status).toBe('missing');
 expect(selectBaseline([{...good,createdAt:new Date(now+1000).toISOString()}],'native-a',now)).toBeUndefined();
});
