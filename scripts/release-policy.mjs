const day = 86400000;
export function productionBuild(build) {
  return build.distribution === 'STORE' && build.buildProfile === 'production' && !build.isForIosSimulator;
}
export function freshBuild(build, now = Date.now()) {
  const created = Date.parse(build.createdAt);
  return Number.isFinite(created) && created <= now && created > now - 80 * day;
}
export function selectBaseline(builds, hash, now = Date.now()) {
  return builds.filter(build => productionBuild(build) && build.status === 'FINISHED' &&
    build.fingerprint?.hash === hash && freshBuild(build, now) &&
    build.submissions?.some(submission => submission.status === 'FINISHED'))
    .sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}
export function releasePlan(builds, hash, commit, force = false, now = Date.now()) {
  const matching = builds.filter(build => productionBuild(build) && build.fingerprint?.hash === hash && freshBuild(build, now));
  const active = matching.find(build => !['FINISHED', 'ERRORED', 'CANCELED'].includes(build.status) ||
    build.submissions?.some(submission => !['FINISHED', 'ERRORED', 'CANCELED'].includes(submission.status)));
  if (active) return { kind: 'wait', build: active };
  const baseline = selectBaseline(matching, hash, now);
  // A rerun after submission failure recovers the exact source build, even for monthly renewal.
  const recover = matching.find(build => build.status === 'FINISHED' && commit && build.gitCommitHash === commit && !build.submissions?.some(submission => submission.status === 'FINISHED'));
  if (recover) return { kind: 'submit', build: recover };
  if (baseline && (!force || (baseline.gitCommitHash === commit && Date.parse(baseline.createdAt) > now - day))) return { kind: 'update', build: baseline };
  return { kind: 'build' };
}
export function buildAge(builds, now = Date.now()) {
  const latest = builds.filter(build => productionBuild(build) && build.status === 'FINISHED' &&
    Number.isFinite(Date.parse(build.createdAt)) && Date.parse(build.createdAt) <= now &&
    build.submissions?.some(submission => submission.status === 'FINISHED'))
    .sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!latest) return { status: 'missing', renewalNeeded: true };
  const ageDays = Math.floor((now - Date.parse(latest.createdAt)) / day);
  return { status: ageDays >= 90 ? 'expired' : ageDays >= 80 ? 'renew-now' : ageDays >= 60 ? 'renew-soon' : 'healthy',
    renewalNeeded: ageDays >= 60, buildId: latest.id, buildNumber: latest.appBuildVersion, ageDays,
    renewalAt: new Date(Date.parse(latest.createdAt) + 80 * day).toISOString(),
    estimatedExpiry: new Date(Date.parse(latest.createdAt) + 90 * day).toISOString() };
}
