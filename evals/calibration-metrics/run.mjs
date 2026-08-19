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
//   `> phase:` markers resolve to a lead-model-per-phase line plus a mid-run-change advisory. Four
//   further boundary rules hold: a per-entry budget terminates its entry at a trailing non-entry
//   block, refutation receipts are keyed at line start so prose citing a finding is not a verdict,
//   the sibling-report warning reaches into subdirectories (bounded), and the tool's own report is
//   never read back as one of those siblings.
//   Failed/redispatch rates are derived from the ledger's write journal when one sits beside it,
//   so a unit that failed AND was retried counts toward both rates instead of only its final
//   status; a ledger with no journal keeps the snapshot counting, and a corrupt journal is named
//   and falls back loudly rather than silently.
//   The two conformance snapshots parse under the same rules: CONFORMANCE_REPORT.md's per-surface
//   verdicts and RUN_CONFORMANCE.md's per-check results resolve to their counts, drift rate and
//   discipline rate, an out-of-enum cell is counted unparseable rather than skipped, and a
//   prose-shaped snapshot raises the zero-parse shape-drift warning instead of reporting a clean
//   zero.
//   `--json <file>` emits those same numbers as one JSON object (ledger/findings/refutations/
//   conformance/runConformance/lineBudget, absent artifacts null) without disturbing the prose
//   report or the exit contract.
//
//   MODE 2 (--validate-note <file>): a clean note passes; a note leaking a unix-style file
//   path fails, naming the line and PATH-UNIX category; a note leaking a fenced code block
//   fails, naming CODE-FENCE; a note that only mentions allowlisted standard artifact
//   filenames and a backticked `plugin:skill` slug passes (the false-positive guard). The
//   Machine block gates too: a note MISSING the `## Machine block` section fails closed naming
//   the template requirement, a note filled straight from the doc's own template validates
//   clean (the doc and the gate are pinned against each other), and a block line that matches
//   no template shape fails closed
//   naming that line — while a fully conforming block (both the counted and the `unknown`
//   variants of the optional lines) stays clean. The `atlas:` and `config:` lines are optional in
//   the other sense: a note with no such line stays clean, while a present `atlas:` must carry all
//   four counts and a present `config:` must carry two kebab model-class slugs.
//
//   node evals/calibration-metrics/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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

  // ---- x. an entry ends where it stops being an entry --------------------------
  // A register's trailing covered-negative block (and a mid-file `## Method notes` section) are
  // not part of the entry above them: without a terminator they were attributed to that entry
  // and reliably tripped its hard cap on registers that were themselves perfectly tight.
  const x = run(['--artifacts', join(HERE, 'trailing-covered-negative')]);
  check('x. trailing-block register exits 0', x.status === 0, x.stdout + x.stderr);
  check('x. both entries parse', /\b2 finding\(s\), unparseable: 0\b/.test(x.stdout), x.stdout);
  check('x. its 25 covered negatives are counted', /covered negatives: 25/.test(x.stdout), x.stdout);
  check('x. neither entry is flagged — a non-entry trailing block terminates the entry above it',
    !/!! HARD/.test(x.stdout) && !/\.\. advisory/.test(x.stdout), x.stdout);

  // ---- y. refutation receipts are keyed at line start, not mid-line ------------
  // Explanatory prose that cites a finding ("read BUG-001 as a duplicate of BUG-003") is not a
  // receipt: unanchored, one such line became "unparseable" and another — because it happened to
  // contain the word REFUTED — was counted as a second verdict for a finding already receipted.
  const y = run(['--artifacts', join(HERE, 'prose-refutation')]);
  check('y. prose-refutation dir exits 0', y.status === 0, y.stdout + y.stderr);
  check('y. exactly 2 receipts, prose lines neither counted nor unparseable',
    /\b2 receipt\(s\), unparseable: 0\b/.test(y.stdout), y.stdout);
  check('y. the two real verdicts are read straight', /SURVIVED 1 \(50\.0%\), REFUTED 1 \(50\.0%\)/.test(y.stdout), y.stdout);

  // ---- z. the sibling-report warning reaches into subdirectories ---------------
  const z = run(['--artifacts', join(HERE, 'nested-sibling')]);
  check('z. nested-sibling dir exits 0', z.status === 0, z.stdout + z.stderr);
  check('z. a per-slice report in a subdirectory warns, named by its relative path',
    /!! WARNING: slices\/SECURITY_REPORT\.md carries 2 register-shaped entry\(ies\) that are NOT counted/.test(z.stdout), z.stdout);
  check('z. the top-level register itself never trips the warning',
    !/WARNING: FINDINGS_REGISTER\.md carries/.test(z.stdout), z.stdout);
  check('z. the walk is bounded — a dot-directory is not an artifact directory',
    !/HIDDEN_REPORT\.md/.test(z.stdout), z.stdout);

  // ---- aa. the tool's own report is not a themed sibling report ----------------
  // The per-entry length lines it emits ("    FIND-004: 26 non-blank line(s)") sit at entry
  // position, so a report written into the artifacts dir was read back as a register on the next
  // run and warned about as findings written outside the register.
  const selfDir = mkdtempSync(join(tmpdir(), 'coh-calmetrics-self-'));
  cleanupDirs.push(selfDir);
  cpSync(join(HERE, 'bloated-entry'), selfDir, { recursive: true });
  const selfOut = join(selfDir, 'CALIBRATION_METRICS.md');
  const aa1 = run(['--artifacts', selfDir, '--out', selfOut]);
  check('aa. first --out run exits 0 and flags the bloated entry', aa1.status === 0 && /FIND-004: 26 non-blank line\(s\)\s+!! HARD/.test(aa1.stdout), aa1.stdout + aa1.stderr);
  const aa2 = run(['--artifacts', selfDir, '--out', selfOut]);
  check('aa. a second run over its own --out target does not warn about it',
    aa2.status === 0 && !/WARNING: CALIBRATION_METRICS\.md/.test(aa2.stdout), aa2.stdout + aa2.stderr);
  const aa3 = run(['--artifacts', selfDir]);
  check('aa. and a run with no --out still recognizes the report it left behind',
    aa3.status === 0 && !/WARNING: CALIBRATION_METRICS\.md/.test(aa3.stdout), aa3.stdout + aa3.stderr);

  // ---- ac. journal-derived failed/redispatch rates ----------------------------
  // A row's single status cell holds only the FINAL status, so a unit that failed and was then
  // redispatched counted toward exactly one of the two rates — the pair understated recovery.
  // The write journal beside the ledger records every transition, so both hold independently.
  const ac = run(['--artifacts', join(HERE, 'journal-ledger')]);
  check('ac. journal-backed ledger exits 0', ac.status === 0, ac.stdout + ac.stderr);
  check('ac. both rows parse', /\b2 dispatch\(es\), unparseable: 0\b/.test(ac.stdout), ac.stdout);
  check('ac. the failed-then-redispatched unit counts toward the failed rate (snapshot says 0/2)',
    /failed rate: 50\.0% \(1\/2\)/.test(ac.stdout), ac.stdout);
  check('ac. and toward the redispatched rate, independently',
    /redispatched rate: 50\.0% \(1\/2\)/.test(ac.stdout), ac.stdout);
  check('ac. the report says the rates are journal-derived', /rate basis: journal-derived/.test(ac.stdout), ac.stdout);
  check('ac. dangling stays a final-status question', /dangling rate: 0\.0% \(0\/2\)/.test(ac.stdout), ac.stdout);
  check('ac. by status still reports the snapshot (final) statuses',
    /by status: dispatched 0 \(0\.0%\), reported 1 \(50\.0%\), failed 0 \(0\.0%\), redispatched 1 \(50\.0%\)/.test(ac.stdout), ac.stdout);

  const acJson = join(jsonDir, 'journal.json');
  const acj = run(['--artifacts', join(HERE, 'journal-ledger'), '--json', acJson]);
  check('ac. --json on the journal fixture exits 0', acj.status === 0, acj.stdout + acj.stderr);
  let aj = null;
  try { aj = JSON.parse(readFileSync(acJson, 'utf8')); } catch (e) { aj = { parseError: String(e.message) }; }
  check('ac. the machine shape carries the journal-derived ever-counts',
    aj?.ledger?.journal?.derived === true && aj?.ledger?.everFailed === 1 && aj?.ledger?.everRedispatched === 1,
    JSON.stringify(aj?.ledger));

  // A pre-journal artifact folder keeps the snapshot-only counting exactly as before.
  check('ac. a ledger with no journal falls back to snapshot counting, and says so',
    /rate basis: snapshot-only/.test(a.stdout) && /failed rate: 16\.7% \(1\/6\)/.test(a.stdout), a.stdout);

  // ---- ad. a corrupt journal never degrades silently ---------------------------
  const ad = run(['--artifacts', join(HERE, 'corrupt-journal')]);
  check('ad. corrupt-journal dir still exits 0 (mode 1 never gates)', ad.status === 0, ad.stdout + ad.stderr);
  check('ad. the unreadable journal line is named, not swallowed',
    /!! JOURNAL .*J2: unparseable journal line/.test(ad.stdout), ad.stdout);
  check('ad. the fallback to snapshot counting is announced, never silent',
    /rate basis: snapshot-only \(journal present but rejected/.test(ad.stdout), ad.stdout);
  const adJson = join(jsonDir, 'corrupt.json');
  const adj = run(['--artifacts', join(HERE, 'corrupt-journal'), '--json', adJson]);
  let dj = null;
  try { dj = JSON.parse(readFileSync(adJson, 'utf8')); } catch (e) { dj = { parseError: String(e.message) }; }
  check('ad. the machine shape reports the journal as present, rejected, with its violation count',
    adj.status === 0 && dj?.ledger?.journal?.present === true && dj?.ledger?.journal?.derived === false
    && dj?.ledger?.journal?.violations === 1, JSON.stringify(dj?.ledger?.journal));

  // ---- ae. conformance snapshot (grammar (d)) ---------------------------------
  // Standardization drift as a trended series. Same semantics the three older grammars get:
  // a verdict outside the four is unparseable rather than skipped, and a present, non-empty
  // report that yields no rows is shape drift, not an absence of drift.
  const ae = run(['--artifacts', join(HERE, 'conformance')]);
  check('ae. conformance fixture exits 0', ae.status === 0, ae.stdout + ae.stderr);
  check('ae. four surfaces parse, the out-of-enum verdict counted unparseable',
    /\b4 surface\(s\), unparseable: 2\b/.test(ae.stdout), ae.stdout);
  check('ae. per-surface verdict counts are emitted',
    /by verdict: CONFORMANT 1 \(25\.0%\), DRIFTED 1 \(25\.0%\), ABSENT 1 \(25\.0%\), UNKNOWN 1 \(25\.0%\)/.test(ae.stdout), ae.stdout);
  check('ae. drift rate is the non-CONFORMANT share', /drift rate: 75\.0% \(3\/4 not CONFORMANT\)/.test(ae.stdout), ae.stdout);
  check('ae. an UNKNOWN surface is called unmeasured, not conformant',
    /advisory: 1 surface\(s\) UNKNOWN — a checker that could not run proves nothing/.test(ae.stdout), ae.stdout);

  const aeDrift = run(['--artifacts', join(HERE, 'conformance-drift')]);
  check('ae. a prose-shaped conformance report still exits 0', aeDrift.status === 0, aeDrift.stdout + aeDrift.stderr);
  check('ae. and raises the zero-parse shape-drift warning naming the grammars doc',
    /!! WARNING: CONFORMANCE_REPORT\.md is present and non-empty but yielded 0 parsed items.*artifact-grammars\.md/.test(aeDrift.stdout), aeDrift.stdout);

  // ---- af. orchestration conformance (grammar (e)) -----------------------------
  const af = run(['--artifacts', join(HERE, 'run-conformance')]);
  check('af. run-conformance fixture exits 0', af.status === 0, af.stdout + af.stderr);
  check('af. five checks parse, the out-of-enum result counted unparseable',
    /\b5 check\(s\), unparseable: 1\b/.test(af.stdout), af.stdout);
  check('af. per-result counts are emitted',
    /by result: PASS 3 \(60\.0%\), FAIL 1 \(20\.0%\), N\/A 1 \(20\.0%\)/.test(af.stdout), af.stdout);
  check('af. the discipline rate scores only applicable checks — N/A is not a quiet pass',
    /discipline rate: 75\.0% \(3\/4 applicable check\(s\) PASS\)/.test(af.stdout), af.stdout);
  check('af. the failing check is named', /failing checks: tier-routing/.test(af.stdout), af.stdout);

  const afDrift = run(['--artifacts', join(HERE, 'run-conformance-drift')]);
  check('af. a prose-shaped run-conformance file still exits 0', afDrift.status === 0, afDrift.stdout + afDrift.stderr);
  check('af. and raises the zero-parse shape-drift warning naming the grammars doc',
    /!! WARNING: RUN_CONFORMANCE\.md is present and non-empty but yielded 0 parsed items.*artifact-grammars\.md/.test(afDrift.stdout), afDrift.stdout);

  // ---- ag. duplicate keys and lowercase results (grammar (e), parser invariants) ------
  // Pins the two rules a totals-only check would miss: a repeated key is unparseable and
  // the FIRST row wins (byCheck, counts, and total must agree), and the result cell is
  // case-insensitive for all three values, N/A included.
  const agJson = join(jsonDir, 'run-conformance-dup.json');
  const ag = run(['--artifacts', join(HERE, 'run-conformance-dup'), '--json', agJson]);
  let gj = null;
  try { gj = JSON.parse(readFileSync(agJson, 'utf8')); } catch (e) { gj = { parseError: String(e.message) }; }
  check('ag. duplicate-key fixture exits 0', ag.status === 0, ag.stdout + ag.stderr);
  check('ag. the duplicate row is unparseable, not recounted',
    /\b4 check\(s\), unparseable: 1\b/.test(ag.stdout), ag.stdout);
  check('ag. the first row wins the per-check map',
    gj?.runConformance?.byCheck?.['ledger-coverage'] === 'PASS', JSON.stringify(gj));
  check('ag. the map and the totals agree',
    gj?.runConformance?.total === Object.keys(gj?.runConformance?.byCheck ?? {}).length, JSON.stringify(gj));
  check('ag. lowercase and mixed-case results parse, N/A included',
    gj?.runConformance?.byResult?.PASS === 2 && gj?.runConformance?.byResult?.['N/A'] === 2
    && gj?.runConformance?.byResult?.FAIL === 0, JSON.stringify(gj));

  // Both snapshots reach the machine shape, and stay null when absent.
  const confJson = join(jsonDir, 'conformance.json');
  const aeJ = run(['--artifacts', join(HERE, 'conformance'), '--json', confJson]);
  let cj = null;
  try { cj = JSON.parse(readFileSync(confJson, 'utf8')); } catch (e) { cj = { parseError: String(e.message) }; }
  check('ae. the machine shape carries the verdict counts and the per-surface map',
    aeJ.status === 0 && cj?.conformance?.total === 4 && cj?.conformance?.malformed === 2
    && cj?.conformance?.byVerdict?.DRIFTED === 1 && cj?.conformance?.bySurface?.vault === 'DRIFTED',
    JSON.stringify(cj?.conformance));
  check('ae. an absent run-conformance snapshot is null, never a measured zero',
    cj?.runConformance === null, JSON.stringify(cj?.runConformance));

  // ---- ah. duplicate keys and lowercase verdicts (grammar (d), parser invariants) -----
  // Mirrors ag.: the shared walker's invariants are pinned on BOTH grammars, so a future
  // specialization of either call site cannot silently drop them on one side.
  const ahJson = join(jsonDir, 'conformance-dup.json');
  const ah = run(['--artifacts', join(HERE, 'conformance-dup'), '--json', ahJson]);
  let hj = null;
  try { hj = JSON.parse(readFileSync(ahJson, 'utf8')); } catch (e) { hj = { parseError: String(e.message) }; }
  check('ah. duplicate-surface fixture exits 0', ah.status === 0, ah.stdout + ah.stderr);
  check('ah. the duplicate row is unparseable, not recounted',
    /\b2 surface\(s\), unparseable: 1\b/.test(ah.stdout), ah.stdout);
  check('ah. the first row wins the per-surface map',
    hj?.conformance?.bySurface?.contract === 'CONFORMANT', JSON.stringify(hj));
  check('ah. the map and the totals agree',
    hj?.conformance?.total === Object.keys(hj?.conformance?.bySurface ?? {}).length, JSON.stringify(hj));
  check('ah. a lowercase verdict parses',
    hj?.conformance?.bySurface?.['runs-folder'] === 'CONFORMANT', JSON.stringify(hj));
  // The map alone cannot prove the duplicate was skipped: first-row-wins holds whether or not
  // `counts` was incremented before the guard. The verdict tally is the half that discriminates.
  check('ah. the duplicate row is not tallied into the verdict counts',
    hj?.conformance?.byVerdict?.CONFORMANT === 2 && hj?.conformance?.byVerdict?.DRIFTED === 0,
    JSON.stringify(hj?.conformance));

  // ---- ai. the regex-miss branch, pinned in isolation ---------------------------------
  // The main fixture's aggregate `unparseable: 2` cannot tell the regex-miss path from the
  // enum path. This fixture holds one row whose verdict IS in the closed set and whose
  // surface cell is not a kebab slug, so the shape check is the only reason it can be
  // unparseable: widen the surface capture and the row parses, `total` becomes 1, the
  // warning disappears, and both assertions below fail.
  const ai = run(['--artifacts', join(HERE, 'conformance-shape-miss')]);
  check('ai. shape-miss-only fixture exits 0', ai.status === 0, ai.stdout + ai.stderr);
  check('ai. the regex-miss row is counted with zero parsed surfaces',
    /\b0 surface\(s\), unparseable: 1\b/.test(ai.stdout), ai.stdout);
  check('ai. zero parsed rows on a non-empty report raises the shape-drift warning',
    /!! WARNING: CONFORMANCE_REPORT\.md is present and non-empty but yielded 0 parsed items/.test(ai.stdout), ai.stdout);

  const rcJson = join(jsonDir, 'run-conformance.json');
  const afJ = run(['--artifacts', join(HERE, 'run-conformance'), '--json', rcJson]);
  let rj = null;
  try { rj = JSON.parse(readFileSync(rcJson, 'utf8')); } catch (e) { rj = { parseError: String(e.message) }; }
  check('af. the machine shape carries the result counts and the per-check map',
    afJ.status === 0 && rj?.runConformance?.total === 5 && rj?.runConformance?.malformed === 1
    && rj?.runConformance?.byResult?.['N/A'] === 1 && rj?.runConformance?.byCheck?.['tier-routing'] === 'FAIL',
    JSON.stringify(rj?.runConformance));
  check('af. an absent conformance snapshot is null, never a measured zero',
    rj?.conformance === null, JSON.stringify(rj?.conformance));

  // A run folder carrying neither snapshot reports both "not present" and is otherwise unchanged.
  check('ae/af. both snapshots report "not present" on the original fixture dir',
    /## Conformance \(CONFORMANCE_REPORT\.md\)\n\s*not present/.test(a.stdout)
    && /## Orchestration conformance \(RUN_CONFORMANCE\.md\)\n\s*not present/.test(a.stdout), a.stdout);

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

  // ---- w. the atlas line is optional, and fail-closed when present -------------
  // Runs recorded before the atlas leg existed carry no such line, so its absence must stay
  // clean; a present line must be four counts, or the gate names it like any other shape miss.
  const COVERAGE_LINE = 'coverage: covered-negatives 2; slices swept 5 of 6';
  const withAtlas = (line) => cleanNote.replace(COVERAGE_LINE, `${COVERAGE_LINE}\n${line}`);
  const atlasNote = join(jsonDir, 'atlas-ok.md');
  writeFileSync(atlasNote, withAtlas('atlas: sections 9; fresh 5; refreshed 3; falsified 1'));
  const w1 = run(['--validate-note', atlasNote]);
  check('w. a well-formed atlas line passes (exit 0)', w1.status === 0, w1.stdout + w1.stderr);
  check('w. it reports 0 structural and 0 machine-block hits',
    /0 structural hit\(s\)/.test(w1.stdout) && /0 machine-block hit\(s\)/.test(w1.stdout), w1.stdout);
  const badAtlasNote = join(jsonDir, 'atlas-bad.md');
  writeFileSync(badAtlasNote, withAtlas('atlas: sections 9; fresh some; refreshed 3; falsified 1'));
  const w2 = run(['--validate-note', badAtlasNote]);
  check('w. a non-numeric atlas count fails closed (exit 1)', w2.status === 1, w2.stdout + w2.stderr);
  check('w. the hit names that line and the atlas shape',
    /!! MACHINE-LINE\s+L\d+\s+atlas: sections 9; fresh some/.test(w2.stdout)
    && /atlas: sections N; fresh N; refreshed N; falsified N/.test(w2.stdout), w2.stdout);
  const partialAtlasNote = join(jsonDir, 'atlas-partial.md');
  writeFileSync(partialAtlasNote, withAtlas('atlas: sections 9; fresh 5'));
  const w3 = run(['--validate-note', partialAtlasNote]);
  check('w. a partial atlas line fails closed — all four counts or none (exit 1)', w3.status === 1, w3.stdout + w3.stderr);
  check('w. a legacy note carrying no atlas line at all is still clean — the line is optional',
    d.status === 0 && /0 machine-block hit\(s\)/.test(d.stdout) && !/atlas:/.test(cleanNote), d.stdout);

  // ---- x. the config line is optional, and fail-closed when present ------------
  // Same optionality as the atlas line: the runs recorded before the tier experiment carry none,
  // so absence stays clean; a present line must be kebab model-class slugs and nothing else. The
  // lead half may be several classes plus-separated (a mid-run handover); the operatives half
  // may not.
  const withConfig = (line) => cleanNote.replace(COVERAGE_LINE, `${COVERAGE_LINE}\n${line}`);
  const configNote = join(jsonDir, 'config-ok.md');
  writeFileSync(configNote, withConfig('config: lead fable-5; operatives opus-5'));
  const x1 = run(['--validate-note', configNote]);
  check('x. a well-formed config line passes (exit 0)', x1.status === 0, x1.stdout + x1.stderr);
  check('x. it reports 0 structural and 0 machine-block hits',
    /0 structural hit\(s\)/.test(x1.stdout) && /0 machine-block hit\(s\)/.test(x1.stdout), x1.stdout);
  const badConfigNote = join(jsonDir, 'config-bad.md');
  writeFileSync(badConfigNote, withConfig('config: lead Fable 5; operatives opus-5'));
  const x2 = run(['--validate-note', badConfigNote]);
  check('x. a non-slug model class fails closed (exit 1)', x2.status === 1, x2.stdout + x2.stderr);
  check('x. the hit names that line and the config shape',
    /!! MACHINE-LINE\s+L\d+\s+config: lead Fable 5/.test(x2.stdout)
    && /config: lead <model-class>\[\+<model-class>\.\.\.\]; operatives <model-class>/.test(x2.stdout), x2.stdout);
  const partialConfigNote = join(jsonDir, 'config-partial.md');
  writeFileSync(partialConfigNote, withConfig('config: lead opus-5'));
  const x3 = run(['--validate-note', partialConfigNote]);
  check('x. a config line missing the operatives half fails closed (exit 1)', x3.status === 1, x3.stdout + x3.stderr);
  const trailingHyphenNote = join(jsonDir, 'config-trailing-hyphen.md');
  writeFileSync(trailingHyphenNote, withConfig('config: lead opus-; operatives opus-5'));
  const x4 = run(['--validate-note', trailingHyphenNote]);
  check('x. a malformed kebab slug fails closed rather than passing as a class name (exit 1)',
    x4.status === 1, x4.stdout + x4.stderr);
  const splitLeadNote = join(jsonDir, 'config-split-lead.md');
  writeFileSync(splitLeadNote, withConfig('config: lead fable-5+opus-5; operatives opus-5'));
  const x5 = run(['--validate-note', splitLeadNote]);
  check('x. a plus-separated lead — a mid-run handover — passes (exit 0)', x5.status === 0, x5.stdout + x5.stderr);
  check('x. the split lead adds no structural or machine-block hit',
    /0 structural hit\(s\)/.test(x5.stdout) && /0 machine-block hit\(s\)/.test(x5.stdout), x5.stdout);
  const trailingPlusNote = join(jsonDir, 'config-trailing-plus.md');
  writeFileSync(trailingPlusNote, withConfig('config: lead fable-5+; operatives opus-5'));
  const x6 = run(['--validate-note', trailingPlusNote]);
  check('x. a trailing plus on the lead fails closed (exit 1)', x6.status === 1, x6.stdout + x6.stderr);
  check('x. that hit names the offending line',
    /!! MACHINE-LINE\s+L\d+\s+config: lead fable-5\+;/.test(x6.stdout), x6.stdout);
  const splitOpsNote = join(jsonDir, 'config-split-operatives.md');
  writeFileSync(splitOpsNote, withConfig('config: lead fable-5; operatives opus-5+sonnet-5'));
  const x7 = run(['--validate-note', splitOpsNote]);
  check('x. only the lead may split — a plus-separated operatives half fails closed (exit 1)',
    x7.status === 1, x7.stdout + x7.stderr);
  check('x. that hit names the offending line',
    /!! MACHINE-LINE\s+L\d+\s+config: lead fable-5; operatives opus-5\+sonnet-5/.test(x7.stdout), x7.stdout);
  check('x. a legacy note carrying no config line at all is still clean — the line is optional',
    d.status === 0 && /0 machine-block hit\(s\)/.test(d.stdout) && !/config:/.test(cleanNote), d.stdout);

  // ---- ab. a note written exactly to the template validates -------------------
  // The template in docs/techniques/calibration-protocol.md is the shape an author fills in, so a
  // template shape the validator rejects makes a correctly-written note fail closed. Filling it
  // here — counts where the template asks for counts — pins the doc against the gate, so the two
  // hand-written halves cannot drift apart again.
  const protocolDoc = readFileSync(join(REPO, 'docs', 'techniques', 'calibration-protocol.md'), 'utf8');
  const templateFence = protocolDoc.match(/```\r?\n(## Calibration note[\s\S]*?)```/);
  check('ab. the sanitized-note template is extractable from the protocol doc', !!templateFence, protocolDoc.slice(0, 200));
  if (templateFence) {
    const filled = templateFence[1]
      // A severity-mix placeholder is filled with the five counts, in either template shape.
      .replace(/<c\/h\/m\/l\/n>/g, '0/6/22/9/10')
      .replace(/<?\bN\/N\/N\/N\/N\b>?/g, '0/6/22/9/10')
      .replace(/<YYYY-MM-DD>|\bYYYY-MM-DD\b/g, '2026-07-30')
      .replace(/<suite>@<version>|<plugin>@<semver>/g, 'code-ops-suite@1.29.1')
      .replace(/\s*\[, more\]/g, '')
      .replace(/\s*\((?:or:|optional)[^)]*\)/g, '')
      .replace(/<kebab-slug>/g, 'ts-monorepo-telephony')
      // The config line's two slots are model classes, filled like any other kebab slug — without
      // this the catch-all below would fill them with prose and the doc-pin would fail on itself.
      .replace(/<model-class>/g, 'opus-5')
      .replace(/<instrument\|suite\|protocol>/g, 'instrument')
      .replace(/\bassess-only\|implement\b/g, 'assess-only')
      .replace(/\byes\|no\b/g, 'yes')
      .replace(/\bclean\|dirty\b/g, 'clean')
      .replace(/\bL-NNN\b/g, 'L-013')
      .replace(/\bN\b/g, '4').replace(/\bM\b/g, '6')
      // Everything still in angle brackets is prose the author writes in their own words.
      .replace(/<[^>]*>/g, 'unchanged from the prior row');
    const templateNote = join(jsonDir, 'from-template.md');
    writeFileSync(templateNote, filled);
    const ab = run(['--validate-note', templateNote]);
    check('ab. a note filled straight from the template passes (exit 0)', ab.status === 0, filled + '\n---\n' + ab.stdout + ab.stderr);
    check('ab. it reports 0 structural and 0 machine-block hits',
      /0 structural hit\(s\)/.test(ab.stdout) && /0 machine-block hit\(s\)/.test(ab.stdout), ab.stdout);
  }

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
