#!/usr/bin/env node
// Regression eval for scripts/calibration-metrics.mjs — pins both modes:
//
//   MODE 1 (--artifacts <dir>): a known fixture ledger (6 rows, one dangling `dispatched`,
//   one `failed`), register (3 CONFIRMED / 2 PROBABLE / 1 SPECULATIVE), refutation log (4
//   receipts, 3 SURVIVED), and an oversize artifact (125 non-blank lines, over the
//   scan-narration hard bound of 120) all resolve to the exact counts/rates/flags asserted
//   below; an empty directory reports every named artifact "not present" and still exits 0;
//   a malformed ledger row is counted as "unparseable: 1", never silently dropped. Entry
//   detection is anchored and lettered-ID-aware (BUG-A12 heads an entry; a BUG-003 cited in
//   evidence prose does not), register-shaped files get the per-entry length budget instead of
//   the flat cap, a themed sibling report carrying entries warns they are uncounted, a
//   NO-FINDINGS-only register reports covered negatives instead of the zero-parse warning, and
//   `> phase:` markers resolve to a lead-model-per-phase line plus a mid-run-change advisory.
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

  // Tier mix: 4 stamped claude-sonnet-5, 1 stamped claude-opus-5, 1 legacy unstamped row.
  check('a. tier mix reports stamped models and the unstamped count', /tier mix: .*claude-sonnet-5 4.*claude-opus-5 1.*unstamped 1/.test(a.stdout), a.stdout);

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

  // ---- k. non-empty, zero-parseable-row ledger -> WARNING naming it -----------
  const zeroParseDir = join(HERE, 'zero-parse-ledger');
  const k = run(['--artifacts', zeroParseDir]);
  check('k. zero-parse ledger still exits 0 (mode 1 never gates)', k.status === 0, k.stdout + k.stderr);
  check('k. zero-parse ledger reports 0 dispatches, unparseable 0', /\b0 dispatch\(es\), unparseable: 0\b/.test(k.stdout), k.stdout);
  check('k. zero-parse ledger emits a WARNING naming the artifact and the grammars doc', /!! WARNING: DISPATCH_LEDGER\.md is present and non-empty but yielded 0 parsed items.*artifact-grammars\.md/.test(k.stdout), k.stdout);

  // ---- l. lettered IDs parse; IDs cited in prose do NOT open an entry ----------
  // Fixture: two entries headed BUG-A12 / BUG-A13 whose bodies cite BUG-003 and INC-2024/5.
  // The digits-only pattern saw neither head and counted 4 prose/domain tags instead.
  const l = run(['--artifacts', join(HERE, 'lettered-and-prose')]);
  check('l. lettered-ID register exits 0', l.status === 0, l.stdout + l.stderr);
  check('l. exactly 2 findings — prose IDs and domain tags open no entry', /\b2 finding\(s\), unparseable: 0\b/.test(l.stdout), l.stdout);
  check('l. both lettered entries are tiered', /CONFIRMED 1 \(50\.0%\), PROBABLE 1 \(50\.0%\)/.test(l.stdout), l.stdout);
  check('l. per-entry sweep sees 2 entries', /FINDINGS_REGISTER\.md: \d+ non-blank line\(s\) across 2 entry\(ies\)/.test(l.stdout), l.stdout);

  // ---- m/n. per-entry length budget replaces the flat cap for registers -------
  const m = run(['--artifacts', join(HERE, 'tight-register')]);
  check('m. 40-entry tight register exits 0', m.status === 0, m.stdout + m.stderr);
  check('m. all 40 entries counted', /\b40 finding\(s\), unparseable: 0\b/.test(m.stdout), m.stdout);
  check('m. 161 non-blank lines across 40 entries, no HARD flag (flat cap would have fired)',
    /FINDINGS_REGISTER\.md: 161 non-blank line\(s\) across 40 entry\(ies\)/.test(m.stdout) && !/!! HARD/.test(m.stdout), m.stdout);

  const n = run(['--artifacts', join(HERE, 'bloated-entry')]);
  check('n. bloated-entry register still exits 0 (mode 1 never gates)', n.status === 0, n.stdout + n.stderr);
  check('n. the one bloated entry is named HARD', /FIND-004: 26 non-blank line\(s\)\s+!! HARD/.test(n.stdout), n.stdout);
  check('n. its tight siblings are not flagged', (n.stdout.match(/!! HARD/g) || []).length === 1, n.stdout);

  // ---- o. themed sibling report: entries written outside the register ---------
  const o = run(['--artifacts', join(HERE, 'sibling-report')]);
  check('o. sibling-report dir exits 0', o.status === 0, o.stdout + o.stderr);
  check('o. sibling report warns its entries are not counted, pointing at the register + grammars',
    /!! WARNING: SECURITY_REPORT\.md carries 2 register-shaped entry\(ies\) that are NOT counted[\s\S]*FINDINGS_REGISTER\.md[\s\S]*artifact-grammars\.md/.test(o.stdout), o.stdout);
  check('o. the three metric artifacts never trip the sibling warning', !/!! WARNING/.test(a.stdout), a.stdout);

  // ---- p. covered negatives: a clean slice is not shape drift -----------------
  const pcn = run(['--artifacts', join(HERE, 'covered-negative')]);
  check('p. covered-negative register exits 0', pcn.status === 0, pcn.stdout + pcn.stderr);
  check('p. covered negatives are counted', /covered negatives: 3/.test(pcn.stdout), pcn.stdout);
  check('p. a NO-FINDINGS-only register reports covered negatives, not the zero-parse warning',
    /covered-negative register: 3 slice\(s\) declared clear/.test(pcn.stdout) && !/!! WARNING/.test(pcn.stdout), pcn.stdout);
  check('p. a register with real findings reports zero covered negatives', /covered negatives: 0/.test(a.stdout), a.stdout);

  // ---- q. phase markers: which model LED each stretch of the run --------------
  const q = run(['--artifacts', join(HERE, 'phase-ledger')]);
  check('q. phase-marked ledger exits 0', q.status === 0, q.stdout + q.stderr);
  check('q. lead model reported per phase', /lead model by phase: Scan=claude-fable-5, Fix=claude-opus-5/.test(q.stdout), q.stdout);
  check('q. rows attributed to the phase they follow', /dispatches by phase: Scan 2, Fix 1/.test(q.stdout), q.stdout);
  check('q. a mid-run lead change is advised (report-only)', /advisory: lead model changed mid-run \(claude-fable-5 -> claude-opus-5\)/.test(q.stdout), q.stdout);
  check('q. a ledger with no phase markers reports nothing new', !/lead model by phase/.test(a.stdout), a.stdout);

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
