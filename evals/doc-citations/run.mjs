#!/usr/bin/env node
// Regression eval for scripts/check-doc-citations.mjs — pins the handbook doc line-citation
// gate: valid single-line and range citations pass, an out-of-bounds line number and a missing
// cited file fail closed naming the doc line and reason, a citation inside a fenced code block
// is ignored, an inverted range (M < N) fails closed, and an unknown/blank flag is rejected as
// a bad invocation.
//
//   node evals/doc-citations/run.mjs   (exit 0 = pass)
//
// The script enumerates docs via `git ls-files`, so each case builds a throwaway git repo
// (never the real repo tree) with its own <case>/scripts/check-doc-citations.mjs copy, a
// scripts/target.mjs fixture of exactly 10 lines, and a docs/handbook/test.md carrying the
// citation(s) under test.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT_SRC = join(REPO, 'scripts', 'check-doc-citations.mjs');

const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };

// Spawn the real script directly (never a shell string); capture status via the thrown
// error's .status on non-zero exit, per execFileSync semantics.
const run = (scriptPath, args, cwd) => {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', timeout: 10000, cwd });
    return { status: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

// -c core.autocrlf=false / core.safecrlf=false keep fixture output deterministic and quiet
// regardless of the operator's global git config (these disposable repos never leave tmpdir).
const GIT_BASE_OPTS = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
const git = (args, cwd) => execFileSync('git', [...GIT_BASE_OPTS, ...args], { cwd, timeout: 10000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
// -c commit.gpgsign=false scopes only to these disposable fixture repos (deleted at the end of
// this run) so the eval does not depend on the operator's global gpg-signing configuration.
const gitCommit = (cwd, message) =>
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval Runner', '-c', 'commit.gpgsign=false', 'commit', '-m', message], cwd);

// Exactly 10 lines, trailing newline included (lineCount does not add a line for a trailing \n).
const TARGET_MJS = Array.from({ length: 10 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n';

const work = mkdtempSync(join(tmpdir(), 'coh-doc-citations-'));

function buildCase(caseName, docBody) {
  const caseDir = join(work, caseName);
  const scriptsDir = join(caseDir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, 'check-doc-citations.mjs'), readFileSync(SCRIPT_SRC));
  writeFileSync(join(scriptsDir, 'target.mjs'), TARGET_MJS);
  const handbookDir = join(caseDir, 'docs', 'handbook');
  mkdirSync(handbookDir, { recursive: true });
  writeFileSync(join(handbookDir, 'test.md'), docBody);
  git(['init', '--quiet', '-b', 'main'], caseDir);
  git(['add', '-A'], caseDir);
  gitCommit(caseDir, 'seed fixture');
  return { scriptPath: join(scriptsDir, 'check-doc-citations.mjs'), caseDir };
}

try {
  // a. valid single-line + range citations -> exit 0
  {
    const doc = ['# Test doc', '', 'See `scripts/target.mjs:3` for the entry point.', 'The setup block is `scripts/target.mjs:2-9`.', ''].join('\n');
    const { scriptPath, caseDir } = buildCase('valid', doc);
    const r = run(scriptPath, [], caseDir);
    check('a. valid single-line + range citations exit 0', r.status === 0);
    check('a. stdout reports OK', r.stdout.includes('OK'));
  }

  // b. out-of-bounds line number -> exit 1, names the doc line and the reason
  {
    const doc = ['# Test doc', '', 'See `scripts/target.mjs:11` here (past the end).', ''].join('\n');
    const { scriptPath, caseDir } = buildCase('oob', doc);
    const r = run(scriptPath, [], caseDir);
    check('b. out-of-bounds line exits 1', r.status === 1);
    check('b. names the doc:line (test.md:3)', r.stderr.includes('docs/handbook/test.md:3'));
    check("b. names the reason (exceeds target's line count)", r.stderr.includes("exceeds target's 10 line(s)"));
  }

  // c. missing cited file -> exit 1
  {
    const doc = ['# Test doc', '', 'See `scripts/nope.mjs:1` here (does not exist).', ''].join('\n');
    const { scriptPath, caseDir } = buildCase('missing', doc);
    const r = run(scriptPath, [], caseDir);
    check('c. missing cited file exits 1', r.status === 1);
    check('c. reason names the missing file', r.stderr.includes('target file does not exist'));
  }

  // d. a citation inside a fenced code block is ignored -> exit 0
  {
    const doc = ['# Test doc', '', '```text', 'scripts/nope.mjs:999 fake citation inside a fence', '```', ''].join('\n');
    const { scriptPath, caseDir } = buildCase('fenced', doc);
    const r = run(scriptPath, [], caseDir);
    check('d. fenced citation is ignored, exits 0', r.status === 0);
  }

  // e. inverted range (M < N) -> exit 1 (checkCitation enforces endLn >= startLn; pinning that
  // actual behavior here, per source read of scripts/check-doc-citations.mjs)
  {
    const doc = ['# Test doc', '', 'See `scripts/target.mjs:9-2` here (reversed range).', ''].join('\n');
    const { scriptPath, caseDir } = buildCase('inverted', doc);
    const r = run(scriptPath, [], caseDir);
    check('e. inverted range exits 1', r.status === 1);
    check('e. reason names the reversed range', r.stderr.includes('range end 2 is before start 9'));
  }

  // f. unknown flag -> exit 2 (this script takes zero flags; any argv is rejected)
  {
    const { scriptPath, caseDir } = buildCase('badflag', '# empty\n');
    const r = run(scriptPath, ['--verbose'], caseDir);
    check('f. unknown flag exits 2', r.status === 2);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} doc-citations regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all doc-citations regression checks passed.');
