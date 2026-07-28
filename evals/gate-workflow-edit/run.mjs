#!/usr/bin/env node
// Regression eval for scripts/check-gate-workflow-edit.mjs — pins the gate-workflow-edit
// advisory: it names `.github/workflows/deep-review.yml` and `.github/workflows/opsec-gate.yml`
// when a diff touches them, stays quiet (OK line) when it doesn't, ignores a non-gate workflow
// edit, and fails open (exit 0, skip note) when `--base` does not resolve as a git ref. The
// script is documented as advisory-only — every path exits 0.
//
//   node evals/gate-workflow-edit/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'check-gate-workflow-edit.mjs');

const fails = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) fails.push(detail ? `${name} — ${String(detail).slice(0, 200)}` : name);
};

// Spawn the real script directly (never a shell string); capture status via the thrown
// error's .status on non-zero exit, per execFileSync semantics.
const run = (args, cwd) => {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 10000 });
    return { status: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

// -c core.autocrlf=false / core.safecrlf=false keep fixture output deterministic regardless
// of the operator's global git config (these disposable repos never leave tmpdir).
const GIT_BASE_OPTS = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
const git = (args, cwd) => execFileSync('git', [...GIT_BASE_OPTS, ...args], { cwd, timeout: 10000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
// -c commit.gpgsign=false scopes only to this disposable fixture repo (deleted at the end of
// this run) so the eval does not depend on the operator's global gpg-signing configuration.
const gitCommit = (cwd, message) =>
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval Runner', '-c', 'commit.gpgsign=false', 'commit', '-m', message], cwd);

const work = mkdtempSync(join(tmpdir(), 'coh-gate-workflow-edit-'));
try {
  const caseDir = join(work, 'repo');
  mkdirSync(caseDir, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], caseDir);

  mkdirSync(join(caseDir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(caseDir, '.github', 'workflows', 'deep-review.yml'), 'name: deep-review\n');
  writeFileSync(join(caseDir, '.github', 'workflows', 'opsec-gate.yml'), 'name: opsec-gate\n');
  writeFileSync(join(caseDir, '.github', 'workflows', 'validate.yml'), 'name: validate\n');
  writeFileSync(join(caseDir, 'README.md'), 'baseline\n');
  git(['add', '-A'], caseDir);
  gitCommit(caseDir, 'base');
  const baseSha = git(['rev-parse', 'HEAD'], caseDir).trim();

  // 1. diff touching neither gate workflow -> OK line, exit 0.
  writeFileSync(join(caseDir, 'README.md'), 'baseline\nedited\n');
  git(['add', '-A'], caseDir);
  gitCommit(caseDir, 'edit readme only');
  const r1 = run(['--base', baseSha], caseDir);
  check('1. neither gate workflow touched exits 0', r1.status === 0, r1.stdout + r1.stderr);
  check('1. reports OK — no gate workflow touched', /OK — no gate workflow/.test(r1.stdout), r1.stdout);
  const afterR1Sha = git(['rev-parse', 'HEAD'], caseDir).trim();

  // 2. diff touching deep-review.yml -> warning naming the file, still exit 0.
  writeFileSync(join(caseDir, '.github', 'workflows', 'deep-review.yml'), 'name: deep-review\nedited: true\n');
  git(['add', '-A'], caseDir);
  gitCommit(caseDir, 'edit deep-review.yml');
  const r2 = run(['--base', afterR1Sha], caseDir);
  check('2. deep-review.yml edit exits 0', r2.status === 0, r2.stdout + r2.stderr);
  check('2. warns GATE WORKFLOW EDITED', /GATE WORKFLOW EDITED/.test(r2.stdout), r2.stdout);
  check('2. names deep-review.yml', r2.stdout.includes('.github/workflows/deep-review.yml'), r2.stdout);
  check('2. does not name opsec-gate.yml', !r2.stdout.includes('opsec-gate.yml'), r2.stdout);
  const afterR2Sha = git(['rev-parse', 'HEAD'], caseDir).trim();

  // 3. diff touching opsec-gate.yml -> warning naming the file, still exit 0. Diffing against
  // afterR2Sha (which already has deep-review.yml's edit baked into both sides) isolates this
  // commit's own change to opsec-gate.yml alone — deep-review.yml is unchanged between the two.
  writeFileSync(join(caseDir, '.github', 'workflows', 'opsec-gate.yml'), 'name: opsec-gate\nedited: true\n');
  git(['add', '-A'], caseDir);
  gitCommit(caseDir, 'edit opsec-gate.yml');
  const r3 = run(['--base', afterR2Sha], caseDir);
  check('3. opsec-gate.yml edit exits 0', r3.status === 0, r3.stdout + r3.stderr);
  check('3. warns GATE WORKFLOW EDITED', /GATE WORKFLOW EDITED/.test(r3.stdout), r3.stdout);
  check('3. names opsec-gate.yml', r3.stdout.includes('.github/workflows/opsec-gate.yml'), r3.stdout);
  check('3. does not name deep-review.yml', !r3.stdout.includes('deep-review.yml'), r3.stdout);
  const afterR3Sha = git(['rev-parse', 'HEAD'], caseDir).trim();

  // 4. diff touching both gate workflows -> both named.
  writeFileSync(join(caseDir, '.github', 'workflows', 'deep-review.yml'), 'name: deep-review\nedited: 2\n');
  writeFileSync(join(caseDir, '.github', 'workflows', 'opsec-gate.yml'), 'name: opsec-gate\nedited: 2\n');
  git(['add', '-A'], caseDir);
  gitCommit(caseDir, 'edit both gate workflows');
  const r4 = run(['--base', afterR3Sha], caseDir);
  check('4. both gate workflows edited exits 0', r4.status === 0, r4.stdout + r4.stderr);
  check('4. names deep-review.yml', r4.stdout.includes('.github/workflows/deep-review.yml'), r4.stdout);
  check('4. names opsec-gate.yml', r4.stdout.includes('.github/workflows/opsec-gate.yml'), r4.stdout);
  const afterR4Sha = git(['rev-parse', 'HEAD'], caseDir).trim();

  // 5. unresolvable base ref -> fail-open: exit 0 with a skip note naming the base ref.
  const r5 = run(['--base', 'bogus-ref-zzz'], caseDir);
  check('5. unresolvable --base exits 0 (fail-open)', r5.status === 0, r5.stdout + r5.stderr);
  check(
    "5. reports a skip note (\"did not resolve\" ... \"skipping\")",
    r5.stdout.includes("bogus-ref-zzz") && r5.stdout.includes('did not resolve') && r5.stdout.includes('skipping'),
    r5.stdout
  );

  // 6. a non-gate workflow file (validate.yml) touched -> no warning.
  writeFileSync(join(caseDir, '.github', 'workflows', 'validate.yml'), 'name: validate\nedited: true\n');
  git(['add', '-A'], caseDir);
  gitCommit(caseDir, 'edit validate.yml only');
  const r6 = run(['--base', afterR4Sha], caseDir);
  check('6. validate.yml-only edit exits 0', r6.status === 0, r6.stdout + r6.stderr);
  check('6. reports OK — no gate workflow touched', /OK — no gate workflow/.test(r6.stdout), r6.stdout);
  check('6. no warning emitted', !r6.stdout.includes('GATE WORKFLOW EDITED'), r6.stdout);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} gate-workflow-edit regression check(s) failed:`);
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('\nOK — all gate-workflow-edit regression checks passed.');
