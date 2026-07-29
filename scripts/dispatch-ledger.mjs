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
// Exit: add/update/phase -> 0 on success, 1 on a validation rejection (bad brief length,
// missing/unresolvable --model, unknown id, invalid transition, a phase title carrying the
// marker's own delimiters), 2 on a usage error.
// check -> 0 (schema clean; any dangling/unstamped rows are printed as advisories), 1 on
// a schema violation, or (with --strict) on a dangling `dispatched` row or an unstamped
// row too. 2 on a usage error.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HEADER = '| id | role | brief | expected artifact | status |\n'
  + '| --- | --- | --- | --- | --- |\n';
const STATUSES = ['dispatched', 'reported', 'failed', 'redispatched'];
const ROW_RE = /^\|\s*(D-\d+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/;
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
  const unstamped = rows.filter((r) => !r.role.includes('@'));
  for (const r of unstamped)
    console.log(`  advisory: ${r.id} unstamped dispatch (pre-stamp row or resolver failure) — tier mix not reconstructable`);

  console.log(`\n${rows.length} row(s), 0 schema violation(s), ${dangling.length} dangling dispatch(es), ${unstamped.length} unstamped dispatch(es).`);
  if (dangling.length && strict) {
    console.error('--strict: dangling dispatched row(s) present — treat as failed.');
    process.exit(1);
  }
  if (unstamped.length && strict) {
    console.error('--strict: unstamped dispatch row(s) present — tier mix not reconstructable.');
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
