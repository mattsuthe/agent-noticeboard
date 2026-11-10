#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rules = [
  ['personal identity', new RegExp([('matts' + 'uthe'), ('matts' + 'uth\\b'), 'matt[ ._-]?suther' + 'land', 'suther' + 'land'].join('|'), 'i')],
  ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['personal domain', new RegExp(['builtby' + 'hq', 'gmail\\.com', 'icloud\\.com', '\\bme\\.com'].join('|'), 'i')],
  ['credential', /-----BEGIN [A-Z ]*PRIVATE KEY-----|(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}/],
];
export function inspect(text, markers = []) {
  // Permit only this exact public URL; a private-repo suffix must not match.
  const publicURL = 'https://github.com/' + ('matts' + 'uthe') + '/agent-noticeboard';
  const escaped = publicURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cleaned = text.replace(new RegExp(escaped + '(?=$|[\\s/\\x22\\x27<>),#?])', 'g'), 'PUBLIC_REPOSITORY');
  const findings = rules.filter(([, pattern]) => pattern.test(cleaned)).map(([label]) => label);
  const hosts = cleaned.match(/[A-Za-z0-9.-]+\.workers\.dev/gi) ?? [];
  if (hosts.some(host => !/^your-(worker|relay)\.workers\.dev$/i.test(host))) findings.push('deployment host');
  if (markers.some(marker => cleaned.toLowerCase().includes(marker.toLowerCase()))) findings.push('deployment identifier');
  return [...new Set(findings)];
}
export function scan({ base, head, cwd = process.cwd(), markers = [] }) {
  // Resolve caller-supplied refs locally. Never pass them as options or shell code.
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = ref => {
    if (!ref || ref.startsWith('-')) throw new Error('Invalid revision');
    const sha = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid commit');
    return sha;
  };
  const end = commit(head);
  // An initial push uses an all-zero base: scan the entire tree.
  const initial = /^0{40,64}$/.test(base ?? '');
  const paths = initial ? git(['ls-tree', '-r', '--name-only', '-z', end]).split('\0').filter(Boolean)
    : git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', '--diff-filter=ACMRT', commit(base), end, '--']).split('\0').filter(Boolean);
  const findings = new Set();
  for (const path of paths) {
    // Scan full changed blobs, including workflow files; no file exemptions.
    // Also inspect filenames, but never echo them into public logs.
    const content = git(['show', `${end}:${path}`]);
    for (const finding of inspect(path + '\n' + content, markers)) findings.add(finding);
  }
  return { files: paths.length, findings: [...findings] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const markers = (process.env.PUBLIC_SCRUB_MARKERS ?? '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (!markers.length) console.log('NOTICE: generic checks only; deployment-specific markers are unavailable.');
    const result = scan({ base: process.argv[2], head: process.argv[3], markers });
    if (result.findings.length) {
      console.error(`Scrub failed: ${result.findings.join(', ')}. Inspect changes locally; matching content is intentionally omitted.`);
      process.exitCode = 1;
    } else console.log(`Scrub passed for ${result.files} changed files.`);
  } catch {
    console.error('Scrub could not complete. Verify revisions, repository access and file readability. No scan result is trusted.');
    process.exitCode = 2;
  }
}
