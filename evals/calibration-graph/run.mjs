#!/usr/bin/env node
// Regression eval for scripts/calibration-graph.mjs — the calibration knowledge-graph store
// under evals/calibration/ and the DERIVED evals/CALIBRATION_TABLE.md it renders.
//
//   GREEN PATHS on the REAL store: `validate` exits 0; `render --check` exits 0 (so a
//   hand-edited or stale table is caught in CI); the five queries return the backfilled
//   graph's expected answers — open is empty (deferred and superseded lessons are closed
//   with a reason, not open), deferred is exactly L-003/L-004, L-012 is the one lesson
//   fixed with nothing mechanical holding it, the three recurrent lessons are L-001 (3
//   runs), L-002 (2) and L-005 (2) with none RED, and `trend` prints one line per run
//   grouped by target class and track.
//
//   FAIL-CLOSED CLASSES, each proven on a scratch copy of the real store so exactly one
//   thing is wrong at a time: a dangling edge target (verified-in naming an unknown run),
//   an enforced-by EVAL: path that does not exist on disk, a run listing a lesson nobody
//   defined, a duplicate lesson id, a lesson no run lists, a deferred edge with no note, a
//   non-numeric PR target, and a bad id format. Each exits 1 with its own named reason
//   class, never a generic "invalid".
//
//   RENDER DRIFT: a single hand-mutated byte in a scratch copy of the table makes
//   `render --check` exit 1 and name the first differing line. The real table is never
//   mutated by this eval.
//
//   INGEST: a sanitized note's Machine block round-trips into a well-formed R-004 skeleton
//   (recurred lessons carried over, a new lesson minted and appended to lessons.json, the
//   resulting store still validating and rendering four rows); the `unknown` alternatives
//   ingest as explicit null rather than zero; ingest refuses to overwrite an existing run
//   document, refuses a malformed Machine-block line, and refuses a note with no Machine
//   block at all.
//
//   GRAMMAR CROSS-CHECK: every fixture note is also run through the note gate
//   (scripts/calibration-metrics.mjs --validate-note) with the same verdict, so the two
//   hand-written Machine-block grammars cannot drift apart silently. Coverage is bounded on
//   both sides: a negative stored slice count fails validate, and a note sweeping more slices
//   than exist is refused at ingest. The optional `atlas:` line is bounded the same way — a note
//   without it ingests to a doc with no atlas field, a well-formed one lands its four counts and
//   shows an atlas tail in `trend`, and an impossible count is refused at ingest or by validate. A parseable-but-invalid store (`[null]` lessons.json)
//   fails validate and answers every query without a stack trace.
//
//   node evals/calibration-graph/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'calibration-graph.mjs');
const REAL_STORE = join(REPO, 'evals', 'calibration');
const REAL_TABLE = join(REPO, 'evals', 'CALIBRATION_TABLE.md');
const NOTES = join(HERE, 'notes');

const fails = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) fails.push(detail ? `${name} — ${String(detail).slice(0, 400)}` : name);
};

const run = (args) => {
  try {
    const outp = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 20000 });
    return { status: 0, stdout: outp, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

const cleanupDirs = [];

// A scratch copy of the REAL store, so each failure-class fixture differs from a known-green
// store by exactly one mutation — and so no test can ever write into evals/calibration/.
function scratchStore() {
  const dir = mkdtempSync(join(tmpdir(), 'coh-calgraph-'));
  cleanupDirs.push(dir);
  const store = join(dir, 'calibration');
  mkdirSync(join(store, 'runs'), { recursive: true });
  for (const f of readdirSync(join(REAL_STORE, 'runs'))) copyFileSync(join(REAL_STORE, 'runs', f), join(store, 'runs', f));
  for (const f of ['lessons.json', 'edges.jsonl']) copyFileSync(join(REAL_STORE, f), join(store, f));
  return { dir, store };
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const appendEdge = (store, obj) => writeFileSync(join(store, 'edges.jsonl'), readFileSync(join(store, 'edges.jsonl'), 'utf8').replace(/\n?$/, '\n') + JSON.stringify(obj) + '\n');

// Each failure class: mutate one thing, expect exit 1 AND the reason class named in the output.
function failureClass(label, mutate, reasonRe) {
  const { store } = scratchStore();
  mutate(store);
  const r = run(['validate', '--store', store]);
  check(`${label} exits 1`, r.status === 1, r.stdout + r.stderr);
  check(`${label} names its reason class`, reasonRe.test(r.stdout), r.stdout);
}

try {
  // ---- a. REAL store: validate + render --check are green ----------------------
  const a = run(['validate']);
  check('a. validate exits 0 on the real store', a.status === 0, a.stdout + a.stderr);
  check('a. validate reports 3 runs / 14 lessons / 30 edges', /3 run\(s\), 14 lesson\(s\), 30 edge\(s\)/.test(a.stdout), a.stdout);
  check('a. validate reports 0 violations', /\n0 violation\(s\)\./.test(a.stdout), a.stdout);

  const b = run(['render', '--check']);
  check('b. render --check exits 0 (the committed table matches the store)', b.status === 0, b.stdout + b.stderr);
  check('b. render --check names the run count', /3 run\(s\) — CALIBRATION_TABLE\.md is up to date/.test(b.stdout), b.stdout);

  // The rendered table is a DERIVED file: its preamble must say so and must keep the one-way
  // channel rule it inherited from the hand-maintained table it replaced.
  const table = readFileSync(REAL_TABLE, 'utf8');
  check('b. table preamble declares itself derived and not hand-edited', /DERIVED — do not hand-edit/.test(table), table.slice(0, 600));
  check('b. table preamble points at the store and the renderer',
    /evals\/calibration\/[\s\S]*calibration-graph\.mjs render/.test(table), table.slice(0, 800));
  check('b. table preamble keeps the one-way channel language',
    /--validate-note/.test(table) && /never with a target repo's name, path, or internals/.test(table)
    && /calibration-protocol\.md/.test(table), table.slice(0, 900));
  check('b. table still carries the same seven columns',
    /\| date \| suite versions \| target label \| dispatches \| CONFIRMED ratio \| refutation survival \| notes \|/.test(table), table.slice(0, 1200));
  check('b. all three backfilled runs render', (table.match(/^\| 2026-07-2[89]| 2026-07-29/gm) || []).length >= 3, table);

  // ---- c. queries match the backfilled graph ----------------------------------
  const qOpen = run(['query', 'open']);
  check('c. open exits 0', qOpen.status === 0, qOpen.stdout + qOpen.stderr);
  check('c. open is empty — deferred and superseded lessons are closed, not open',
    /\(none\)/.test(qOpen.stdout) && /\n0 open lesson\(s\)\./.test(qOpen.stdout), qOpen.stdout);

  const qDef = run(['query', 'deferred']);
  check('c. deferred exits 0', qDef.status === 0, qDef.stdout + qDef.stderr);
  check('c. deferred is exactly L-003 and L-004, each with its reason',
    /L-003[^\n]*no mechanical home yet/.test(qDef.stdout) && /L-004[^\n]*paneling-coverage metric/.test(qDef.stdout)
    && /\n2 deferred lesson\(s\)\./.test(qDef.stdout), qDef.stdout);

  const qUn = run(['query', 'unenforced']);
  check('c. unenforced exits 0 without --gate', qUn.status === 0, qUn.stdout + qUn.stderr);
  check('c. L-012 is the one fixed lesson with nothing mechanical holding it',
    /RED\s+L-012[^\n]*fixed-in PR-45/.test(qUn.stdout) && /\n1 unenforced lesson\(s\)\./.test(qUn.stdout), qUn.stdout);
  const qUnGate = run(['query', 'unenforced', '--gate']);
  check('c. --gate promotes a RED line to exit 1', qUnGate.status === 1, qUnGate.stdout + qUnGate.stderr);

  const qRec = run(['query', 'recurrent']);
  check('c. recurrent exits 0', qRec.status === 0, qRec.stdout + qRec.stderr);
  check('c. L-001 recurred across all three runs', /L-001\s+3 runs \(R-001, R-002, R-003\)\s+ENFORCED/.test(qRec.stdout), qRec.stdout);
  check('c. L-002 recurred twice', /L-002\s+2 runs \(R-001, R-002\)\s+ENFORCED/.test(qRec.stdout), qRec.stdout);
  check('c. L-005 recurred twice', /L-005\s+2 runs \(R-002, R-003\)\s+ENFORCED/.test(qRec.stdout), qRec.stdout);
  check('c. exactly 3 recurrent lessons, none RED', /\n3 recurrent lesson\(s\), 0 RED\./.test(qRec.stdout), qRec.stdout);
  const qRecGate = run(['query', 'recurrent', '--gate']);
  check('c. recurrent --gate exits 0 while every recurrence is enforced or superseded', qRecGate.status === 0, qRecGate.stdout + qRecGate.stderr);

  const qTr = run(['query', 'trend']);
  check('c. trend exits 0', qTr.status === 0, qTr.stdout + qTr.stderr);
  check('c. trend groups by target class and track', /## python-service \/ assess-only/.test(qTr.stdout)
    && /## ts-saas \/ assess-only/.test(qTr.stdout) && /## ts-monorepo-telephony \/ assess-only\s+\(control\)/.test(qTr.stdout), qTr.stdout);
  check('c. trend prints one line per run with the derived ratios',
    /R-001\s+2026-07-28\s+findings 28\s+confirmed 19 \(0\.68\)\s+confirmed\/100k n\/a\s+survival 0\.33 \(1 of 3 paneled; 2 repro-exempt\)/.test(qTr.stdout)
    && /R-002[^\n]*confirmed 35 \(0\.71\)\s+confirmed\/100k 2\.29\s+survival 0\.83 \(5 of 6 paneled\)/.test(qTr.stdout)
    && /R-003[^\n]*confirmed 16 \(0\.57\)\s+confirmed\/100k 1\.45\s+survival 1\.00 \(1 of 1 paneled; 4 repro-exempt\)/.test(qTr.stdout), qTr.stdout);
  check('c. trend counts every run and group', /\n3 run\(s\) across 3 class\/track group\(s\)\./.test(qTr.stdout), qTr.stdout);

  const qL1 = run(['query', 'lesson', 'L-001']);
  check('c. lesson L-001 exits 0', qL1.status === 0, qL1.stdout + qL1.stderr);
  check('c. L-001 dossier carries class, firstSeen, statement, runs and every edge',
    /class: instrument/.test(qL1.stdout) && /first seen: R-001/.test(qL1.stdout) && /statement: \S/.test(qL1.stdout)
    && /runs \(3\): R-001, R-002, R-003/.test(qL1.stdout)
    && /fixed-in\s+PR-44/.test(qL1.stdout) && /fixed-in\s+PR-45/.test(qL1.stdout)
    && /enforced-by\s+EVAL:evals\/scan-narration\/run\.mjs/.test(qL1.stdout)
    && /enforced-by\s+EVAL:evals\/calibration-metrics\/run\.mjs/.test(qL1.stdout), qL1.stdout);
  check('c. L-001 derived status is ENFORCED and recurrent', /derived status: ENFORCED\s+\(recurrent: yes\)/.test(qL1.stdout), qL1.stdout);

  // A superseded lesson reads its successor off the successor's own edge — supersedes is stored
  // one way only, so the reverse direction must be derived.
  const qL6 = run(['query', 'lesson', 'L-006']);
  check('c. L-006 dossier derives superseded-by from L-012 and reports SUPERSEDED',
    qL6.status === 0 && /superseded-by L-012/.test(qL6.stdout) && /derived status: SUPERSEDED/.test(qL6.stdout), qL6.stdout + qL6.stderr);
  const qLbad = run(['query', 'lesson', 'L-999']);
  check('c. an unknown lesson id exits 1', qLbad.status === 1, qLbad.stdout + qLbad.stderr);

  // ---- d. every validate failure class fires, by name -------------------------
  failureClass('d1. dangling edge target (verified-in unknown run)',
    (s) => appendEdge(s, { from: 'L-001', rel: 'verified-in', to: 'R-099' }),
    /dangling-edge:[^\n]*verified-in target R-099 is not a known run/);

  failureClass('d2. enforced-by EVAL: path missing on disk',
    (s) => appendEdge(s, { from: 'L-012', rel: 'enforced-by', to: 'EVAL:evals/no-such-eval/run.mjs' }),
    /dangling-edge:[^\n]*EVAL:evals\/no-such-eval\/run\.mjs does not exist on disk/);

  failureClass('d3. run lists an unknown lesson',
    (s) => { const p = join(s, 'runs', 'R-001.json'); const d = readJson(p); d.lessons.push('L-900'); writeJson(p, d); },
    /unknown-lesson: run R-001 lists L-900, which is not defined in lessons\.json/);

  failureClass('d4. duplicate lesson id',
    (s) => { const p = join(s, 'lessons.json'); const l = readJson(p); l.push({ ...l[4] }); writeJson(p, l); },
    /duplicate-id: lesson L-005 appears more than once/);

  failureClass('d5. lesson no run lists',
    (s) => { const p = join(s, 'lessons.json'); const l = readJson(p); l.push({ id: 'L-015', class: 'suite', title: 't', statement: 's', firstSeen: 'R-003' }); writeJson(p, l); },
    /orphan-lesson: L-015 is listed by no run/);

  failureClass('d6. duplicate run id across two files',
    (s) => { const d = readJson(join(s, 'runs', 'R-003.json')); writeJson(join(s, 'runs', 'R-004.json'), d); },
    /schema: runs\/R-004\.json: filename does not match id R-003/);

  failureClass('d7. deferred edge with no note',
    (s) => appendEdge(s, { from: 'L-012', rel: 'deferred', to: 'deferred' }),
    /schema:[^\n]*deferred edge requires a note/);

  failureClass('d8. non-numeric PR target',
    (s) => appendEdge(s, { from: 'L-003', rel: 'fixed-in', to: 'PR-next' }),
    /schema:[^\n]*fixed-in target must be PR-NN with a numeric serial/);

  failureClass('d9. bad run id format',
    (s) => { const p = join(s, 'runs', 'R-002.json'); const d = readJson(p); d.id = 'R-2'; writeJson(p, d); },
    /schema: runs\/R-002\.json: bad run id "R-2"/);

  failureClass('d10. an edge from something that is not a lesson',
    (s) => appendEdge(s, { from: 'R-001', rel: 'fixed-in', to: 'PR-44' }),
    /schema:[^\n]*from "R-001" is not an L-NNN id/);

  failureClass('d11. GATE: check slug no longer present in its script',
    (s) => appendEdge(s, { from: 'L-012', rel: 'enforced-by', to: 'GATE:scripts/lint-plugins.mjs#no-such-slug' }),
    /dangling-edge:[^\n]*check slug "no-such-slug" no longer appears/);

  failureClass('d12. confirmed exceeding findings',
    (s) => { const p = join(s, 'runs', 'R-001.json'); const d = readJson(p); d.quality.confirmed = 99; writeJson(p, d); },
    /schema:[^\n]*quality\.confirmed \(99\) exceeds quality\.findings \(28\)/);

  // ---- e. render --check catches a hand-edited table (scratch copy only) -------
  {
    const { dir, store } = scratchStore();
    const tbl = join(dir, 'TABLE.md');
    const w = run(['render', '--store', store, '--table', tbl]);
    check('e. render writes a table for a scratch store', w.status === 0, w.stdout + w.stderr);
    const ok = run(['render', '--check', '--store', store, '--table', tbl]);
    check('e. render --check is clean immediately after a render', ok.status === 0, ok.stdout + ok.stderr);

    // Hand-mutate exactly one byte inside a rendered data cell.
    const before = readFileSync(tbl, 'utf8');
    writeFileSync(tbl, before.replace('| 9 | 0.68 (19 of 28)', '| 8 | 0.68 (19 of 28)'));
    check('e. the mutation changed exactly one byte', readFileSync(tbl, 'utf8').length === before.length, 'length changed');
    const drift = run(['render', '--check', '--store', store, '--table', tbl]);
    check('e. a hand-edited byte makes render --check exit 1', drift.status === 1, drift.stdout + drift.stderr);
    check('e. drift is named as drift from the store, with the first differing line',
      /drifted from evals\/calibration\//.test(drift.stderr) && /first differing line \d+/.test(drift.stderr), drift.stderr);
    check('e. drift message says re-render rather than hand-edit', /re-run[\s\S]*render[\s\S]*instead of hand-editing/.test(drift.stderr), drift.stderr);

    // A missing table is drift too, not a silent pass.
    rmSync(tbl);
    const gone = run(['render', '--check', '--store', store, '--table', tbl]);
    check('e. a missing table makes render --check exit 1', gone.status === 1, gone.stdout + gone.stderr);
  }

  // ---- f. ingest round-trips a Machine block into an R-004 skeleton -----------
  {
    const { store } = scratchStore();
    const f1 = run(['ingest', '--note', join(NOTES, 'sample-note.md'), '--store', store, '--label', 'fixture Go event pipeline']);
    check('f. ingest exits 0 on a well-formed note', f1.status === 0, f1.stdout + f1.stderr);
    check('f. ingest names the run it created', /ingested R-004 -> runs\/R-004\.json/.test(f1.stdout), f1.stdout);
    check('f. ingest reports the recurred lessons', /recurred: L-001, L-014/.test(f1.stdout), f1.stdout);
    check('f. ingest mints the new lesson with its class', /new lessons: L-015 \(instrument\)/.test(f1.stdout), f1.stdout);

    const doc = readJson(join(store, 'runs', 'R-004.json'));
    check('f. skeleton carries the parsed date and track', doc.date === '2026-07-30' && doc.track === 'assess-only', JSON.stringify(doc).slice(0, 300));
    check('f. skeleton parses a multi-plugin suite line',
      doc.suite['code-ops-suite'] === '1.26.0' && doc.suite.rigor === '1.9.0', JSON.stringify(doc.suite));
    check('f. skeleton carries target class and control flag', doc.target.class === 'go-event-pipeline' && doc.target.control === false, JSON.stringify(doc.target));
    check('f. --label lands in target.label', doc.target.label === 'fixture Go event pipeline', doc.target.label);
    check('f. skeleton carries findings/confirmed', doc.quality.findings === 31 && doc.quality.confirmed === 20, JSON.stringify(doc.quality));
    check('f. skeleton carries the paneling numbers including the eligible denominator',
      doc.quality.refutation.paneled === 4 && doc.quality.refutation.survived === 3
      && doc.quality.refutation.reproExempt === 1 && doc.quality.refutation.panelEligible === 7, JSON.stringify(doc.quality.refutation));
    check('f. skeleton carries the severity mix', doc.quality.severity
      && doc.quality.severity.critical === 1 && doc.quality.severity.high === 6 && doc.quality.severity.medium === 12
      && doc.quality.severity.low === 9 && doc.quality.severity.nit === 3, JSON.stringify(doc.quality.severity));
    check('f. skeleton carries tokens and dispatches', doc.tokens.operative === 1400000 && doc.tokens.dispatches === 11, JSON.stringify(doc.tokens));
    check('f. skeleton carries orchestration counts', doc.orchestration.dangling === 0 && doc.orchestration.failed === 1 && doc.orchestration.redispatched === 1, JSON.stringify(doc.orchestration));
    check('f. skeleton carries standardization', doc.standardization.enforcementsAdded === 2 && doc.standardization.tracelessClean === true, JSON.stringify(doc.standardization));
    check('f. "swept N of M" derives the unswept remainder',
      doc.coverage.coveredNegatives === 2 && doc.coverage.slicesSwept === 6 && doc.coverage.slicesUnswept === 2, JSON.stringify(doc.coverage));
    check('f. skeleton lists recurred lessons plus the minted one', JSON.stringify(doc.lessons) === '["L-001","L-014","L-015"]', JSON.stringify(doc.lessons));
    check('f. notes comes from the note\'s Lessons prose', /Two prior lessons recurred/.test(doc.notes), doc.notes);
    check('f. a note with no atlas line produces a doc with no atlas field at all', !('atlas' in doc), JSON.stringify(doc.atlas));

    const lessons = readJson(join(store, 'lessons.json'));
    const minted = lessons.find((l) => l.id === 'L-015');
    check('f. the minted lesson was appended to lessons.json', !!minted, JSON.stringify(lessons.slice(-1)));
    check('f. the minted lesson records the ingesting run as firstSeen', minted && minted.firstSeen === 'R-004', JSON.stringify(minted));
    check('f. the minted lesson keeps the full statement and a leading-clause title',
      minted && /require one keyed line per finding$/.test(minted.statement)
      && minted.title === 'Refutation receipts written as prose bullets are invisible to the verdict parser', JSON.stringify(minted));

    // The whole point of a skeleton: the store it lands in must still validate and render.
    const v = run(['validate', '--store', store]);
    check('f. the store still validates after ingest', v.status === 0, v.stdout + v.stderr);
    check('f. validate now sees 4 runs and 15 lessons', /4 run\(s\), 15 lesson\(s\)/.test(v.stdout), v.stdout);
    const tbl2 = join(dirname(store), 'TABLE2.md');
    const r2 = run(['render', '--store', store, '--table', tbl2]);
    check('f. the ingested run renders as a fourth row', r2.status === 0 && /4 run\(s\)/.test(r2.stdout), r2.stdout + r2.stderr);
    check('f. the new row carries the derived ratios', /\| 2026-07-30 \| code-ops-suite@1\.26\.0, rigor@1\.9\.0 \| fixture Go event pipeline \| 11 \| 0\.65 \(20 of 31\) \| 0\.75 \(3 of 4 paneled; 1 repro-exempt\) \|/.test(readFileSync(tbl2, 'utf8')), readFileSync(tbl2, 'utf8').slice(-600));

    // Refuses to overwrite: a calibration run is append-only history.
    const dup = run(['ingest', '--note', join(NOTES, 'sample-note.md'), '--store', store, '--id', 'R-004']);
    check('f. ingest refuses to overwrite an existing run doc (exit 1)', dup.status === 1, dup.stdout + dup.stderr);
    check('f. the refusal names the file and says why', /refusing to overwrite an existing run document: runs\/R-004\.json/.test(dup.stderr) && /append-only/.test(dup.stderr), dup.stderr);
  }

  // ---- g. the `unknown` alternatives ingest as explicit null, never zero ------
  {
    const { store } = scratchStore();
    const g1 = run(['ingest', '--note', join(NOTES, 'unknown-fields-note.md'), '--store', store, '--label', 'fixture Rust CLI']);
    check('g. a note using every `unknown` alternative ingests (exit 0)', g1.status === 0, g1.stdout + g1.stderr);
    const doc = readJson(join(store, 'runs', 'R-004.json'));
    check('g. `tokens: unknown operative` becomes null, and dispatches still parses',
      doc.tokens.operative === null && doc.tokens.dispatches === 3, JSON.stringify(doc.tokens));
    check('g. `severity: unknown` becomes null', doc.quality.severity === null, JSON.stringify(doc.quality));
    check('g. an unknown paneling denominator becomes null', doc.quality.refutation.panelEligible === null, JSON.stringify(doc.quality.refutation));
    check('g. `coverage: unknown` becomes three nulls',
      doc.coverage.coveredNegatives === null && doc.coverage.slicesSwept === null && doc.coverage.slicesUnswept === null, JSON.stringify(doc.coverage));
    check('g. the implement track parses', doc.track === 'implement', doc.track);
    const v = run(['validate', '--store', store]);
    check('g. the store still validates with the null fields', v.status === 0, v.stdout + v.stderr);
    const tbl = join(dirname(store), 'TABLE3.md');
    run(['render', '--store', store, '--table', tbl]);
    check('g. a null operative-token total renders n/a in the trend, not 0',
      /confirmed\/100k n\/a/.test(run(['query', 'trend', '--store', store]).stdout), run(['query', 'trend', '--store', store]).stdout);
  }

  // ---- h. ingest refuses malformed and blockless notes ------------------------
  {
    const { store } = scratchStore();
    const bad = run(['ingest', '--note', join(NOTES, 'malformed-note.md'), '--store', store]);
    check('h. a malformed Machine-block line is refused (exit 1)', bad.status === 1, bad.stdout + bad.stderr);
    check('h. the refusal names the offending line and its number',
      /L\d+: line matches no Machine-block shape: findings: 31, confirmed: 20/.test(bad.stderr), bad.stderr);
    check('h. an out-of-enum track is also named', /L\d+: line matches no Machine-block shape: track: assess-and-fix/.test(bad.stderr), bad.stderr);
    check('h. the refusal says why guessing is worse than failing', /Fail-closed/.test(bad.stderr), bad.stderr);
    check('h. nothing was written', !readdirSync(join(store, 'runs')).includes('R-004.json'), readdirSync(join(store, 'runs')).join(','));

    const none = run(['ingest', '--note', join(NOTES, 'no-block-note.md'), '--store', store]);
    check('h. a note with no Machine block is refused (exit 1)', none.status === 1, none.stdout + none.stderr);
    check('h. the refusal names the missing section and the template version',
      /missing its "## Machine block" section/.test(none.stderr) && /template version too old/.test(none.stderr), none.stderr);

    // A recurrence must point at a lesson that exists.
    const noteDir = mkdtempSync(join(tmpdir(), 'coh-calgraph-note-'));
    cleanupDirs.push(noteDir);
    const badRecur = join(noteDir, 'bad-recur.md');
    writeFileSync(badRecur, readFileSync(join(NOTES, 'unknown-fields-note.md'), 'utf8').replace('lesson: recur L-013', 'lesson: recur L-777'));
    const rr = run(['ingest', '--note', badRecur, '--store', store]);
    check('h. a recurrence naming an undefined lesson is refused (exit 1)', rr.status === 1, rr.stdout + rr.stderr);
    check('h. the refusal names the unknown lesson', /recur L-777[\s\S]*not defined in lessons\.json/.test(rr.stderr), rr.stderr);
  }

  // ---- i. usage errors fail at exit 2, distinctly from violations -------------
  const u1 = run([]);
  check('i. no subcommand exits 2', u1.status === 2, u1.stdout + u1.stderr);
  const u2 = run(['bogus']);
  check('i. unknown subcommand exits 2', u2.status === 2, u2.stdout + u2.stderr);
  const u3 = run(['validate', '--nope', 'x']);
  check('i. unknown flag exits 2', u3.status === 2, u3.stdout + u3.stderr);
  const u4 = run(['validate', '--store', join(tmpdir(), 'coh-calgraph-does-not-exist')]);
  check('i. a missing store is a usage error (exit 2), not a violation', u4.status === 2, u4.stdout + u4.stderr);
  const u5 = run(['query', 'nonsense']);
  check('i. unknown query subcommand exits 2', u5.status === 2, u5.stdout + u5.stderr);
  const u6 = run(['ingest', '--store', REAL_STORE]);
  check('i. ingest with no --note exits 2', u6.status === 2, u6.stdout + u6.stderr);
  const u7 = run(['ingest', '--note', join(NOTES, 'nope.md'), '--store', REAL_STORE]);
  check('i. ingest with a missing note file exits 2', u7.status === 2, u7.stdout + u7.stderr);

  // ---- k. the two Machine-block grammars agree ---------------------------------
  // The note gate (scripts/calibration-metrics.mjs --validate-note) and this script's ingest
  // parser are two hand-written grammars for the same block. A line one accepts and the other
  // rejects is exactly the drift that let an unknown paneling denominator ingest while failing
  // the gate, so every fixture note here is run through the gate too, with the same verdict.
  {
    const METRICS = join(REPO, 'scripts', 'calibration-metrics.mjs');
    const gate = (note) => {
      try {
        return { status: 0, out: execFileSync(process.execPath, [METRICS, '--validate-note', join(NOTES, note)], { encoding: 'utf8', timeout: 20000 }) };
      } catch (e) {
        return { status: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
      }
    };
    for (const note of ['sample-note.md', 'unknown-fields-note.md']) {
      const gr = gate(note);
      check(`k. ${note} passes --validate-note (exit 0)`, gr.status === 0, gr.out);
      check(`k. ${note} reports 0 structural and 0 machine-block hits`,
        /0 structural hit\(s\)/.test(gr.out) && /0 machine-block hit\(s\)/.test(gr.out), gr.out);
    }
    const gMal = gate('malformed-note.md');
    check('k. malformed-note.md fails --validate-note (exit 1)', gMal.status === 1, gMal.out);
    check('k. the gate names the same malformed lines ingest refuses',
      /MACHINE-LINE[\s\S]*track: assess-and-fix/.test(gMal.out) && /MACHINE-LINE[\s\S]*findings: 31, confirmed: 20/.test(gMal.out), gMal.out);
    const gNone = gate('no-block-note.md');
    check('k. no-block-note.md fails --validate-note (exit 1)', gNone.status === 1, gNone.out);
    check('k. the gate names the missing section', /MACHINE-BLOCK[\s\S]*no "## Machine block" section/.test(gNone.out), gNone.out);
  }

  // ---- l. coverage bounds: negative stored, and swept > total at ingest --------
  failureClass('l1. a negative stored slice count',
    (s) => { const p = join(s, 'runs', 'R-002.json'); const d = readJson(p); d.coverage.slicesSwept = -1; writeJson(p, d); },
    /schema: runs\/R-002\.json: coverage\.slicesSwept must be a non-negative integer or null/);

  {
    const { store } = scratchStore();
    const noteDir = mkdtempSync(join(tmpdir(), 'coh-calgraph-cov-'));
    cleanupDirs.push(noteDir);
    const overSwept = join(noteDir, 'over-swept.md');
    writeFileSync(overSwept, readFileSync(join(NOTES, 'sample-note.md'), 'utf8')
      .replace('slices swept 6 of 8', 'slices swept 9 of 8'));
    const cov = run(['ingest', '--note', overSwept, '--store', store]);
    check('l2. a coverage line sweeping more slices than exist is refused (exit 1)', cov.status === 1, cov.stdout + cov.stderr);
    check('l2. the refusal names the numbers and the negative remainder it would derive',
      /slices swept 9 of 8[\s\S]*negative unswept remainder/.test(cov.stderr), cov.stderr);
    check('l2. nothing was written', !readdirSync(join(store, 'runs')).includes('R-004.json'), readdirSync(join(store, 'runs')).join(','));
  }

  // ---- m. a parseable-but-invalid store refuses cleanly, never throws ----------
  // `[null]` parses as an array of lesson nodes, so loadStore has nothing to refuse — validate is
  // the gate that rejects it. A query reading lesson ids off the raw array crashed here with a
  // TypeError instead of answering; it must read the defended graph view.
  {
    const { store } = scratchStore();
    writeFileSync(join(store, 'lessons.json'), '[null]\n');
    const v = run(['validate', '--store', store]);
    check('m. validate is the gate for a [null] lessons.json (exit 1)', v.status === 1, v.stdout + v.stderr);
    check('m. validate names the malformed node', /schema: lessons\.json\[0\]: lesson must be a JSON object/.test(v.stdout), v.stdout);
    for (const sub of ['open', 'deferred', 'unenforced', 'recurrent', 'trend']) {
      const q = run(['query', sub, '--store', store]);
      check(`m. query ${sub} does not throw on a [null] lessons.json`,
        !/TypeError/.test(q.stderr) && !/^\s+at /m.test(q.stderr), q.stderr);
    }
  }

  // ---- n. the optional atlas leg ----------------------------------------------
  // A note carrying the atlas line ingests its four counts and shows them in the trend; a
  // shape-miss or an impossible count is refused; the note gate agrees on every verdict.
  {
    const { store } = scratchStore();
    const noteDir = mkdtempSync(join(tmpdir(), 'coh-calgraph-atlas-'));
    cleanupDirs.push(noteDir);
    const base = readFileSync(join(NOTES, 'sample-note.md'), 'utf8');
    const COVERAGE_LINE = 'coverage: covered-negatives 2; slices swept 6 of 8';
    const noteWith = (name, line) => {
      const p = join(noteDir, name);
      writeFileSync(p, base.replace(COVERAGE_LINE, `${COVERAGE_LINE}\n${line}`));
      return p;
    };
    const METRICS = join(REPO, 'scripts', 'calibration-metrics.mjs');
    const gate = (notePath) => {
      try { return { status: 0, out: execFileSync(process.execPath, [METRICS, '--validate-note', notePath], { encoding: 'utf8', timeout: 20000 }) }; }
      catch (e) { return { status: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
    };

    const okNote = noteWith('atlas-ok.md', 'atlas: sections 9; fresh 5; refreshed 3; falsified 1');
    const n1 = run(['ingest', '--note', okNote, '--store', store, '--label', 'fixture Go event pipeline']);
    check('n. a note carrying an atlas line ingests (exit 0)', n1.status === 0, n1.stdout + n1.stderr);
    const nDoc = readJson(join(store, 'runs', 'R-004.json'));
    check('n. the four atlas counts land in the run doc', nDoc.atlas && nDoc.atlas.sections === 9
      && nDoc.atlas.fresh === 5 && nDoc.atlas.refreshed === 3 && nDoc.atlas.falsified === 1, JSON.stringify(nDoc.atlas));
    const nv = run(['validate', '--store', store]);
    check('n. the store still validates with an atlas field present', nv.status === 0, nv.stdout + nv.stderr);
    const ntr = run(['query', 'trend', '--store', store]);
    check('n. trend prints the atlas tail for the run that measured one',
      /R-004[^\n]*atlas 5 fresh, 3 refreshed, 1 falsified of 9/.test(ntr.stdout), ntr.stdout);
    check('n. trend prints no atlas tail for the runs that predate the leg',
      !/R-00[123][^\n]*atlas /.test(ntr.stdout), ntr.stdout);
    const gOk = gate(okNote);
    check('n. the note gate agrees the atlas line is well-formed (exit 0)',
      gOk.status === 0 && /0 machine-block hit\(s\)/.test(gOk.out), gOk.out);

    // Fail-closed classes, each on its own scratch store so nothing partial is left behind.
    const badShape = noteWith('atlas-bad-shape.md', 'atlas: sections 9; fresh some; refreshed 3; falsified 1');
    const s1 = scratchStore().store;
    const r1 = run(['ingest', '--note', badShape, '--store', s1]);
    check('n. a non-numeric atlas count is refused at ingest (exit 1)', r1.status === 1, r1.stdout + r1.stderr);
    check('n. the refusal names the offending line',
      /L\d+: line matches no Machine-block shape: atlas: sections 9; fresh some/.test(r1.stderr), r1.stderr);
    check('n. nothing was written', !readdirSync(join(s1, 'runs')).includes('R-004.json'), readdirSync(join(s1, 'runs')).join(','));
    const gBad = gate(badShape);
    check('n. the note gate refuses the same line (exit 1)',
      gBad.status === 1 && /MACHINE-LINE[\s\S]*atlas: sections 9; fresh some/.test(gBad.out), gBad.out);

    const overConsumed = noteWith('atlas-over-consumed.md', 'atlas: sections 4; fresh 3; refreshed 2; falsified 0');
    const s2 = scratchStore().store;
    const r2 = run(['ingest', '--note', overConsumed, '--store', s2]);
    check('n. consuming more sections than the atlas holds is refused (exit 1)', r2.status === 1, r2.stdout + r2.stderr);
    check('n. the refusal names the counts and why they are impossible',
      /4 section\(s\) but reports 3 fresh, 2 refreshed and 0 falsified[\s\S]*cannot consume or falsify more sections/.test(r2.stderr), r2.stderr);
    check('n. the shape gate alone would have passed it — the bound is the ingest side',
      gate(overConsumed).status === 0, gate(overConsumed).out);

    const overFalsified = noteWith('atlas-over-falsified.md', 'atlas: sections 4; fresh 1; refreshed 1; falsified 9');
    const s3 = scratchStore().store;
    const r3 = run(['ingest', '--note', overFalsified, '--store', s3]);
    check('n. falsifying more sections than exist is refused (exit 1)', r3.status === 1, r3.stdout + r3.stderr);
    check('n. nothing was written for the over-falsified note', !readdirSync(join(s3, 'runs')).includes('R-004.json'), readdirSync(join(s3, 'runs')).join(','));
  }

  failureClass('n1. a negative stored atlas count',
    (s) => { const p = join(s, 'runs', 'R-001.json'); const d = readJson(p); d.atlas = { sections: 5, fresh: -1, refreshed: 0, falsified: 0 }; writeJson(p, d); },
    /schema: runs\/R-001\.json: atlas\.fresh must be a non-negative integer/);

  failureClass('n2. a stored atlas consuming more sections than it holds',
    (s) => { const p = join(s, 'runs', 'R-001.json'); const d = readJson(p); d.atlas = { sections: 4, fresh: 3, refreshed: 2, falsified: 0 }; writeJson(p, d); },
    /schema:[^\n]*atlas\.fresh \+ atlas\.refreshed \(5\) exceeds atlas\.sections \(4\)/);

  failureClass('n3. a stored atlas falsifying more sections than it holds',
    (s) => { const p = join(s, 'runs', 'R-001.json'); const d = readJson(p); d.atlas = { sections: 4, fresh: 1, refreshed: 1, falsified: 9 }; writeJson(p, d); },
    /schema:[^\n]*atlas\.falsified \(9\) exceeds atlas\.sections \(4\)/);

  failureClass('n4. a stored atlas that is not an object',
    (s) => { const p = join(s, 'runs', 'R-001.json'); const d = readJson(p); d.atlas = 9; writeJson(p, d); },
    /schema: runs\/R-001\.json: atlas, when present, must be an object/);

  // ---- j. the real store was never written to by this eval --------------------
  check('j. the real table is byte-identical to what render --check accepted', readFileSync(REAL_TABLE, 'utf8') === table, 'real table changed during the eval');
  check('j. the real store still has exactly its three run docs',
    readdirSync(join(REAL_STORE, 'runs')).sort().join(',') === 'R-001.json,R-002.json,R-003.json', readdirSync(join(REAL_STORE, 'runs')).join(','));
} finally {
  for (const d of cleanupDirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} calibration-graph regression check(s) failed:`);
  for (const fmsg of fails) console.error('  x ' + fmsg);
  process.exit(1);
}
console.log('\nOK — all calibration-graph regression checks passed.');
