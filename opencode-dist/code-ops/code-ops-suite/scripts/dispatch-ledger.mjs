#!/usr/bin/env node
// Dispatch-ledger tool for the code-ops suite — mechanizes the DISPATCH_LEDGER.md
// convention (CONVENTIONS.md §12: "Standard filenames"; row grammar pinned in
// scripts/revalidate-register.mjs's --dispatch-ledger comment).
//
//   node scripts/dispatch-ledger.mjs add --ledger <path> --role <r> --brief <text> --artifact <a> --model <m> [--actor-id <id>]
//   node scripts/dispatch-ledger.mjs update --ledger <path> --id D-NNN --status <s> [--actor-id <id>] [--report <path> [--sections <a,b>]]
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
// WHY --report on `update --status reported` (calibration lesson L-050): an operative that has a
// write tool writes its own report to the path its brief names and returns a pointer. `--report`
// gates that file before the row turns terminal: missing, empty, or lacking a non-empty heading
// for every `--sections` name is a rejection, and the row keeps its prior status. The flag is
// optional so an inline report the lead persisted itself can use it too, and so legacy callers
// keep working; it never relaxes any other update rule.
//
// WHY --contract/--unit on `add` (calibration lessons L-053, L-054): `add` used to mint the
// next serial id itself and to treat --actor-id as always optional. Against a version 4 run
// contract that mis-keys rows the moment units dispatch out of contract order — the row for
// D-002 lands under whatever id `add` guessed next, not the id the contract actually planned —
// and it let a missing actor slip past append time, since only `run-contract.mjs reconcile`
// (in-flight at a checkpoint, strict at finalization) enforces one actor per activation, by
// which point the append-only journal can no longer be corrected. `--contract <path>` + `--unit <D-NNN>` names the unit
// `add` is dispatching (run-contract.mjs alone still owns full contract validation; this file
// trusts it and checks only that the named unit exists and that the row about to be written
// matches it exactly), stamps the unit id as the row id — never `nextId` — and, for a version 4
// contract, requires --actor-id up front and refuses an actor already bound to a different unit.
// The first such add on a ledger BINDS it to that contract's runId (recorded in the journal);
// every later add on that ledger must stay on the same run, and a bound journal's `update
// --status redispatched` inherits the same actor requirement.
//
// Exit: add/update/phase -> 0 on success, 1 on a validation rejection (bad brief length,
// missing/unresolvable --model, unknown id, invalid transition, a report file that fails the
// shape gate, a phase title carrying the marker's own delimiters, a --contract unit that is
// unknown or whose row would not match it exactly, a duplicate contract-unit dispatch, a
// version 4 dispatch or bound redispatch missing --actor-id or reusing one across units, a
// --contract add that breaks the ledger's runId binding, or a version 4 --contract add that
// tries to start a binding on an already-written but unbound ledger), 2 on a usage error
// (including --contract without --unit, or --unit without --contract).
// check -> 0 (schema clean; any dangling/unstamped rows and an absent journal are printed as
// advisories), 1 on a schema violation, on a journal violation (phantom row, out-of-band status
// edit, journaled row missing from the ledger, unreadable journal line, a journal mixing
// runId-bound and unbound add events, or one naming more than one runId), or (with --strict) on
// a dangling `dispatched` row, an unstamped row, or an unjournaled ledger too. 2 on a usage error.

import { readFileSync, writeFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { modelClassOf, MODEL_CLASS_ORDER } from './model-tiers.mjs';
import { LEDGER_HEADER, LEDGER_ROW_RE, LEDGER_STATUSES, replayDispatchJournal } from './ledger-grammar.mjs';

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
  console.error('usage: dispatch-ledger.mjs add --ledger <path> --role <r> --brief <text> --artifact <a> --model <m> [--actor-id <host-session-or-agent-id>] [--contract <path> --unit <D-NNN>]');
  console.error('       dispatch-ledger.mjs update --ledger <path> --id D-NNN --status <s> [--actor-id <host-session-or-agent-id>] [--report <path> [--sections <a,b>]]');
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

// `actorId` records the host/session agent identifier supplied by the caller. It supports
// continuity and separation checks inside one ledger; it is not cryptographic identity proof.
function actorId(value) {
  if (value === undefined) return null;
  if (!/^\S{1,200}$/u.test(value)) {
    console.error('x --actor-id must be a whitespace-free host session or agent id of at most 200 characters');
    process.exit(1);
  }
  return value;
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
  const rendered = JSON.stringify(entry) + '\n';
  try {
    const prior = existsSync(jp) ? readFileSync(jp, 'utf8') : '';
    const proposed = replayDispatchJournal(prior + rendered);
    if (proposed.violations.length) {
      console.error(`x refusing invalid dispatch journal event: ${proposed.violations.at(-1)}`);
      process.exit(1);
    }
    appendFileSync(jp, rendered);
  }
  catch (e) { console.error(`x cannot write dispatch journal ${jp}: ${e.message}`); process.exit(2); }
}

// Replays the journal into the final status each id should carry. Returns
// { expected: Map<id, status>, violations: string[] } — violations are fail-closed: a line that
// cannot be read is a journal that cannot be trusted to prove anything.
// ---------------------------------------------------------------- contract binding (L-053/L-054)

// Reads and MINIMALLY shape-checks a run contract — enough to find the named unit, never a
// substitute for scripts/run-contract.mjs's own validation (this file deliberately does not
// import it: importing would run its CLI, and re-validating the whole contract here would be
// policing a check run-contract.mjs already owns).
function loadContractUnit(contractPath, unitId) {
  let raw;
  try { raw = readFileSync(resolve(contractPath), 'utf8'); }
  catch (e) { console.error(`x cannot read contract ${contractPath}: ${e.message}`); process.exit(1); }
  let contract;
  try { contract = JSON.parse(raw); }
  catch (e) { console.error(`x cannot parse contract ${contractPath}: ${e.message}`); process.exit(1); }
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)
    || !Number.isInteger(contract.version) || typeof contract.runId !== 'string' || !Array.isArray(contract.units)) {
    console.error(`x ${contractPath} is not a run contract (needs an object with integer version, string runId, and array units — run-contract.mjs owns full validation)`);
    process.exit(1);
  }
  const unit = contract.units.find((u) => u && typeof u === 'object' && u.id === unitId);
  if (!unit) { console.error(`x contract ${contractPath} has no unit ${unitId}`); process.exit(1); }
  return { contract, unit };
}

// An actor already bound to a DIFFERENT unit by an activation event (`add`, or `update` to
// `redispatched`) elsewhere in the journal — the L-054 hazard is otherwise caught only at
// `run-contract.mjs reconcile --strict` finalization, after the journal can no longer be fixed.
// Returns the conflicting unit id, or null.
function actorBoundToOtherUnit(events, wantActorId, id) {
  for (const e of events) {
    const activating = e.op === 'add' || (e.op === 'update' && e.to === 'redispatched');
    if (activating && e.actorId === wantActorId && e.id !== id) return e.id;
  }
  return null;
}

// ---------------------------------------------------------------- add

function cmdAdd(args) {
  const f = parseFlags(args, new Set(['--ledger', '--role', '--brief', '--artifact', '--model', '--actor-id', '--contract', '--unit']));
  for (const req of ['--ledger', '--role', '--brief', '--artifact'])
    if (!(req in f)) { console.error(`x add needs ${req}`); usage(); }
  if (!('--model' in f)) {
    console.error('x add needs --model <resolved-model-id> — without it, the tier a dispatch actually ran on cannot be reconstructed after the fact (calibration finding: silent tier substitution goes invisible)');
    process.exit(1);
  }
  if (('--contract' in f) !== ('--unit' in f)) {
    console.error('x --contract and --unit must be given together');
    usage();
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

  // L-053/L-054: read the journal's binding state before deciding this add's id and legality. A
  // ledger binds to a contract run the first time a version 4 `--contract` add stamps a runId
  // into the journal (see the header WHY paragraph); every add after that must stay on the same
  // run, or name --contract to extend it.
  const jPath = journalPathFor(path);
  const priorJournalText = existsSync(jPath) ? readFileSync(jPath, 'utf8') : null;
  const priorJournal = priorJournalText !== null ? replayDispatchJournal(priorJournalText) : null;
  const boundRunId = priorJournal
    ? [...new Set(priorJournal.events.filter((e) => e.op === 'add' && e.runId).map((e) => e.runId))][0]
    : undefined;

  if (boundRunId && !('--contract' in f)) {
    console.error(`x ledger is bound to contract run '${boundRunId}' — pass --contract and --unit to keep dispatching against it`);
    process.exit(1);
  }

  let id;
  let contract = null;
  if ('--contract' in f) {
    let unit;
    ({ contract, unit } = loadContractUnit(f['--contract'], f['--unit']));
    if (boundRunId && contract.runId !== boundRunId) {
      console.error(`x contract runId '${contract.runId}' differs from the ledger's bound run '${boundRunId}'`);
      process.exit(1);
    }
    const fields = [
      ['role', f['--role'], unit.role],
      ['model', f['--model'], unit.model],
      ['brief', f['--brief'], unit.brief],
      ['artifact', f['--artifact'], unit.artifact],
    ];
    const mismatches = fields.filter(([, given, want]) => given !== want).map(([name]) => name);
    if (mismatches.length) {
      console.error(`x ${f['--unit']} ${mismatches.join(', ')} differ${mismatches.length === 1 ? 's' : ''} from the contract unit — dispatch the row exactly as contracted, or fix the contract`);
      process.exit(1);
    }
    id = unit.id;
    const dupRow = rows.some((r) => r.id === id);
    const dupJournal = priorJournal ? priorJournal.expected.has(id) : false;
    if (dupRow || dupJournal) {
      console.error(`x ${id} is already dispatched — retry via 'update --ledger ${f['--ledger']} --id ${id} --status redispatched'`);
      process.exit(1);
    }
    if (contract.version === 4) {
      if (!('--actor-id' in f)) {
        console.error('x --actor-id is required to dispatch against a version 4 contract — strict reconciliation (run-contract.mjs reconcile) rejects an activation with no actor, and the append-only journal cannot be corrected after the fact');
        process.exit(1);
      }
      if (text !== null) {
        if (priorJournal === null) {
          console.error(`x a version 4 binding must start on a fresh ledger — ${f['--ledger']} already exists with no dispatch journal`);
          process.exit(1);
        }
        const hasUnbound = priorJournal.events.some((e) => e.op === 'add' && !e.runId);
        if (hasUnbound) {
          console.error(`x a version 4 binding must start on a fresh ledger — ${f['--ledger']}'s dispatch journal already has unbound add events`);
          process.exit(1);
        }
      }
      const conflict = priorJournal ? actorBoundToOtherUnit(priorJournal.events, f['--actor-id'], id) : null;
      if (conflict) {
        console.error(`x --actor-id ${f['--actor-id']} is already bound to ${conflict} — an actor may not be reused across units`);
        process.exit(1);
      }
    }
  } else {
    id = nextId(rows);
  }

  const role = `${f['--role']}@${f['--model']}`;
  const row = `| ${id} | ${role} | ${f['--brief']} | ${f['--artifact']} | dispatched |\n`;
  const body = (text === null ? HEADER : (text.endsWith('\n') ? text : text + '\n')) + row;
  const recordedActorId = actorId(f['--actor-id']);
  const journalEntry = {
    op: 'add', id, status: 'dispatched',
    ...(recordedActorId ? { actorId: recordedActorId } : {}),
    ...(contract && contract.version === 4 ? { runId: contract.runId } : {}),
  };
  journalAppend(path, journalEntry, text === null);
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

// Report-file shape gate for `update --status reported --report <path> [--sections a,b]`.
// WHY (calibration lesson L-050): an operative with a write tool writes its own report file and
// returns only a pointer, so the lead no longer re-emits the body to persist it. The pointer is
// only as good as the file behind it: a missing, empty, or section-less file is the same failed
// dispatch a malformed inline report is, and it must not flip the row to the terminal `reported`.
// Returns a list of problems; an empty list means the file passed. Evidence quality stays the
// lead's judgment: this gate checks presence and structure, never whether a citation is true.
function reportShapeProblems(reportPath, sectionList) {
  const abs = resolve(reportPath);
  if (!existsSync(abs) || !statSync(abs).isFile()) return [`report file missing: ${reportPath}`];
  let text;
  try { text = readFileSync(abs, 'utf8'); }
  catch (e) { return [`report file unreadable: ${reportPath}: ${e.message}`]; }
  if (text.trim() === '') return [`report file empty: ${reportPath}`];
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  // Heading lines inside a fenced block (a shell comment, say) are body text, not structure.
  const headings = [];
  let fenced = false;
  lines.forEach((l, idx) => {
    if (/^\s*(```|~~~)/.test(l)) { fenced = !fenced; return; }
    if (fenced) return;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (m) headings.push({ level: m[1].length, title: m[2].toLowerCase(), idx });
  });
  const problems = [];
  for (const name of sectionList) {
    const want = name.toLowerCase();
    const h = headings.find((x) => x.title === want || x.title.startsWith(`${want} `) || x.title.startsWith(`${want}:`));
    if (!h) { problems.push(`report section missing: ${name}`); continue; }
    // A section's body runs to the next heading at the same or a higher level; subheadings belong
    // to it. A body that is only blank lines or subheading lines carries nothing.
    const end = headings.find((x) => x.idx > h.idx && x.level <= h.level)?.idx ?? lines.length;
    const nested = new Set(headings.map((x) => x.idx));
    const body = lines.slice(h.idx + 1, end).filter((l, i) => l.trim() !== '' && !nested.has(h.idx + 1 + i));
    if (!body.length) problems.push(`report section empty: ${name}`);
  }
  return problems;
}

function cmdUpdate(args) {
  const f = parseFlags(args, new Set(['--ledger', '--id', '--status', '--actor-id', '--report', '--sections']));
  for (const req of ['--ledger', '--id', '--status'])
    if (!(req in f)) { console.error(`x update needs ${req}`); usage(); }
  if (!STATUSES.includes(f['--status'])) {
    console.error(`x --status must be one of: ${STATUSES.join(', ')}`);
    process.exit(1);
  }
  if ('--report' in f && f['--status'] !== 'reported') {
    console.error('x --report applies only to --status reported');
    usage();
  }
  if ('--sections' in f && !('--report' in f)) {
    console.error('x --sections needs --report');
    usage();
  }
  const sectionList = '--sections' in f ? f['--sections'].split(',').map((s) => s.trim()).filter(Boolean) : [];
  if ('--sections' in f && !sectionList.length) {
    console.error('x --sections needs at least one section name');
    usage();
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
  // L-054: a redispatch on a journal bound to a version 4 contract run must name the new actor,
  // and must not silently rebind an actor already active on a different unit — the same rule
  // `add` enforces on the activating dispatch (see the header WHY paragraph).
  if (f['--status'] === 'redispatched') {
    const jPath = journalPathFor(path);
    const priorJournalText = existsSync(jPath) ? readFileSync(jPath, 'utf8') : null;
    const priorJournal = priorJournalText !== null ? replayDispatchJournal(priorJournalText) : null;
    const bound = priorJournal ? priorJournal.events.some((e) => e.op === 'add' && e.runId) : false;
    if (bound) {
      if (!('--actor-id' in f)) {
        console.error(`x ${f['--id']} redispatch on a bound journal requires --actor-id`);
        process.exit(1);
      }
      const conflict = actorBoundToOtherUnit(priorJournal.events, f['--actor-id'], f['--id']);
      if (conflict) {
        console.error(`x --actor-id ${f['--actor-id']} is already bound to ${conflict} — an actor may not be reused across units`);
        process.exit(1);
      }
    }
  }
  if ('--report' in f) {
    const problems = reportShapeProblems(f['--report'], sectionList);
    if (problems.length) {
      console.error(`x ${f['--id']} report fails the shape gate — the row stays '${target.status}'; mark it failed and redispatch:\n  ${problems.join('\n  ')}`);
      process.exit(1);
    }
  }
  const lines = text.split('\n');
  const original = lines[target.line - 1];
  const updated = original.replace(/\|\s*[^|]*\s*\|$/, `| ${f['--status']} |`);
  lines[target.line - 1] = updated;
  // `update` never creates a journal — only the command that creates the ledger may.
  const recordedActorId = actorId(f['--actor-id']);
  journalAppend(path, { op: 'update', id: f['--id'], to: f['--status'], ...(recordedActorId ? { actorId: recordedActorId } : {}) }, false);
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
    const { expected, violations } = replayDispatchJournal(jtext);
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
