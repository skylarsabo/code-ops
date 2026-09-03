#!/usr/bin/env node
// Regression eval for scripts/scan-overbuild.mjs: the decoy garden.
//
//   node evals/overbuild-garden/run.mjs
//
// Why: the scanner is a floor under the size-and-boundary lens, and a floor that flags a good
// extraction teaches the wrong lesson. This eval scores it the way hasty-code scores a skill:
// recall over the planted over-builds and a zero-decoy bar over legitimate extractions, needed
// interfaces, neighbor-sized tests, recorded dependencies, and read config keys.
//
// The scanner reads a git range, so the run builds a throwaway repository in the OS temp dir:
// repo/base/ is the first commit, repo/change/ is overlaid as the second, and the scanner runs
// on HEAD~1..HEAD there. The tree under repo/ is never itself a git repository.
//
// Checks:
//   - the answer key anchors resolve in repo/change (score.mjs --check);
//   - the scanner's --json hits score at or above the key's recall bar with no decoy flagged;
//   - no hit lands outside the key (an unkeyed hit is noise the key does not license);
//   - exactly one blocking tell, so the exit code is 1 plain and 0 under --report-only;
//   - a mutation control: with the new-file bound removed in a temp copy of the scanner, three
//     planted items go dark and the score fails, proving the eval can fail.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const scanner = join(root, 'scripts', 'scan-overbuild.mjs');
const scorer = join(root, 'evals', 'score.mjs');
const key = join(here, 'ANSWER_KEY.json');
const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };
const run = (args, opts = {}) => spawnSync('node', args, { encoding: 'utf8', cwd: root, ...opts });

// ---------------------------------------------------------------- the key resolves
const check = run([scorer, key, '--check']);
expect(check.status === 0, `answer key must match the fixture: ${check.stdout}${check.stderr}`);

// ---------------------------------------------------------------- the throwaway repository
const work = mkdtempSync(join(tmpdir(), 'overbuild-garden-'));
const git = (...args) => {
  const r = spawnSync('git', ['-c', 'user.name=garden', '-c', 'user.email=garden@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd: work, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  return r.stdout;
};
git('init', '-q');
cpSync(join(here, 'repo', 'base'), work, { recursive: true });
git('add', '-A');
git('commit', '-q', '-m', 'base');
cpSync(join(here, 'repo', 'change'), work, { recursive: true });
git('add', '-A');
git('commit', '-q', '-m', 'change');

const keyData = JSON.parse(readFileSync(key, 'utf8'));
const tol = keyData.lineTolerance ?? 3;
const near = (h, items) => items.some((it) => it.file === h.file && Math.abs(it.line - h.line) <= tol);

function scan(script, extra = []) {
  const r = run([script, '--git', 'HEAD~1..HEAD', '--root', work, '--json', ...extra]);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* reported below */ }
  return { r, parsed };
}

try {
  // ------------------------------------------------------------ score the real scanner
  const { r, parsed } = scan(scanner, ['--report-only']);
  expect(r.status === 0 && parsed, `scanner --json --report-only must exit 0 with JSON, got ${r.status}: ${r.stderr}`);
  const hits = parsed?.hits ?? [];
  const candidate = join(work, 'candidate.json');
  writeFileSync(candidate, JSON.stringify(hits.map((h) => ({ file: h.file, line: h.line, tell: h.tell }))));
  const score = run([scorer, key, candidate]);
  expect(score.status === 0, `the scanner must clear the key's recall bar with no decoy flagged:\n${score.stdout}`);
  const unkeyed = hits.filter((h) => !near(h, keyData.planted) && !near(h, keyData.decoys));
  expect(unkeyed.length === 0, `every hit must land on a keyed line, got ${JSON.stringify(unkeyed)}`);
  const blocking = hits.filter((h) => h.blocking);
  expect(blocking.length === 1 && blocking[0].tell === 'NEW-DEPENDENCY', `exactly one blocking tell, the unrecorded dependency, got ${JSON.stringify(blocking)}`);
  const plain = run([scanner, '--git', 'HEAD~1..HEAD', '--root', work]);
  expect(plain.status === 1, `a blocking tell must exit 1 without --report-only, got ${plain.status}`);
  expect(/\(blocking\)/.test(plain.stdout) && /11 over-build tell\(s\), 1 blocking/.test(plain.stdout), `the text report names the tally, got:\n${plain.stdout}`);
  const tells = new Set(hits.map((h) => h.tell));
  for (const t of ['NEW-FILE-RATIO', 'SINGLE-IMPLEMENTOR', 'PASS-THROUGH', 'NEW-DEPENDENCY', 'TEST-BLOAT', 'UNREAD-CONFIG', 'DUPLICATE-HELPER', 'COMMENTED-CODE']) {
    expect(tells.has(t), `${t} must fire at least once on the garden`);
  }
  const recallLine = (score.stdout.match(/Recall:.*$/m) ?? [''])[0].trim();
  const fpLine = (score.stdout.match(/False positives:.*$/m) ?? [''])[0].trim();
  console.log(`ok   ${recallLine}; ${fpLine}; ${hits.length} hits, ${blocking.length} blocking, ${unkeyed.length} unkeyed`);

  // ------------------------------------------------------------ --exclude drops a prefix
  const { parsed: excluded } = scan(scanner, ['--report-only', '--exclude', 'tests']);
  expect(excluded && !excluded.hits.some((h) => h.file.startsWith('tests/')), '--exclude must drop hits under the prefix');
  console.log('ok   --exclude drops the excluded prefix from the report');

  // ------------------------------------------------------------ mutation control
  const mutantDir = mkdtempSync(join(tmpdir(), 'overbuild-mutant-'));
  const mutant = join(mutantDir, 'scan-overbuild.mjs');
  const source = readFileSync(scanner, 'utf8');
  expect(source.includes('const NEW_FILE_MIN_LINES = 44;'), 'the mutation control must find the new-file bound to remove');
  writeFileSync(mutant, source.replace('const NEW_FILE_MIN_LINES = 44;', 'const NEW_FILE_MIN_LINES = 0;'));
  try {
    const { parsed: mutated } = scan(mutant, ['--report-only']);
    const mutantCandidate = join(work, 'mutant.json');
    writeFileSync(mutantCandidate, JSON.stringify((mutated?.hits ?? []).map((h) => ({ file: h.file, line: h.line }))));
    const mutantScore = run([scorer, key, mutantCandidate]);
    expect(mutantScore.status !== 0, 'with the new-file bound removed the score must fail, or the eval cannot fail');
    expect(!(mutated?.hits ?? []).some((h) => h.tell === 'NEW-FILE-RATIO'), 'the mutant must lose every NEW-FILE-RATIO hit');
    console.log('ok   mutation control: removing the new-file bound fails the score');
  } finally {
    rmSync(mutantDir, { recursive: true, force: true });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\noverbuild-garden eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\noverbuild-garden eval passed');
