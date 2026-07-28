#!/usr/bin/env node
// Regression eval for scripts/calibration-metrics.mjs — pins both modes:
//
//   MODE 1 (--artifacts <dir>): a known fixture ledger (6 rows, one dangling `dispatched`,
//   one `failed`), register (3 CONFIRMED / 2 PROBABLE / 1 SPECULATIVE), refutation log (4
//   receipts, 3 SURVIVED), and an oversize artifact (125 non-blank lines, over the
//   scan-narration hard bound of 120) all resolve to the exact counts/rates/flags asserted
//   below; an empty directory reports every named artifact "not present" and still exits 0;
//   a malformed ledger row is counted as "unparseable: 1", never silently dropped.
//
//   MODE 2 (--validate-note <file>): a clean note passes; a note leaking a unix-style file
//   path fails, naming the line and PATH-UNIX category; a note leaking a fenced code block
//   fails, naming CODE-FENCE; a note that only mentions allowlisted standard artifact
//   filenames and a backticked `plugin:skill` slug passes (the false-positive guard).
//
//   node evals/calibration-metrics/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'calibration-metrics.mjs');

const fails = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) fails.push(detail ? `${name} — ${String(detail).slice(0, 300)}` : name);
};

const run = (args) => {
  try {
    const outp = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000 });
    return { status: 0, stdout: outp, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

const cleanupDirs = [];
try {
  // ---- MODE 1: full fixture artifacts dir -------------------------------------
  const artifactsDir = join(HERE, 'artifacts');
  const a = run(['--artifacts', artifactsDir]);
  check('a. --artifacts exits 0 on a full fixture dir', a.status === 0, a.stdout + a.stderr);

  // Dispatch ledger: 6 rows, one dangling dispatched, one failed.
  check('a. ledger total is 6', /\b6 dispatch\(es\), unparseable: 0\b/.test(a.stdout), a.stdout);
  check('a. dangling rate is 1/6', /dangling rate: 16\.7% \(1\/6\)/.test(a.stdout), a.stdout);
  check('a. failed rate is 1/6', /failed rate: 16\.7% \(1\/6\)/.test(a.stdout), a.stdout);
  check('a. redispatched rate is 1/6', /redispatched rate: 16\.7% \(1\/6\)/.test(a.stdout), a.stdout);

  // Findings register: 3 CONFIRMED / 2 PROBABLE / 1 SPECULATIVE.
  check('a. register total is 6, unparseable 0', /\b6 finding\(s\), unparseable: 0\b/.test(a.stdout), a.stdout);
  check('a. tier breakdown matches', /CONFIRMED 3 \(50\.0%\).*PROBABLE 2 \(33\.3%\).*SPECULATIVE 1 \(16\.7%\)/.test(a.stdout), a.stdout);
  check('a. CONFIRMED ratio is 50.0%', /CONFIRMED ratio: 50\.0%/.test(a.stdout), a.stdout);
  check('a. severity breakdown matches', /HIGH 2.*MEDIUM 2.*LOW 2/s.test(a.stdout), a.stdout);

  // Refutation log: 4 receipts, 3 SURVIVED, 75% survival.
  check('a. refutation total is 4, unparseable 0', /\b4 receipt\(s\), unparseable: 0\b/.test(a.stdout), a.stdout);
  check('a. survival rate is 75.0%', /survival rate: 75\.0%/.test(a.stdout), a.stdout);

  // Oversize artifact: 125 non-blank lines, over the hard bound (120) -> flagged HARD.
  check('a. oversize artifact flagged HARD', /OVERSIZE_ARTIFACT\.md: 125 non-blank line\(s\)\s+!! HARD/.test(a.stdout), a.stdout);

  // Footer carries a HEAD sha (this repo IS a git tree).
  check('a. footer reports a HEAD sha', /HEAD: [0-9a-f]{7,40}|HEAD: unknown/.test(a.stdout), a.stdout);

  // --out writes the same report to a file.
  const outFile = join(mkdtempSync(join(tmpdir(), 'coh-calmetrics-')), 'metrics.txt');
  cleanupDirs.push(dirname(outFile));
  const aOut = run(['--artifacts', artifactsDir, '--out', outFile]);
  check('a. --out exits 0', aOut.status === 0, aOut.stdout + aOut.stderr);
  const written = readFileSync(outFile, 'utf8');
  check('a. --out file contains the dispatch total', /6 dispatch\(es\)/.test(written), written);

  // ---- b. empty directory: every named artifact "not present", exit 0 --------
  const emptyDir = mkdtempSync(join(tmpdir(), 'coh-calmetrics-empty-'));
  cleanupDirs.push(emptyDir);
  const b = run(['--artifacts', emptyDir]);
  check('b. empty dir exits 0', b.status === 0, b.stdout + b.stderr);
  check('b. ledger not present', /## Dispatches[^\n]*\n\s*not present/.test(b.stdout), b.stdout);
  check('b. register not present', /## Findings[^\n]*\n\s*not present/.test(b.stdout), b.stdout);
  check('b. refutation log not present', /## Refutations[^\n]*\n\s*not present/.test(b.stdout), b.stdout);
  check('b. no .md artifacts found for line counts', /\(no \.md artifacts found\)/.test(b.stdout), b.stdout);

  // ---- c. malformed ledger row -> unparseable: 1 ------------------------------
  const malformedDir = join(HERE, 'malformed-ledger');
  const c = run(['--artifacts', malformedDir]);
  check('c. malformed ledger still exits 0 (mode 1 never gates)', c.status === 0, c.stdout + c.stderr);
  check('c. malformed row counted as unparseable: 1', /1 dispatch\(es\), unparseable: 1/.test(c.stdout), c.stdout);

  // ---- MODE 2: note validation -------------------------------------------------
  const notesDir = join(HERE, 'notes');

  const d = run(['--validate-note', join(notesDir, 'clean.md')]);
  check('d. clean note passes (exit 0)', d.status === 0, d.stdout + d.stderr);
  check('d. clean note reports 0 hits', /0 structural hit\(s\)/.test(d.stdout), d.stdout);

  const e = run(['--validate-note', join(notesDir, 'path-note.md')]);
  check('e. path-leaking note fails (exit 1)', e.status === 1, e.stdout + e.stderr);
  check('e. path hit names its line and PATH-UNIX category', /!! PATH-UNIX\s+L\d+/.test(e.stdout), e.stdout);

  const f = run(['--validate-note', join(notesDir, 'fence-note.md')]);
  check('f. code-fence note fails (exit 1)', f.status === 1, f.stdout + f.stderr);
  check('f. fence hit names CODE-FENCE', /!! CODE-FENCE\s+L\d+/.test(f.stdout), f.stdout);

  const g = run(['--validate-note', join(notesDir, 'allowlist-note.md')]);
  check('g. allowlisted-mentions note passes (false-positive guard)', g.status === 0, g.stdout + g.stderr);
  check('g. allowlisted note reports 0 hits', /0 structural hit\(s\)/.test(g.stdout), g.stdout);

  // ---- usage/config errors fail closed at exit 2 -------------------------------
  const h = run([]);
  check('h. no mode flag exits 2', h.status === 2, h.stdout + h.stderr);
  const i = run(['--validate-note', join(notesDir, 'does-not-exist.md')]);
  check('i. missing note file exits 2', i.status === 2, i.stdout + i.stderr);
  const j = run(['--bogus']);
  check('j. unknown flag exits 2', j.status === 2, j.stdout + j.stderr);
} finally {
  for (const d of cleanupDirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} calibration-metrics regression check(s) failed:`);
  for (const fmsg of fails) console.error('  x ' + fmsg);
  process.exit(1);
}
console.log('\nOK — all calibration-metrics regression checks passed.');
