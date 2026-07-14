#!/usr/bin/env node
// Phase-0 environment preflight for orchestrated runs.
// WHY: env/permission failures should stop a run BEFORE the fan-out, not strand it
// mid-wave. Hard-fails only on requirements no run can proceed without; everything
// OS-specific is an advisory. Never invoked mid-run (must not become a hang source).
//   node scripts/preflight.mjs [--need gh] [--artifact-dir <dir>]
// Exit 0 = go (advisories allowed), 1 = hard requirement missing.

import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const needs = [];
let artifactDir = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--need') needs.push(argv[++i]);
  else if (argv[i] === '--artifact-dir') artifactDir = argv[++i];
}

const errors = [];
const advise = (m) => console.log(`  advisory: ${m}`);
const has = (cmd, args = ['--version']) => {
  try { execFileSync(cmd, args, { stdio: 'ignore', shell: process.platform === 'win32' }); return true; }
  catch { return false; }
};

if (!has('git')) errors.push('git not resolvable on PATH');
else {
  try { execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' }); }
  catch { errors.push('not inside a git work tree'); }
}
if (!has('node')) errors.push('node not resolvable on PATH');

for (const n of needs) if (!has(n)) errors.push(`required tool not resolvable: ${n}`);

if (artifactDir) {
  try {
    mkdirSync(artifactDir, { recursive: true });
    const probe = join(artifactDir, '.preflight-probe');
    writeFileSync(probe, 'ok');
    rmSync(probe);
  } catch (e) {
    errors.push(`artifact dir not writable: ${artifactDir} (${e.code ?? e.message})`);
  }
}

if (process.platform === 'win32') {
  advise('Windows: prefer POSIX sh (Bash tool) over PowerShell for quoting-sensitive commands');
  advise('Windows: 260-char path limit can break deep worktrees; keep artifact paths short');
  try {
    const crlf = execFileSync('git', ['config', '--get', 'core.autocrlf']).toString().trim();
    if (crlf === 'true') advise('core.autocrlf=true: diffs may show phantom CRLF churn');
  } catch { /* unset is fine */ }
}

if (errors.length) {
  for (const e of errors) console.error(`  x ${e}`);
  console.error('preflight FAIL — fix before fanning out');
  process.exit(1);
}
console.log('preflight OK');
