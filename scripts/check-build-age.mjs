import { appendFileSync } from 'node:fs';
import { queryBuilds } from './eas-api.mjs';
import { buildAge } from './release-policy.mjs';
const report = { checkedAt: new Date().toISOString(), ...buildAge(await queryBuilds()), basis: 'EAS creation date + 90 days is a conservative estimate; confirm actual availability and expiration in App Store Connect. OTA does not extend binary life.' };
console.log(JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `TestFlight build age\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
if (report.renewalNeeded) process.exitCode = 1;
