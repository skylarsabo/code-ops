#!/usr/bin/env node
// Dispatch-ledger tool for the code-ops suite — mechanizes the DISPATCH_LEDGER.md
// convention (CONVENTIONS.md §12: "Standard filenames"; row grammar pinned in
// scripts/revalidate-register.mjs's --dispatch-ledger comment).
//
//   node scripts/dispatch-ledger.mjs add --ledger <path> --role <r> --brief <text> --artifact <a>
//   node scripts/dispatch-ledger.mjs update --ledger <path> --id D-NNN --status <s>
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
// Row grammar: | D-NNN | role | brief (<=10 words) | expected artifact | status |
// status one of: dispatched | reported | failed | redispatched
//
// Exit: add/update -> 0 on success, 1 on a validation rejection (bad brief length,
// unknown id, invalid transition), 2 on a usage error. check -> 0 (schema clean; any
// dangling rows are printed as advisories), 1 on a schema violation, or (with
// --strict) on a dangling `dispatched` row too. 2 on a usage error.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HEADER = '| id | role | brief | expected artifact | status |\n'
  + '| --- | --- | --- | --- | --- |\n';
const STATUSES = ['dispatched', 'reported', 'failed', 'redispatched'];
const ROW_RE = /^\|\s*(D-\d+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/;

function usage() {
  console.error('usage: dispatch-ledger.mjs add --ledger <path> --role <r> --brief <text> --artifact <a>');
  console.error('       dispatch-ledger.mjs update --ledger <path> --id D-NNN --status <s>');
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
  const malformed = [];
  const lines = text.split('\n');
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\r$/, '').trim();
    if (!line.startsWith('|')) return;
    if (/^\|\s*id\s*\|/.test(line)) return; // header
    if (/^\|(\s*:?-+:?\s*\|)+$/.test(line)) return; // rule row
    const m = ROW_RE.exec(line);
    if (!m) { malformed.push(`L${idx + 1}: malformed row shape: ${line.slice(0, 100)}`); return; }
    const [, id, role, brief, artifact, status] = m;
    if (!STATUSES.includes(status)) { malformed.push(`L${idx + 1}: ${id}: invalid status '${status}'`); return; }
    rows.push({ id, role, brief, artifact, status, line: idx + 1 });
  });
  return { rows, malformed };
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
  const f = parseFlags(args, new Set(['--ledger', '--role', '--brief', '--artifact']));
  for (const req of ['--ledger', '--role', '--brief', '--artifact'])
    if (!(req in f)) { console.error(`x add needs ${req}`); usage(); }
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
  const row = `| ${id} | ${f['--role']} | ${f['--brief']} | ${f['--artifact']} | dispatched |\n`;
  const body = (text === null ? HEADER : (text.endsWith('\n') ? text : text + '\n')) + row;
  writeFileSync(path, body);
  console.log(`(dispatch-ledger) ${id} dispatched -> ${f['--ledger']}`);
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

  const { rows, malformed } = parseRows(text);
  for (const m of malformed) console.log(`  !! MALFORMED  ${m}`);

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

  console.log(`\n${rows.length} row(s), 0 schema violation(s), ${dangling.length} dangling dispatch(es).`);
  if (dangling.length && strict) {
    console.error('--strict: dangling dispatched row(s) present — treat as failed.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------- dispatch

const argv = process.argv.slice(2);
if (argv[0] === 'add') cmdAdd(argv.slice(1));
else if (argv[0] === 'update') cmdUpdate(argv.slice(1));
else if (argv[0] === 'check') cmdCheck(argv.slice(1));
else usage();
