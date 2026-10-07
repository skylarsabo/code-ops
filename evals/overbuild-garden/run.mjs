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
//     planted items go dark and the score fails, proving the eval can fail;
//   - the touched-file delta advisory on a second throwaway repository (delta/): a net-negative
//     file that drops a pass-through and a duplicate helper reads improved, a net-positive file
//     that adds a pass-through reads worse, a file that edits neither reads unchanged, the
//     advisory adds no hit, and a mutant that cuts the removed-line read loses the improved verdict.

import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const scanner = join(root, 'scripts', 'scan-overbuild.mjs');
const scorer = join(root, 'evals', 'score.mjs');
const key = join(here, 'ANSWER_KEY.json');
const { fails, expect } = tally();
const run = (args, opts = {}) => spawnSync('node', args, { encoding: 'utf8', cwd: root, ...opts });

// ---------------------------------------------------------------- the key resolves
const check = run([scorer, key, '--check']);
expect(check.status === 0, `answer key must match the fixture: ${check.stdout}${check.stderr}`);

// ---------------------------------------------------------------- the throwaway repositories
// A throwaway git repository: the `base` tree is the first commit, the `change` tree overlays the second.
function makeRepo(prefix, baseDir, changeDir) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=garden', '-c', 'user.email=garden@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
    return r.stdout;
  };
  git('init', '-q');
  cpSync(baseDir, dir, { recursive: true });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  cpSync(changeDir, dir, { recursive: true });
  git('add', '-A');
  git('commit', '-q', '-m', 'change');
  return dir;
}
const work = makeRepo('overbuild-garden-', join(here, 'repo', 'base'), join(here, 'repo', 'change'));
const deltaWork = makeRepo('overbuild-delta-', join(here, 'delta', 'base'), join(here, 'delta', 'change'));

const keyData = JSON.parse(readFileSync(key, 'utf8'));
const tol = keyData.lineTolerance ?? 3;
const near = (h, items) => items.some((it) => it.file === h.file && Math.abs(it.line - h.line) <= tol);

function scan(script, extra = [], cwd = work) {
  const r = run([script, '--git', 'HEAD~1..HEAD', '--root', cwd, '--json', ...extra]);
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
  expect(/\(blocking\)/.test(plain.stdout) && /15 over-build tell\(s\), 1 blocking/.test(plain.stdout), `the text report names the tally, got:\n${plain.stdout}`);
  expect(parsed?.addedLines > 0 && parsed.netLines === parsed.addedLines - parsed.removedLines, `--json must report added, removed, and net lines, got ${JSON.stringify(parsed && [parsed.addedLines, parsed.removedLines, parsed.netLines])}`);
  const tells = new Set(hits.map((h) => h.tell));
  for (const t of ['NEW-FILE-RATIO', 'SINGLE-IMPLEMENTOR', 'PASS-THROUGH', 'NEW-DEPENDENCY', 'TEST-BLOAT', 'UNREAD-CONFIG', 'DUPLICATE-HELPER', 'COMMENTED-CODE', 'NEW-SUPPRESSION', 'PLACEHOLDER-COMMENT', 'EMOJI-IN-CODE']) {
    expect(tells.has(t), `${t} must fire at least once on the garden`);
  }
  const recallLine = (score.stdout.match(/Recall:.*$/m) ?? [''])[0].trim();
  const fpLine = (score.stdout.match(/False positives:.*$/m) ?? [''])[0].trim();
  console.log(`ok   ${recallLine}; ${fpLine}; ${hits.length} hits, ${blocking.length} blocking, ${unkeyed.length} unkeyed`);

  // ------------------------------------------------------------ the touched-file delta advisory
  // The garden adds only, so no garden file improves; the delta fixture carries the three cases.
  expect(Array.isArray(parsed?.delta) && parsed.delta.every((d) => d.verdict !== 'improved'), 'a change that only adds must report no improved file');
  const { r: dr, parsed: dp } = scan(scanner, [], deltaWork);
  expect(dr.status === 0 && dp, `the delta fixture must exit 0 with JSON, got ${dr.status}: ${dr.stderr}`);
  const verdictOf = (file) => dp?.delta.find((d) => d.file === file);
  const neg = verdictOf('src/neg.js');
  expect(neg?.verdict === 'improved' && neg.adds.length === 0, `net-negative src/neg.js must be improved, got ${JSON.stringify(neg)}`);
  expect(neg?.removes.some((p) => p.tell === 'PASS-THROUGH' && p.name === 'getThing' && p.line === 5), 'the advisory must name the removed pass-through getThing at base line 5');
  expect(neg?.removes.some((p) => p.tell === 'DUPLICATE-HELPER' && p.name === 'clamp'), 'the advisory must name the removed duplicate helper clamp');
  const pos = verdictOf('src/pos.js');
  expect(pos?.verdict === 'worse' && pos.adds.some((p) => p.tell === 'PASS-THROUGH' && p.name === 'getPos'), `net-positive src/pos.js must be worse, got ${JSON.stringify(pos)}`);
  expect(verdictOf('src/same.js')?.verdict === 'unchanged', 'src/same.js carries neither pattern and must be unchanged');
  expect(!verdictOf('src/shared.js'), 'an untouched file must not appear in the delta');
  expect(dp?.hits.length === 1 && dp.hits[0].file === 'src/pos.js', `the advisory must add no hit, only the one added pass-through, got ${JSON.stringify(dp?.hits)}`);
  const dtext = run([scanner, '--git', 'HEAD~1..HEAD', '--root', deltaWork]);
  expect(/1 improved, 1 worse, 0 mixed, 1 unchanged/.test(dtext.stdout) && /~~ IMPROVED +src\/neg\.js:5 +removes PASS-THROUGH getThing \(base line 5\)/.test(dtext.stdout), `the text report names the delta, got:\n${dtext.stdout}`);
  console.log('ok   delta advisory: net-negative improved, net-positive worse, untouched pattern unchanged, no hit added');

  // ------------------------------------------------------------ --exclude drops a prefix
  const { parsed: excluded } = scan(scanner, ['--report-only', '--exclude', 'tests']);
  expect(excluded && !excluded.hits.some((h) => h.file.startsWith('tests/')), '--exclude must drop hits under the prefix');
  console.log('ok   --exclude drops the excluded prefix from the report');

  // ------------------------------------------------------------ mutation control
  const mutantDir = mkdtempSync(join(tmpdir(), 'overbuild-mutant-'));
  const mutant = join(mutantDir, 'scan-overbuild.mjs');
  // The mutant imports its sibling library, so the copy must carry it or the mutant would crash.
  copyFileSync(join(root, 'scripts', 'cli-lib.mjs'), join(mutantDir, 'cli-lib.mjs'));
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
    // The delta mutant ignores removed lines, so the net-negative file reads unchanged.
    const deltaSource = 'const rows = removed.get(file) ?? [];';
    expect(source.includes(deltaSource), 'the mutation control must find the removed-line read to cut');
    writeFileSync(mutant, source.replace(deltaSource, 'const rows = [];'));
    const { parsed: blind } = scan(mutant, [], deltaWork);
    expect(blind?.delta.find((d) => d.file === 'src/neg.js')?.verdict === 'unchanged', 'with the removed-line read cut, src/neg.js must lose its improved verdict');
    console.log('ok   mutation control: cutting the removed-line read loses the improved verdict');
  } finally {
    rmSync(mutantDir, { recursive: true, force: true });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(deltaWork, { recursive: true, force: true });
}

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\noverbuild-garden eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\noverbuild-garden eval passed');
