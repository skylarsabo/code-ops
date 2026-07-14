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
  if (argv[i] === '--need') {
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) { console.error('x --need needs a value'); process.exit(1); }
    needs.push(v);
  } else if (argv[i] === '--artifact-dir') {
    artifactDir = argv[++i];
    if (artifactDir === undefined || artifactDir.startsWith('--')) { console.error('x --artifact-dir needs a value'); process.exit(1); }
  }
}

const errors = [];
const advise = (m) => console.log(`  advisory: ${m}`);
// Every child process carries a timeout so a prompting or shimmed binary degrades
// like a nonzero exit instead of hanging the gate (the no-hang invariant, enforced).
const has = (cmd, args = ['--version']) => {
  try { execFileSync(cmd, args, { stdio: 'ignore', timeout: 5000 }); return true; }
  catch { return false; }
};

if (!has('git')) errors.push('git not resolvable on PATH');
else {
  try {
    // Require literal `true`: a bare repo exits 0 printing `false` and must not pass.
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
    if (out !== 'true') errors.push('not inside a git work tree');
  } catch { errors.push('not inside a git work tree'); }
}
if (!has('node')) errors.push('node not resolvable on PATH');

for (const n of needs) if (!has(n)) errors.push(`required tool not resolvable: ${n}`);

if (artifactDir) {
  const probe = join(artifactDir, '.preflight-probe');
  let wrote = false;
  try {
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(probe, 'ok');
    wrote = true;
  } catch (e) {
    errors.push(`artifact dir not writable: ${artifactDir} (${e.code ?? e.message})`);
  }
  if (wrote) {
    try { rmSync(probe); }
    catch (e) { advise(`probe cleanup failed — stray ${probe} left behind (${e.code ?? e.message})`); }
  }
}

if (process.platform === 'win32') {
  advise('Windows: prefer POSIX sh (Bash tool) over PowerShell for quoting-sensitive commands');
  advise('Windows: 260-char path limit can break deep worktrees; keep artifact paths short');
  try {
    const crlf = execFileSync('git', ['config', '--get', 'core.autocrlf'], { timeout: 5000 }).toString().trim();
    if (crlf === 'true') advise('core.autocrlf=true: diffs may show phantom CRLF churn');
  } catch { /* unset is fine */ }
}

if (errors.length) {
  for (const e of errors) console.error(`  x ${e}`);
  console.error('preflight FAIL — fix before fanning out');
  process.exit(1);
}
console.log('preflight OK');
