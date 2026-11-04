export function selectBaseline(builds, hash, now = Date.now()) {
  return builds.find(build =>
    build.status === 'FINISHED' && build.distribution === 'STORE' && build.buildProfile === 'production' &&
    build.fingerprint?.hash === hash && !build.isForIosSimulator &&
    Date.parse(build.createdAt) > now - 80 * 86400000 &&
    build.submissions?.some(submission => submission.status === 'FINISHED'),
  );
}
