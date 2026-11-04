import { expect,it } from 'vitest';
import { selectBaseline } from '../scripts/release-policy.mjs';
const now=Date.parse('2026-11-01T12:00:00Z');
const good={id:'build',status:'FINISHED',distribution:'STORE',buildProfile:'production',fingerprint:{hash:'native-a'},isForIosSimulator:false,createdAt:'2026-10-31T12:00:00Z',submissions:[{status:'FINISHED'}]};
it('permits OTA only for a recently submitted production runtime',()=>{expect(selectBaseline([good],'native-a',now)).toEqual(good);});
it('requires a build for a native change, failed submission, simulator, or expiring TestFlight build',()=>{
 expect(selectBaseline([good],'native-b',now)).toBeUndefined();
 for(const changed of [{submissions:[]},{submissions:[{status:'ERRORED'}]},{isForIosSimulator:true},{createdAt:'2026-08-01T00:00:00Z'},{status:'ERRORED'},{distribution:'INTERNAL'},{buildProfile:'development'}])expect(selectBaseline([{...good,...changed}],'native-a',now)).toBeUndefined();
});
