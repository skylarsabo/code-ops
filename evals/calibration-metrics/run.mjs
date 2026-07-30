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
//   `--json <file>` emits those same numbers as one JSON object (ledger/findings/refutations/
//   lineBudget, absent artifacts null) without disturbing the prose report or the exit contract.
//
//   MODE 2 (--validate-note <file>): a clean note passes; a note leaking a unix-style file
//   path fails, naming the line and PATH-UNIX category; a note leaking a fenced code block
//   fails, naming CODE-FENCE; a note that only mentions allowlisted standard artifact
//   filenames and a backticked `plugin:skill` slug passes (the false-positive guard). The
//   Machine block gates too: a note MISSING the `## Machine block` section fails closed naming
//   the template requirement, and a block line that matches no template shape fails closed
//   naming that line — while a fully conforming block (both the counted and the `unknown`
//   variants of the optional lines) stays clean.
//
//   node evals/calibration-metrics/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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

  // ---- r. --json emits the prose numbers machine-readably ---------------------
  const jsonDir = mkdtempSync(join(tmpdir(), 'coh-calmetrics-json-'));
  cleanupDirs.push(jsonDir);
  const jsonFile = join(jsonDir, 'metrics.json');
  const r = run(['--artifacts', artifactsDir, '--json', jsonFile]);
  check('r. --json exits 0', r.status === 0, r.stdout + r.stderr);
  check('r. --json leaves the prose report intact', /6 dispatch\(es\)/.test(r.stdout) && /survival rate: 75\.0%/.test(r.stdout), r.stdout);
  let mj = null;
  try { mj = JSON.parse(readFileSync(jsonFile, 'utf8')); } catch (e) { mj = { parseError: String(e.message) }; }
  check('r. --json output parses', mj && !mj.parseError, JSON.stringify(mj));
  check('r. ledger.total matches the prose total (6)', mj?.ledger?.total === 6, JSON.stringify(mj?.ledger));
  check('r. ledger.malformed is 0', mj?.ledger?.malformed === 0, JSON.stringify(mj?.ledger));
  check('r. ledger.byStatus matches the prose rates (1 dangling, 1 failed, 1 redispatched)',
    mj?.ledger?.byStatus?.dispatched === 1 && mj?.ledger?.byStatus?.failed === 1 && mj?.ledger?.byStatus?.redispatched === 1, JSON.stringify(mj?.ledger?.byStatus));
  check('r. ledger.byModel carries the stamped models and the unstamped count',
    mj?.ledger?.byModel?.['claude-sonnet-5'] === 4 && mj?.ledger?.byModel?.['claude-opus-5'] === 1 && mj?.ledger?.byModel?.unstamped === 1, JSON.stringify(mj?.ledger?.byModel));
  check('r. findings.total matches the prose total (6)', mj?.findings?.total === 6, JSON.stringify(mj?.findings));
  check('r. findings.byTier matches the prose breakdown', mj?.findings?.byTier?.CONFIRMED === 3 && mj?.findings?.byTier?.PROBABLE === 2 && mj?.findings?.byTier?.SPECULATIVE === 1, JSON.stringify(mj?.findings?.byTier));
  check('r. findings.coveredNegatives is 0 for a register with real findings', mj?.findings?.coveredNegatives === 0, JSON.stringify(mj?.findings));
  check('r. refutations.survived matches the prose survival count (3 of 4)',
    mj?.refutations?.total === 4 && mj?.refutations?.survived === 3 && mj?.refutations?.refuted === 1, JSON.stringify(mj?.refutations));
  const oversize = (mj?.lineBudget || []).find((x) => x.file === 'OVERSIZE_ARTIFACT.md');
  check('r. lineBudget carries the oversize artifact with its HARD flag',
    oversize?.nonBlank === 125 && oversize?.entries === null && oversize?.flags?.includes('HARD'), JSON.stringify(oversize));
  const regBudget = (mj?.lineBudget || []).find((x) => x.file === 'FINDINGS_REGISTER.md');
  check('r. a register-shaped file reports its entry count instead of the flat cap', regBudget?.entries === 6, JSON.stringify(regBudget));

  // Covered negatives and phases come from their own fixtures.
  const cnJson = join(jsonDir, 'covered.json');
  const rcn = run(['--artifacts', join(HERE, 'covered-negative'), '--json', cnJson]);
  check('r. --json on the covered-negative fixture exits 0', rcn.status === 0, rcn.stdout + rcn.stderr);
  let cn = null;
  try { cn = JSON.parse(readFileSync(cnJson, 'utf8')); } catch (e) { cn = { parseError: String(e.message) }; }
  check('r. findings.coveredNegatives matches the prose count (3)', cn?.findings?.coveredNegatives === 3, JSON.stringify(cn?.findings));
  check('r. an absent artifact is null, never a measured zero', cn?.ledger === null && cn?.refutations === null, JSON.stringify({ ledger: cn?.ledger, refutations: cn?.refutations }));

  const phJson = join(jsonDir, 'phases.json');
  const rph = run(['--artifacts', join(HERE, 'phase-ledger'), '--json', phJson]);
  check('r. --json on the phase-ledger fixture exits 0', rph.status === 0, rph.stdout + rph.stderr);
  let ph = null;
  try { ph = JSON.parse(readFileSync(phJson, 'utf8')); } catch (e) { ph = { parseError: String(e.message) }; }
  check('r. ledger.phases matches the prose phase lines (Scan=claude-fable-5, 2 rows)',
    ph?.ledger?.phases?.[0]?.title === 'Scan' && ph?.ledger?.phases?.[0]?.lead === 'claude-fable-5' && ph?.ledger?.phases?.[0]?.rows === 2, JSON.stringify(ph?.ledger?.phases));

  const rBoth = run(['--artifacts', artifactsDir, '--json', join(jsonDir, 'both.json'), '--out', join(jsonDir, 'both.txt')]);
  check('r. --json and --out combine', rBoth.status === 0 && /6 dispatch\(es\)/.test(readFileSync(join(jsonDir, 'both.txt'), 'utf8')), rBoth.stdout + rBoth.stderr);
  const rNoVal = run(['--artifacts', artifactsDir, '--json']);
  check('r. --json without a path exits 2', rNoVal.status === 2, rNoVal.stdout + rNoVal.stderr);

  // ---- MODE 2: note validation -------------------------------------------------
  const notesDir = join(HERE, 'notes');

  const d = run(['--validate-note', join(notesDir, 'clean.md')]);
  check('d. clean note passes (exit 0)', d.status === 0, d.stdout + d.stderr);
  check('d. clean note reports 0 hits', /0 structural hit\(s\)/.test(d.stdout), d.stdout);
  check('d. its conforming Machine block reports 0 machine-block hits', /0 machine-block hit\(s\)/.test(d.stdout), d.stdout);

  const e = run(['--validate-note', join(notesDir, 'path-note.md')]);
  check('e. path-leaking note fails (exit 1)', e.status === 1, e.stdout + e.stderr);
  check('e. path hit names its line and PATH-UNIX category', /!! PATH-UNIX\s+L\d+/.test(e.stdout), e.stdout);

  const f = run(['--validate-note', join(notesDir, 'fence-note.md')]);
  check('f. code-fence note fails (exit 1)', f.status === 1, f.stdout + f.stderr);
  check('f. fence hit names CODE-FENCE', /!! CODE-FENCE\s+L\d+/.test(f.stdout), f.stdout);

  const g = run(['--validate-note', join(notesDir, 'allowlist-note.md')]);
  check('g. allowlisted-mentions note passes (false-positive guard)', g.status === 0, g.stdout + g.stderr);
  check('g. allowlisted note reports 0 hits', /0 structural hit\(s\)/.test(g.stdout), g.stdout);
  check('g. the `unknown` severity/coverage variants and both lesson shapes are conforming', /0 machine-block hit\(s\)/.test(g.stdout), g.stdout);

  // ---- s/t. Machine block gates (fail-closed) ---------------------------------
  const s = run(['--validate-note', join(notesDir, 'no-machine-block.md')]);
  check('s. a note with no Machine block fails (exit 1)', s.status === 1, s.stdout + s.stderr);
  check('s. the reason names the missing section and the template requirement',
    /!! MACHINE-BLOCK\s+L\d+\s+no "## Machine block" section — the sanitized-note template requires one/.test(s.stdout), s.stdout);
  check('s. it is otherwise structurally clean (the block is the only reason)', /0 structural hit\(s\)/.test(s.stdout), s.stdout);

  const t = run(['--validate-note', join(notesDir, 'bad-machine-line.md')]);
  check('t. a malformed Machine-block line fails (exit 1)', t.status === 1, t.stdout + t.stderr);
  check('t. the hit names the offending line and the expected shapes',
    /!! MACHINE-LINE\s+L\d+\s+findings: many\s+<- matches no Machine-block shape; expected one of: .*findings: N; confirmed: N/.test(t.stdout), t.stdout);
  check('t. its conforming siblings do not fire', (t.stdout.match(/!! MACHINE-LINE/g) || []).length === 1, t.stdout);

  // ---- u. `unknown` is the tokens line's only non-numeric value ----------------
  // A run with no operative token count must be able to say so (R-001 has none) without the
  // escape widening into arbitrary prose. Same fixture, one word swapped, opposite verdict.
  const tokensNote = join(notesDir, 'tokens-unknown.md');
  const u = run(['--validate-note', tokensNote]);
  check('u. tokens: unknown operative passes (exit 0)', u.status === 0, u.stdout + u.stderr);
  check('u. it reports 0 machine-block hits', /0 machine-block hit\(s\)/.test(u.stdout), u.stdout);
  const badTokensNote = join(jsonDir, 'tokens-many.md');
  writeFileSync(badTokensNote, readFileSync(tokensNote, 'utf8').replace('tokens: unknown operative', 'tokens: many operative'));
  const u2 = run(['--validate-note', badTokensNote]);
  check('u. tokens: many operative still fails closed (exit 1)', u2.status === 1, u2.stdout + u2.stderr);
  check('u. the hit names that line', /!! MACHINE-LINE\s+L\d+\s+tokens: many operative; dispatches: 9/.test(u2.stdout), u2.stdout);

  // ---- v. `unknown` is the paneled line's only non-numeric denominator ---------
  // The ingest side (scripts/calibration-graph.mjs) accepts an unknown eligible-panel
  // denominator and maps it to panelEligible null, so the note gate must accept the same line —
  // the two hand-written grammars drifting apart is what this pins.
  const cleanNote = readFileSync(join(notesDir, 'clean.md'), 'utf8');
  const PANELED_LINE = 'paneled: 6 of 6 eligible; survived: 4; repro-exempt: 0';
  const unknownPanelNote = join(jsonDir, 'paneled-unknown.md');
  writeFileSync(unknownPanelNote, cleanNote.replace(PANELED_LINE, 'paneled: 2 of unknown eligible; survived: 2; repro-exempt: 0'));
  const v1 = run(['--validate-note', unknownPanelNote]);
  check('v. an unknown eligible denominator passes (exit 0)', v1.status === 0, v1.stdout + v1.stderr);
  check('v. it reports 0 machine-block hits', /0 machine-block hit\(s\)/.test(v1.stdout), v1.stdout);
  const badPanelNote = join(jsonDir, 'paneled-some.md');
  writeFileSync(badPanelNote, cleanNote.replace(PANELED_LINE, 'paneled: 2 of some eligible; survived: 2; repro-exempt: 0'));
  const v2 = run(['--validate-note', badPanelNote]);
  check('v. an arbitrary word in the denominator still fails closed (exit 1)', v2.status === 1, v2.stdout + v2.stderr);
  check('v. the hit names that line', /!! MACHINE-LINE\s+L\d+\s+paneled: 2 of some eligible/.test(v2.stdout), v2.stdout);

  // The two leak fixtures now carry conforming blocks, so each still fails for exactly its
  // original reason rather than for a missing block.
  check('e. path note fails only on the path, not the Machine block', /0 machine-block hit\(s\)/.test(e.stdout), e.stdout);
  check('f. fence note fails only on the fence, not the Machine block', /0 machine-block hit\(s\)/.test(f.stdout), f.stdout);

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
