#!/usr/bin/env node
// Dispatch-ledger tool for the code-ops suite — mechanizes the DISPATCH_LEDGER.md
// convention (CONVENTIONS.md §12: "Standard filenames"; row grammar pinned in
// scripts/revalidate-register.mjs's --dispatch-ledger comment).
//
//   node scripts/dispatch-ledger.mjs add --ledger <path> --role <r> --brief <text> --artifact <a> --model <m>
//   node scripts/dispatch-ledger.mjs update --ledger <path> --id D-NNN --status <s>
//   node scripts/dispatch-ledger.mjs phase --ledger <path> --title <t> --lead-model <m>
//   node scripts/dispatch-ledger.mjs check --ledger <path> [--strict]
//
// WHY: a dispatch ledger is the record that an operative was sent out at all — the
// proven field failure is a lead that loses track of an in-flight dispatch (dies,
// hangs, or never reports) and silently proceeds as if nothing was sent. `add` writes
// the row AT dispatch time (before the operative runs), `update` records its outcome,
// and `check` is the read side: schema validation is fail-closed (a malformed ledger
// is worse than no ledger), while a dangling `dispatched` row is an ADVISORY only —
// mirroring revalidate-register.mjs's --dispatch-ledger philosophy, because a
// legitimate resume-in-progress dispatch must not be blocked by its own tooling.
//
// Row grammar: | D-NNN | role@model | brief (<=10 words) | expected artifact | status |
// status one of: dispatched | reported | failed | redispatched
// Phase marker (optional, written by `phase`): `> phase: <title> · lead@<model>` on its own
// line, positional — the rows after it belong to that phase. It records which model LED each
// stretch, the one thing the per-row stamp can't show; `check` accepts it and fails closed on a
// line that starts `> phase:` without matching the grammar. Parsers that read only pipe rows
// ignore it, so ledgers stay readable by every existing consumer.
//
// WHY role@model: a real-scale calibration run found a lead silently substituting one
// model tier down mid-run with no artifact recording which model actually executed a
// dispatch — the tier-mix metric becomes unreconstructable and an unattended run can
// finish verdicts a tier low, invisibly. `add` now REQUIRES --model <resolved-model-id>
// and stamps it into the role cell as `role@model`, keeping the 5-cell grammar and every
// parser that treats the cell as opaque text unchanged. A role cell with no `@model`
// (a pre-stamp row, or a resolver that failed to report its model) is an unstamped
// dispatch: `check` flags it as an advisory (tier mix not reconstructable for that row),
// promoted to a failure under --strict. Legacy ledgers without the stamp still PARSE.
//
// The model half is MACHINE-PARSED, not just carried: `check` splits each role cell on its last
// '@' and reports the per-model and per-model-class dispatch counts, resolving each stamped id
// through scripts/model-tiers.mjs (the ladder SSOT). A row with no stamp counts as `unstamped`
// and a stamped id outside the pinned ladders counts as `unclassified` — both are reported,
// never dropped and never guessed at, so the mix line is a reading of the ledger rather than an
// inference about it.
//
// WHY the write journal (check name: `phantom-row`): the prior enforcement was prose-only —
// "write the row atomically with the dispatch call" — and a snapshot of the finished artifact
// cannot tell a real dispatch from a row minted by a direct or batch edit of the file (often
// straight at `reported`). Both look identical. So provenance is recorded at WRITE time:
// `add`/`update`/`phase` append a line to `<ledger>.journal.jsonl` (JSONL, deterministic, no
// timestamps), and `check` replays it against the rows. A row with no journaled `add` is a
// PHANTOM — it was never dispatched by this tool — and fails closed even without --strict,
// because unlike a dangling row it has no legitimate explanation.
//
// Journal creation is deliberately conservative for backward compatibility: `add`/`phase`
// create the journal only when they create the LEDGER; an existing ledger with no journal is a
// pre-journal artifact and stays unjournaled (minting one now would make every pre-existing row
// a false phantom), and `update` never creates one. `check` on an unjournaled ledger with rows
// is an ADVISORY (phantom rows simply undetectable there), promoted by --strict.
//
// Exit: add/update/phase -> 0 on success, 1 on a validation rejection (bad brief length,
// missing/unresolvable --model, unknown id, invalid transition, a phase title carrying the
// marker's own delimiters), 2 on a usage error.
// check -> 0 (schema clean; any dangling/unstamped rows and an absent journal are printed as
// advisories), 1 on a schema violation, on a journal violation (phantom row, out-of-band status
// edit, journaled row missing from the ledger, unreadable journal line), or (with --strict) on a
// dangling `dispatched` row, an unstamped row, or an unjournaled ledger too. 2 on a usage error.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { modelClassOf, MODEL_CLASS_ORDER } from './model-tiers.mjs';
import { LEDGER_HEADER, LEDGER_ROW_RE, LEDGER_STATUSES } from './ledger-grammar.mjs';

// Grammar (a) comes from scripts/ledger-grammar.mjs so this writer and the two readers
// (calibration-metrics.mjs, estimate-run-cost.mjs) cannot drift apart.
const HEADER = LEDGER_HEADER;
const STATUSES = LEDGER_STATUSES;
const ROW_RE = LEDGER_ROW_RE;
// Phase marker: `> phase: <title> · lead@<model>`, a blockquote line so every parser that reads
// only pipe rows (this file's parseRows, revalidate-register.mjs's --dispatch-ledger scan)
// ignores it unchanged. Positional: the rows after it belong to that phase.
const PHASE_RE = /^> phase: (.+) · lead@(\S+)$/;
const PHASE_PREFIX = '> phase:';

function usage() {
  console.error('usage: dispatch-ledger.mjs add --ledger <path> --role <r> --brief <text> --artifact <a> --model <m>');
  console.error('       dispatch-ledger.mjs update --ledger <path> --id D-NNN --status <s>');
  console.error('       dispatch-ledger.mjs phase --ledger <path> --title <t> --lead-model <m>');
  console.error('       dispatch-ledger.mjs check --ledger <path> [--strict]');
  process.exit(2);
}

// Shared flag parser: reads --flag value pairs, rejecting a missing/blank value or one
// that looks like another flag (a typo'd earlier flag must not swallow the next one).
function parseFlags(args, known) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!known.has(a)) { console.error(`x unknown argument: ${a}`); usage(); }
    const v = args[++i];
    if (v === undefined || v.trim() === '' || v.startsWith('--')) { console.error(`x ${a} needs a value`); process.exit(2); }
    out[a] = v;
  }
  return out;
}

function readLedger(path) {
  if (!existsSync(path)) return null;
  try { return readFileSync(path, 'utf8'); }
  catch (e) { console.error(`x cannot read ledger ${path}: ${e.message}`); process.exit(2); }
}

// Parses every table row after the header/rule lines. Returns { rows, malformed } where
// rows is [{ id, role, brief, artifact, status, line }] and malformed is a list of
// human-readable descriptions of any row that failed to parse or had a bad shape.
function parseRows(text) {
  const rows = [];
  const phases = [];
  const malformed = [];
  const lines = text.split('\n');
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\r$/, '').trim();
    // A line that announces itself as a phase marker but doesn't match the grammar is a schema
    // violation, not prose to skip — a mistyped marker would otherwise silently drop the phase.
    if (line.startsWith(PHASE_PREFIX)) {
      const pm = PHASE_RE.exec(line);
      if (!pm) { malformed.push(`L${idx + 1}: malformed phase marker (expected \`> phase: <title> · lead@<model>\`): ${line.slice(0, 100)}`); return; }
      phases.push({ title: pm[1], lead: pm[2], line: idx + 1 });
      return;
    }
    if (!line.startsWith('|')) return;
    if (/^\|\s*id\s*\|/.test(line)) return; // header
    if (/^\|(\s*:?-+:?\s*\|)+$/.test(line)) return; // rule row
    const m = ROW_RE.exec(line);
    if (!m) { malformed.push(`L${idx + 1}: malformed row shape: ${line.slice(0, 100)}`); return; }
    const [, id, role, brief, artifact, status] = m;
    if (!STATUSES.includes(status)) { malformed.push(`L${idx + 1}: ${id}: invalid status '${status}'`); return; }
    rows.push({ id, role, brief, artifact, status, line: idx + 1 });
  });
  return { rows, phases, malformed };
}

function nextId(rows) {
  let max = 0;
  for (const r of rows) {
    const n = Number(r.id.slice(2));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return `D-${String(max + 1).padStart(3, '0')}`;
}

function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Splits a `role@model` cell on its LAST '@', so a role name that itself carries '@'
// (unlikely, but not impossible) cannot misparse the model. A cell with no '@', or one whose
// model half is blank, is an unstamped dispatch: `{ role, model: null }`, never a guess.
function splitRoleCell(cell) {
  const at = cell.lastIndexOf('@');
  if (at === -1) return { role: cell.trim(), model: null };
  const model = cell.slice(at + 1).trim();
  return { role: cell.slice(0, at).trim(), model: model === '' ? null : model };
}

// Per-model and per-model-class dispatch counts over parsed rows. `unstamped` is its own
// bucket in both: a row that never recorded its model is a hole in the record, and folding it
// into a class would report a tier that was never observed.
function summarizeModelMix(rows) {
  const byModel = new Map();
  const byClass = new Map();
  for (const r of rows) {
    const { model } = splitRoleCell(r.role);
    const key = model ?? 'unstamped';
    const cls = model === null ? 'unstamped' : modelClassOf(model);
    byModel.set(key, (byModel.get(key) ?? 0) + 1);
    byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
  }
  // Model ids sort alphabetically (no meaningful order among them); classes follow the
  // ladder's own order so two runs' mix lines line up column for column.
  const order = [...MODEL_CLASS_ORDER, 'unstamped'];
  const fmt = (map, keys) => keys.map((k) => `${k} ${map.get(k)}`).join(', ') || '(none)';
  return {
    models: fmt(byModel, [...byModel.keys()].sort()),
    classes: fmt(byClass, order.filter((k) => byClass.has(k))),
  };
}

// ---------------------------------------------------------------- write journal

// The journal lives beside the ledger it describes, so a run artifact folder carries its own
// provenance and neither file can be moved away from the other by accident.
function journalPathFor(ledgerPath) {
  return `${ledgerPath}.journal.jsonl`;
}

// Appends one provenance entry. `mayCreate` is true only when this same command is creating the
// ledger itself: an existing ledger with no journal is a pre-journal artifact, and writing a
// journal for it would make every row already in the file a false phantom.
//
// ORDER MATTERS: every caller appends here BEFORE writing the ledger. A crash between the two
// writes then leaves a journaled entry with no row — reported as MISSING-ROW, an honest crash
// signal. The reverse order would leave a row with no journal entry, i.e. a PHANTOM, which is
// the fabrication signal; a crash must never be able to counterfeit fabrication.
function journalAppend(ledgerPath, entry, mayCreate) {
  const jp = journalPathFor(ledgerPath);
  if (!existsSync(jp) && !mayCreate) return;
  try { appendFileSync(jp, JSON.stringify(entry) + '\n'); }
  catch (e) { console.error(`x cannot write dispatch journal ${jp}: ${e.message}`); process.exit(2); }
}

// Replays the journal into the final status each id should carry. Returns
// { expected: Map<id, status>, violations: string[] } — violations are fail-closed: a line that
// cannot be read is a journal that cannot be trusted to prove anything.
function replayJournal(text) {
  const expected = new Map();
  const violations = [];
  text.split('\n').forEach((raw, idx) => {
    const line = raw.replace(/\r$/, '').trim();
    if (line === '') return;
    const at = `J${idx + 1}`;
    let e;
    try { e = JSON.parse(line); }
    catch { violations.push(`${at}: unparseable journal line: ${line.slice(0, 100)}`); return; }
    if (!e || typeof e !== 'object' || Array.isArray(e)) { violations.push(`${at}: journal entry is not an object: ${line.slice(0, 100)}`); return; }
    if (e.op === 'phase') {
      if (typeof e.title !== 'string' || e.title === '') violations.push(`${at}: phase entry needs a non-empty title: ${line.slice(0, 100)}`);
      return;
    }
    if (e.op === 'add') {
      if (typeof e.id !== 'string' || !/^D-\d+$/.test(e.id) || e.status !== 'dispatched') { violations.push(`${at}: malformed add entry: ${line.slice(0, 100)}`); return; }
      if (expected.has(e.id)) { violations.push(`${at}: duplicate add for ${e.id}`); return; }
      expected.set(e.id, e.status);
      return;
    }
    if (e.op === 'update') {
      if (typeof e.id !== 'string' || !/^D-\d+$/.test(e.id) || !STATUSES.includes(e.to)) { violations.push(`${at}: malformed update entry: ${line.slice(0, 100)}`); return; }
      if (!expected.has(e.id)) { violations.push(`${at}: update for ${e.id}, which was never added`); return; }
      expected.set(e.id, e.to);
      return;
    }
    violations.push(`${at}: unknown journal op: ${line.slice(0, 100)}`);
  });
  return { expected, violations };
}

// ---------------------------------------------------------------- add

function cmdAdd(args) {
  const f = parseFlags(args, new Set(['--ledger', '--role', '--brief', '--artifact', '--model']));
  for (const req of ['--ledger', '--role', '--brief', '--artifact'])
    if (!(req in f)) { console.error(`x add needs ${req}`); usage(); }
  if (!('--model' in f)) {
    console.error('x add needs --model <resolved-model-id> — without it, the tier a dispatch actually ran on cannot be reconstructed after the fact (calibration finding: silent tier substitution goes invisible)');
    process.exit(1);
  }
  if (wordCount(f['--brief']) > 10) {
    console.error(`x brief exceeds 10 words (${wordCount(f['--brief'])}): ${JSON.stringify(f['--brief'])}`);
    process.exit(1);
  }
  const path = resolve(f['--ledger']);
  const text = readLedger(path);
  if (text !== null) {
    const { malformed } = parseRows(text);
    if (malformed.length) {
      console.error(`x refusing to append to a malformed ledger — fix these rows first:\n  ${malformed.join('\n  ')}`);
      process.exit(1);
    }
  }
  const { rows } = text === null ? { rows: [] } : parseRows(text);
  const id = nextId(rows);
  const role = `${f['--role']}@${f['--model']}`;
  const row = `| ${id} | ${role} | ${f['--brief']} | ${f['--artifact']} | dispatched |\n`;
  const body = (text === null ? HEADER : (text.endsWith('\n') ? text : text + '\n')) + row;
  journalAppend(path, { op: 'add', id, status: 'dispatched' }, text === null);
  writeFileSync(path, body);
  console.log(`(dispatch-ledger) ${id} dispatched -> ${f['--ledger']}`);
}

// ---------------------------------------------------------------- phase

// A phase marker records WHO led each stretch of a run. The proven field failure the row stamp
// doesn't cover: the lead itself changes tier mid-run (a fresh session picks a lower model),
// so every dispatch stays correctly stamped while the judgment above them silently drops a
// tier. The marker makes that reconstructable — calibration-metrics.mjs reports lead model by
// phase and flags a mid-run change.
function cmdPhase(args) {
  const f = parseFlags(args, new Set(['--ledger', '--title', '--lead-model']));
  for (const req of ['--ledger', '--title', '--lead-model'])
    if (!(req in f)) { console.error(`x phase needs ${req}`); usage(); }
  const title = f['--title'].trim();
  const lead = f['--lead-model'].trim();
  // The marker's own delimiters may not appear inside the title, and a model id carrying
  // whitespace would break the `lead@<model>` token — both would make the line unparseable.
  if (title === '' || /[|·]/.test(title)) {
    console.error("x --title must be non-empty and free of '|' and '·' (the marker's own delimiters)");
    process.exit(1);
  }
  if (/\s/.test(lead)) {
    console.error('x --lead-model must be a single whitespace-free resolved model id');
    process.exit(1);
  }
  const path = resolve(f['--ledger']);
  const text = readLedger(path);
  if (text !== null) {
    const { malformed } = parseRows(text);
    if (malformed.length) {
      console.error(`x refusing to append to a malformed ledger — fix these rows first:\n  ${malformed.join('\n  ')}`);
      process.exit(1);
    }
  }
  const marker = `> phase: ${title} · lead@${lead}\n`;
  const body = (text === null ? HEADER : (text.endsWith('\n') ? text : text + '\n')) + marker;
  journalAppend(path, { op: 'phase', title }, text === null);
  writeFileSync(path, body);
  console.log(`(dispatch-ledger) phase '${title}' lead@${lead} -> ${f['--ledger']}`);
}

// ---------------------------------------------------------------- update

// terminal|reachable status transitions: `reported` is terminal (no further change);
// `failed` may move on to `redispatched`; `dispatched` and `redispatched` may move to
// any of the three outcome statuses.
function transitionAllowed(from, to) {
  if (from === 'reported') return false;
  if (from === 'failed') return to === 'redispatched';
  return ['reported', 'failed', 'redispatched'].includes(to);
}

function cmdUpdate(args) {
  const f = parseFlags(args, new Set(['--ledger', '--id', '--status']));
  for (const req of ['--ledger', '--id', '--status'])
    if (!(req in f)) { console.error(`x update needs ${req}`); usage(); }
  if (!STATUSES.includes(f['--status'])) {
    console.error(`x --status must be one of: ${STATUSES.join(', ')}`);
    process.exit(1);
  }
  const path = resolve(f['--ledger']);
  const text = readLedger(path);
  if (text === null) { console.error(`x ledger not found: ${f['--ledger']}`); process.exit(1); }
  const { rows, malformed } = parseRows(text);
  if (malformed.length) {
    console.error(`x ledger has malformed rows — fix before updating:\n  ${malformed.join('\n  ')}`);
    process.exit(1);
  }
  const target = rows.find((r) => r.id === f['--id']);
  if (!target) { console.error(`x unknown id: ${f['--id']}`); process.exit(1); }
  if (!transitionAllowed(target.status, f['--status'])) {
    console.error(`x invalid transition ${target.status} -> ${f['--status']} for ${f['--id']}`
      + (target.status === 'reported' ? ' (reported is terminal)' : ''));
    process.exit(1);
  }
  const lines = text.split('\n');
  const original = lines[target.line - 1];
  const updated = original.replace(/\|\s*[^|]*\s*\|$/, `| ${f['--status']} |`);
  lines[target.line - 1] = updated;
  // `update` never creates a journal — only the command that creates the ledger may.
  journalAppend(path, { op: 'update', id: f['--id'], to: f['--status'] }, false);
  writeFileSync(path, lines.join('\n'));
  console.log(`(dispatch-ledger) ${f['--id']} ${target.status} -> ${f['--status']}`);
}

// ---------------------------------------------------------------- check

function cmdCheck(args) {
  const strict = args.includes('--strict');
  const rest = args.filter((a) => a !== '--strict');
  const f = parseFlags(rest, new Set(['--ledger']));
  if (!('--ledger' in f)) { console.error('x check needs --ledger'); usage(); }
  const path = resolve(f['--ledger']);
  const text = readLedger(path);
  if (text === null) { console.error(`x ledger not found: ${f['--ledger']}`); process.exit(1); }

  const { rows, phases, malformed } = parseRows(text);
  for (const m of malformed) console.log(`  !! MALFORMED  ${m}`);
  for (const ph of phases) console.log(`  phase: ${ph.title} · lead@${ph.lead} (line ${ph.line})`);

  // Monotonically increasing ids: each id's numeric part must exceed the previous row's.
  let prev = 0;
  for (const r of rows) {
    const n = Number(r.id.slice(2));
    if (!Number.isFinite(n) || n <= prev) {
      malformed.push(`${r.id} (line ${r.line}): id not strictly increasing after D-${String(prev).padStart(3, '0')}`);
      console.log(`  !! OUT-OF-ORDER  ${r.id} (line ${r.line}) does not exceed the previous id`);
    }
    prev = Math.max(prev, n);
  }

  if (malformed.length) {
    console.log(`\n${rows.length} row(s), ${malformed.length} schema violation(s).`);
    process.exit(1);
  }

  const dangling = rows.filter((r) => r.status === 'dispatched');
  for (const r of dangling)
    console.log(`  advisory: ${r.id} still 'dispatched' — operative may have died or hung; re-dispatch or mark failed before resuming`);

  // A role cell with no `@model` is a pre-stamp row or a resolver that failed to report its
  // model: the tier that actually ran the dispatch cannot be reconstructed from this row.
  const unstamped = rows.filter((r) => splitRoleCell(r.role).model === null);
  for (const r of unstamped)
    console.log(`  advisory: ${r.id} unstamped dispatch (pre-stamp row or resolver failure) — tier mix not reconstructable`);

  // The model half, read back as counts. Reported for any ledger with rows — including an
  // all-legacy one, where the honest reading is `unstamped N`.
  if (rows.length) {
    const mix = summarizeModelMix(rows);
    console.log(`  model mix: ${mix.models}`);
    console.log(`  model-class mix: ${mix.classes}`);
  }

  // ---- phantom-row cross-reference: the ledger against its own write journal ----------
  const jp = journalPathFor(path);
  const journalled = existsSync(jp);
  let journalNote = 'absent';
  const journalViolations = [];
  if (!journalled) {
    if (rows.length)
      console.log('  advisory: unjournaled ledger (pre-journal artifact, or rows written without dispatch-ledger.mjs) — phantom rows are undetectable here');
  } else {
    const jtext = readLedger(jp) ?? '';
    const { expected, violations } = replayJournal(jtext);
    journalViolations.push(...violations);
    for (const v of violations) console.log(`  !! JOURNAL  ${v}`);
    if (!violations.length) {
      for (const r of rows) {
        if (!expected.has(r.id)) {
          journalViolations.push(`${r.id}: phantom row`);
          console.log(`  !! PHANTOM  ${r.id} (line ${r.line}): row has no recorded dispatch call — minted by a direct artifact edit, not dispatch-ledger.mjs add`);
        } else if (expected.get(r.id) !== r.status) {
          journalViolations.push(`${r.id}: out-of-band status`);
          console.log(`  !! OUT-OF-BAND  ${r.id} (line ${r.line}): status '${r.status}' was not written by dispatch-ledger.mjs update — the journal replays to '${expected.get(r.id)}'`);
        }
      }
      const present = new Set(rows.map((r) => r.id));
      for (const id of expected.keys()) {
        if (present.has(id)) continue;
        journalViolations.push(`${id}: journaled row missing`);
        console.log(`  !! MISSING-ROW  ${id}: journaled as dispatched but no row in the ledger — the row was deleted, or a write died between the journal and the ledger`);
      }
    }
    journalNote = journalViolations.length ? `${journalViolations.length} violation(s)` : 'verified';
  }

  console.log(`\n${rows.length} row(s), 0 schema violation(s), ${dangling.length} dangling dispatch(es), ${unstamped.length} unstamped dispatch(es), journal: ${journalNote}.`);
  // A phantom (or an out-of-band edit, or a vanished journaled row) has no legitimate
  // explanation the way a dangling row does, so it fails closed without --strict.
  if (journalViolations.length) {
    console.error(`x journal cross-reference failed: ${journalViolations.length} violation(s) — the ledger does not match the writes dispatch-ledger.mjs actually made.`);
    process.exit(1);
  }
  if (dangling.length && strict) {
    console.error('--strict: dangling dispatched row(s) present — treat as failed.');
    process.exit(1);
  }
  if (unstamped.length && strict) {
    console.error('--strict: unstamped dispatch row(s) present — tier mix not reconstructable.');
    process.exit(1);
  }
  if (!journalled && rows.length && strict) {
    console.error('--strict: unjournaled ledger — phantom rows cannot be ruled out.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------- dispatch

const argv = process.argv.slice(2);
if (argv[0] === 'add') cmdAdd(argv.slice(1));
else if (argv[0] === 'phase') cmdPhase(argv.slice(1));
else if (argv[0] === 'update') cmdUpdate(argv.slice(1));
else if (argv[0] === 'check') cmdCheck(argv.slice(1));
else usage();
