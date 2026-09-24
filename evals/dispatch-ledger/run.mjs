#!/usr/bin/env node
// Regression eval for scripts/dispatch-ledger.mjs — pins the DISPATCH_LEDGER.md
// mechanization: `add` creates the header + a sequential D-NNN row (dispatched),
// requires --model and stamps it into the role cell as `role@model` (a calibration
// finding: without a recorded resolved model, a mid-run tier substitution is
// invisible), and rejects a brief over 10 words. `update` allows dispatched/
// redispatched -> any outcome and failed -> redispatched but rejects an unknown id
// or a change out of the terminal `reported` state. `check` validates row shape/id
// ordering/status values (fail-closed), reports dangling `dispatched` rows and
// unstamped (no `@model`) rows as advisories (exit 0) unless --strict promotes them
// to a failure, and still PARSES a legacy pre-stamp ledger (backward compat). `phase` appends
// a positional `> phase: <title> · lead@<model>` marker (recording which model LED each stretch
// of the run); `check` accepts markers, counts them as neither rows nor prose, and fails closed
// on a line starting `> phase:` that breaks the grammar.
//
// Journal leg (sections q-w): every write goes to an append-only `<ledger>.journal.jsonl`
// alongside the ledger, and `check` replays it against the rows — a row with no journaled `add`
// is a PHANTOM (the L-013 hazard: a schema-perfect row minted by a direct artifact edit, often
// straight at `reported`, is otherwise snapshot-indistinguishable from a real dispatch) and
// fails closed without --strict, as do an out-of-band status edit, a journaled row deleted from
// the ledger, and an unreadable journal line. A ledger with no journal is a pre-journal artifact:
// advisory only (exit 0), promoted by --strict, and `update` never mints a journal for one.
//
//   node evals/dispatch-ledger/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { tally, trimmed } from '../harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'dispatch-ledger.mjs');

const { fails, check } = tally(trimmed(200));

// Spawn the real script directly (never a shell string); capture status via the
// thrown error's .status on non-zero exit, per execFileSync semantics.
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
  const dir = mkdtempSync(join(tmpdir(), 'coh-dispatchledger-'));
  cleanupDirs.push(dir);
  const ledger = join(dir, 'DISPATCH_LEDGER.md');

  // a. add creates the header + first row (D-001, dispatched), stamped role@model.
  const a = run(['add', '--ledger', ledger, '--role', 'explorer', '--brief', 'map the auth module', '--artifact', 'AUTH_MAP.md', '--model', 'claude-sonnet-5']);
  check('a. add exits 0', a.status === 0, a.stderr);
  const textA = readFileSync(ledger, 'utf8');
  check('a. ledger has the header row', textA.includes('| id | role | brief | expected artifact | status |'), textA);
  check('a. first row is D-001 dispatched, stamped role@model', /\|\s*D-001\s*\|\s*explorer@claude-sonnet-5\s*\|\s*map the auth module\s*\|\s*AUTH_MAP\.md\s*\|\s*dispatched\s*\|/.test(textA), textA);

  // b. sequential ids: a second add appends D-002.
  const b = run(['add', '--ledger', ledger, '--role', 'mech', '--brief', 'rename the config field', '--artifact', 'diff', '--model', 'claude-haiku-5']);
  check('b. second add exits 0', b.status === 0, b.stderr);
  const textB = readFileSync(ledger, 'utf8');
  check('b. second row is D-002 stamped', /\|\s*D-002\s*\|\s*mech@claude-haiku-5\s*\|/.test(textB), textB);

  // c. over-10-word brief is rejected (exit 1), and no row is appended.
  const c = run(['add', '--ledger', ledger, '--role', 'reviewer', '--brief', 'one two three four five six seven eight nine ten eleven', '--artifact', 'x', '--model', 'claude-sonnet-5']);
  check('c. over-10-word brief exits 1', c.status === 1, c.stderr);
  const textC = readFileSync(ledger, 'utf8');
  check('c. no D-003 row was appended', !textC.includes('D-003'), textC);

  // c2. add without --model is rejected (exit 1) — the calibration-motivated required flag.
  const c2 = run(['add', '--ledger', ledger, '--role', 'reviewer', '--brief', 'review the diff', '--artifact', 'REVIEW.md']);
  check('c2. add without --model exits 1', c2.status === 1, c2.stderr);
  check('c2. rejection explains the calibration rationale', /tier|reconstruct/i.test(c2.stderr), c2.stderr);
  const textC2 = readFileSync(ledger, 'utf8');
  check('c2. no D-003 row was appended', !textC2.includes('D-003'), textC2);

  // d. update: valid transition dispatched -> reported.
  const d = run(['update', '--ledger', ledger, '--id', 'D-001', '--status', 'reported']);
  check('d. valid transition exits 0', d.status === 0, d.stderr);
  const textD = readFileSync(ledger, 'utf8');
  check('d. D-001 row now reported', /\|\s*D-001\s*\|[^\n]*\|\s*reported\s*\|/.test(textD), textD);

  // e. update: reported is terminal — a further change is rejected.
  const e = run(['update', '--ledger', ledger, '--id', 'D-001', '--status', 'failed']);
  check('e. change out of reported exits 1', e.status === 1, e.stderr);
  check('e. rejection mentions terminal', /terminal/.test(e.stderr), e.stderr);

  // f. update: dispatched -> failed -> redispatched is allowed.
  const f1 = run(['update', '--ledger', ledger, '--id', 'D-002', '--status', 'failed']);
  check('f. dispatched -> failed exits 0', f1.status === 0, f1.stderr);
  const f2 = run(['update', '--ledger', ledger, '--id', 'D-002', '--status', 'redispatched']);
  check('f. failed -> redispatched exits 0', f2.status === 0, f2.stderr);
  const f3 = run(['update', '--ledger', ledger, '--id', 'D-002', '--status', 'failed']);
  check('f. redispatched -> failed exits 0 (outcome reachable again)', f3.status === 0, f3.stderr);

  // g. update: unknown id is rejected.
  const g = run(['update', '--ledger', ledger, '--id', 'D-999', '--status', 'reported']);
  check('g. unknown id exits 1', g.status === 1, g.stderr);

  // h. check passes on a clean ledger (D-001 reported, D-002 failed — no dangling rows).
  const h = run(['check', '--ledger', ledger]);
  check('h. check exits 0 on a clean ledger', h.status === 0, h.stdout + h.stderr);
  check('h. check reports zero dangling dispatches', /0 dangling dispatch\(es\)/.test(h.stdout), h.stdout);
  check('h. check reports zero unstamped dispatches (both rows carry @model)', /0 unstamped dispatch\(es\)/.test(h.stdout), h.stdout);
  // The model half is machine-parsed, not just carried: check reads it back as counts, and
  // resolves each id to a canonical rung through scripts/model-tiers.mjs.
  // `claude-haiku-5` is deliberately NOT a pinned id in scripts/model-tiers.mjs: a real model
  // this repo has not placed on the ladder reads back as `unclassified`, never guessed onto a rung.
  check('h. check reports the per-model mix', /model mix: claude-haiku-5 1, claude-sonnet-5 1/.test(h.stdout), h.stdout);
  check('h. check reports the per-model-class mix in ladder order', /model-class mix: mid 1, unclassified 1/.test(h.stdout), h.stdout);

  // i. check flags a dangling `dispatched` row as an advisory (exit 0, not blocking).
  const ledgerDangling = join(dir, 'DANGLING_LEDGER.md');
  const di = run(['add', '--ledger', ledgerDangling, '--role', 'tracer', '--brief', 'trace the race condition', '--artifact', 'TRACE.md', '--model', 'claude-opus-5']);
  check('i. seed add exits 0', di.status === 0, di.stderr);
  const iResult = run(['check', '--ledger', ledgerDangling]);
  check('i. check on a dangling dispatched row still exits 0', iResult.status === 0, iResult.stdout + iResult.stderr);
  check('i. dangling row is reported as an advisory', /advisory: D-001 still 'dispatched'/.test(iResult.stdout), iResult.stdout);

  // j. --strict promotes the same dangling row to a failure (exit 1).
  const j = run(['check', '--ledger', ledgerDangling, '--strict']);
  check('j. --strict on a dangling row exits 1', j.status === 1, j.stdout + j.stderr);

  // k. a malformed row (wrong column count) fails check regardless of --strict.
  const malformed = join(dir, 'MALFORMED_LEDGER.md');
  writeFileSync(malformed, [
    '| id | role | brief | expected artifact | status |',
    '| --- | --- | --- | --- | --- |',
    '| D-001 | explorer | too few columns | dispatched |',
  ].join('\n') + '\n');
  const k = run(['check', '--ledger', malformed]);
  check('k. malformed row exits 1', k.status === 1, k.stdout + k.stderr);
  check('k. malformed row is reported', /MALFORMED/.test(k.stdout), k.stdout);

  // l. backward compat: a hand-written LEGACY ledger (rows generated by the pre-stamp
  // `add`, no @model in the role cell) must still PARSE cleanly under check — an old
  // run artifact must not become invalid just because the grammar grew a richer form.
  const legacy = join(dir, 'LEGACY_LEDGER.md');
  writeFileSync(legacy, [
    '| id | role | brief | expected artifact | status |',
    '| --- | --- | --- | --- | --- |',
    '| D-001 | explorer | map the legacy auth flow | AUTH_MAP.md | reported |',
    '| D-002 | mech | rename the legacy config field | diff | failed |',
  ].join('\n') + '\n');
  const l = run(['check', '--ledger', legacy]);
  check('l. legacy pre-stamp ledger still parses (exit 0)', l.status === 0, l.stdout + l.stderr);
  check('l. legacy rows are flagged unstamped (advisory)', /advisory: D-001 unstamped dispatch/.test(l.stdout) && /advisory: D-002 unstamped dispatch/.test(l.stdout), l.stdout);
  check('l. check reports 2 unstamped dispatches', /2 unstamped dispatch\(es\)/.test(l.stdout), l.stdout);
  check('l. a legacy ledger reads back as unstamped in both mix lines',
    /model mix: unstamped 2/.test(l.stdout) && /model-class mix: unstamped 2/.test(l.stdout), l.stdout);

  // l2. a row whose model half is EMPTY (`explorer@`) is unstamped too — the stamp is the
  // recorded model, not the '@' character, and a blank half proves nothing about the tier.
  const blankStamp = join(dir, 'BLANK_STAMP_LEDGER.md');
  writeFileSync(blankStamp, [
    '| id | role | brief | expected artifact | status |',
    '| --- | --- | --- | --- | --- |',
    '| D-001 | explorer@ | map the auth module | AUTH_MAP.md | reported |',
  ].join('\n') + '\n');
  const l2 = run(['check', '--ledger', blankStamp]);
  check('l2. a blank model half parses (exit 0)', l2.status === 0, l2.stdout + l2.stderr);
  check('l2. a blank model half counts as unstamped', /1 unstamped dispatch\(es\)/.test(l2.stdout), l2.stdout);
  check('l2. a blank model half is unstamped in the mix lines', /model-class mix: unstamped 1/.test(l2.stdout), l2.stdout);

  // m. --strict promotes an unstamped row to a failure (exit 1) — tier mix must be
  // reconstructable under strict enforcement.
  const m = run(['check', '--ledger', legacy, '--strict']);
  check('m. --strict on an unstamped ledger exits 1', m.status === 1, m.stdout + m.stderr);
  check('m. rejection mentions tier mix', /tier mix/i.test(m.stderr), m.stderr);

  // n. `phase` writes a positional lead-model marker, creating the ledger (header first) when
  // absent — the record of which model LED each stretch, which the per-row stamp can't show.
  const phased = join(dir, 'PHASED_LEDGER.md');
  const n1 = run(['phase', '--ledger', phased, '--title', 'Scan', '--lead-model', 'claude-fable-5-1']);
  check('n. phase on a new ledger exits 0', n1.status === 0, n1.stderr);
  const textN1 = readFileSync(phased, 'utf8');
  check('n. phase created the header', textN1.includes('| id | role | brief | expected artifact | status |'), textN1);
  check('n. marker line has the pinned grammar', /^> phase: Scan · lead@claude-fable-5-1$/m.test(textN1), textN1);
  const n2 = run(['add', '--ledger', phased, '--role', 'explorer', '--brief', 'map the auth module', '--artifact', 'AUTH_MAP.md', '--model', 'claude-sonnet-5']);
  check('n. add after a marker still exits 0 (markers are not rows)', n2.status === 0, n2.stderr);
  const n3 = run(['phase', '--ledger', phased, '--title', 'Fix wave', '--lead-model', 'claude-opus-5']);
  check('n. second phase marker exits 0', n3.status === 0, n3.stderr);
  const nCheck = run(['check', '--ledger', phased]);
  check('n. check accepts phase markers', nCheck.status === 0, nCheck.stdout + nCheck.stderr);
  check('n. check reports both markers', /phase: Scan · lead@claude-fable-5-1/.test(nCheck.stdout) && /phase: Fix wave · lead@claude-opus-5/.test(nCheck.stdout), nCheck.stdout);
  check('n. markers do not become rows', /\n1 row\(s\), 0 schema violation\(s\)/.test(nCheck.stdout), nCheck.stdout);

  // o. a line that announces itself as a marker but breaks the grammar fails CLOSED — a
  // mistyped marker must not be silently skipped as prose.
  const badPhase = join(dir, 'BAD_PHASE_LEDGER.md');
  writeFileSync(badPhase, [
    '| id | role | brief | expected artifact | status |',
    '| --- | --- | --- | --- | --- |',
    '> phase: broken marker',
    '| D-001 | explorer@claude-sonnet-5 | map the auth module | AUTH_MAP.md | reported |',
  ].join('\n') + '\n');
  const o = run(['check', '--ledger', badPhase]);
  check('o. malformed phase marker exits 1', o.status === 1, o.stdout + o.stderr);
  check('o. malformed marker is named', /MALFORMED\s+L3: malformed phase marker/.test(o.stdout), o.stdout);

  // p. marker validation: the title may not carry the marker's own delimiters, the model id may
  // not carry whitespace, and a missing flag is a usage error.
  const p1 = run(['phase', '--ledger', phased, '--title', 'a · b', '--lead-model', 'claude-opus-5']);
  check('p. title carrying the middot delimiter exits 1', p1.status === 1, p1.stderr);
  const p2 = run(['phase', '--ledger', phased, '--title', 'a | b', '--lead-model', 'claude-opus-5']);
  check('p. title carrying a pipe exits 1', p2.status === 1, p2.stderr);
  const p3 = run(['phase', '--ledger', phased, '--title', 'Review']);
  check('p. missing --lead-model exits 2 (usage)', p3.status === 2, p3.stderr);

  // Seeds a fresh journaled ledger (two adds, one of them carried to `reported`) for the
  // phantom/out-of-band/missing-row cases, which each corrupt their own copy.
  const seedJournaled = (name) => {
    const led = join(dir, name);
    run(['add', '--ledger', led, '--role', 'explorer', '--brief', 'map the payment lane', '--artifact', 'MAP.md', '--model', 'claude-sonnet-5']);
    run(['add', '--ledger', led, '--role', 'reviewer', '--brief', 'review the payment diff', '--artifact', 'REVIEW.md', '--model', 'claude-opus-5']);
    run(['update', '--ledger', led, '--id', 'D-001', '--status', 'reported']);
    return led;
  };

  // q. `add` on a fresh ledger journals its own write; check replays it clean.
  const journaled = seedJournaled('JOURNALED_LEDGER.md');
  check('q. add created the write journal', existsSync(journaled + '.journal.jsonl'), journaled);
  const qJournal = readFileSync(journaled + '.journal.jsonl', 'utf8');
  check('q. journal records the add entries', /\{"op":"add","id":"D-001","status":"dispatched"\}/.test(qJournal) && /\{"op":"add","id":"D-002","status":"dispatched"\}/.test(qJournal), qJournal);
  check('q. journal records the update entry', /\{"op":"update","id":"D-001","to":"reported"\}/.test(qJournal), qJournal);
  const q = run(['check', '--ledger', journaled]);
  check('q. check exits 0 on a journaled ledger', q.status === 0, q.stdout + q.stderr);
  check('q. check reports the journal as verified', /journal: verified\./.test(q.stdout), q.stdout);

  const actorLedger = join(dir, 'ACTOR_LEDGER.md');
  const qa1 = run(['add', '--ledger', actorLedger, '--role', 'explorer', '--brief', 'map actor provenance', '--artifact', 'ACTOR.md', '--model', 'claude-sonnet-5', '--actor-id', 'session-123/agent-7']);
  check('q. actor-aware add exits 0', qa1.status === 0, qa1.stderr);
  const qaJournal = readFileSync(actorLedger + '.journal.jsonl', 'utf8');
  check('q. actor-aware add journals the opaque host actor id', /"actorId":"session-123\/agent-7"/.test(qaJournal), qaJournal);
  const qa2 = run(['add', '--ledger', join(dir, 'BAD_ACTOR_LEDGER.md'), '--role', 'explorer', '--brief', 'map actor provenance', '--artifact', 'ACTOR.md', '--model', 'claude-sonnet-5', '--actor-id', 'two actors']);
  check('q. whitespace-bearing actor id is rejected', qa2.status === 1, qa2.stderr);
  const actorMismatch = join(dir, 'ACTOR_MISMATCH_LEDGER.md');
  run(['add', '--ledger', actorMismatch, '--role', 'explorer', '--brief', 'map actor provenance', '--artifact', 'ACTOR.md', '--model', 'claude-sonnet-5', '--actor-id', 'agent-a']);
  const mismatchBefore = readFileSync(actorMismatch + '.journal.jsonl', 'utf8');
  const qa3 = run(['update', '--ledger', actorMismatch, '--id', 'D-001', '--status', 'reported', '--actor-id', 'agent-b']);
  check('q. outcome actor must match the active dispatch', qa3.status === 1 && /differs from its active dispatch/.test(qa3.stderr), qa3.stderr);
  check('q. rejected actor mismatch leaves journal unchanged', readFileSync(actorMismatch + '.journal.jsonl', 'utf8') === mismatchBefore, readFileSync(actorMismatch + '.journal.jsonl', 'utf8'));
  const retryLedger = join(dir, 'ACTOR_RETRY_LEDGER.md');
  run(['add', '--ledger', retryLedger, '--role', 'explorer', '--brief', 'map retry provenance', '--artifact', 'RETRY.md', '--model', 'claude-sonnet-5', '--actor-id', 'agent-a']);
  run(['update', '--ledger', retryLedger, '--id', 'D-001', '--status', 'failed', '--actor-id', 'agent-a']);
  const qa4 = run(['update', '--ledger', retryLedger, '--id', 'D-001', '--status', 'redispatched', '--actor-id', 'agent-b']);
  const qa5 = run(['update', '--ledger', retryLedger, '--id', 'D-001', '--status', 'reported', '--actor-id', 'agent-b']);
  check('q. redispatch may bind a new actor and preserves continuity', qa4.status === 0 && qa5.status === 0, qa4.stderr + qa5.stderr);
  const identityText = [
    join(REPO, 'scripts', 'dispatch-ledger.mjs'),
    join(REPO, 'scripts', 'run-contract.mjs'),
    join(REPO, 'plugins', 'code-ops-suite', 'skills', 'security-privacy-audit', 'SKILL.md'),
  ].map((file) => readFileSync(file, 'utf8')).join('\n');
  check('q. actorId is not described as proof of actual identity', !/actorId[\s\S]{0,100}prov(?:e|es|en) actual actor identity/i.test(identityText), identityText.match(/actorId[\s\S]{0,140}/i)?.[0]);

  // q2. premium specialists remain explicit and cost-visible instead of silently
  // collapsing into an ordinary default rung.
  const astraLedger = join(dir, 'ASTRA_LEDGER.md');
  run(['add', '--ledger', astraLedger, '--role', 'reviewer', '--brief', 'refute the hard architecture claim', '--artifact', 'ASTRA_REVIEW.md', '--model', 'gpt-6-astra']);
  run(['update', '--ledger', astraLedger, '--id', 'D-001', '--status', 'reported']);
  const q2 = run(['check', '--ledger', astraLedger]);
  check('q2. Astra ledger exits 0', q2.status === 0, q2.stdout + q2.stderr);
  check('q2. Astra is reported as frontier cost', /model-class mix: frontier 1/.test(q2.stdout), q2.stdout);

  // r. THE L-013 REGRESSION CASE: a schema-perfect row minted straight at `reported` by a direct
  // artifact edit — no dispatch call behind it. Snapshot-indistinguishable from a real dispatch;
  // only the journal can tell them apart, and it must fail closed WITHOUT --strict.
  const phantomLedger = seedJournaled('PHANTOM_LEDGER.md');
  writeFileSync(phantomLedger, readFileSync(phantomLedger, 'utf8')
    + '| D-003 | reviewer@claude-opus-5 | audit the payment lane | AUDIT.md | reported |\n');
  const r = run(['check', '--ledger', phantomLedger]);
  check('r. phantom row exits 1 without --strict', r.status === 1, r.stdout + r.stderr);
  check('r. phantom row is named as PHANTOM', /!! PHANTOM\s+D-003/.test(r.stdout), r.stdout);
  check('r. phantom message says no recorded dispatch call', /no recorded dispatch call/.test(r.stdout), r.stdout);

  // s. an out-of-band status edit: the row's status cell is hand-rewritten dispatched ->
  // reported without an `update` call, so the journal replays to a different status.
  const oobLedger = seedJournaled('OOB_LEDGER.md');
  writeFileSync(oobLedger, readFileSync(oobLedger, 'utf8')
    .replace('| D-002 | reviewer@claude-opus-5 | review the payment diff | REVIEW.md | dispatched |',
      '| D-002 | reviewer@claude-opus-5 | review the payment diff | REVIEW.md | reported |'));
  const s = run(['check', '--ledger', oobLedger]);
  check('s. out-of-band status edit exits 1', s.status === 1, s.stdout + s.stderr);
  check('s. out-of-band row is named', /!! OUT-OF-BAND\s+D-002/.test(s.stdout), s.stdout);

  // t. a journaled row deleted from the ledger — the write happened, the record is gone.
  const missingLedger = seedJournaled('MISSING_LEDGER.md');
  writeFileSync(missingLedger, readFileSync(missingLedger, 'utf8')
    .split('\n').filter((ln) => !ln.startsWith('| D-002 ')).join('\n'));
  const t = run(['check', '--ledger', missingLedger]);
  check('t. deleted journaled row exits 1', t.status === 1, t.stdout + t.stderr);
  check('t. missing row is named', /!! MISSING-ROW\s+D-002/.test(t.stdout), t.stdout);

  // u. backward compat: a hand-written pre-journal ledger has no journal at all. That is an
  // ADVISORY (exit 0) — phantom rows are simply undetectable there — promoted by --strict.
  const u = run(['check', '--ledger', legacy]);
  check('u. unjournaled legacy ledger still exits 0', u.status === 0, u.stdout + u.stderr);
  check('u. unjournaled ledger is reported as an advisory', /advisory: unjournaled ledger/.test(u.stdout), u.stdout);
  check('u. summary reports the journal as absent', /journal: absent\./.test(u.stdout), u.stdout);
  const u2 = run(['check', '--ledger', legacy, '--strict']);
  check('u. --strict on an unjournaled ledger exits 1', u2.status === 1, u2.stdout + u2.stderr);

  // v. `update` must never MINT a journal for a pre-journal ledger: doing so would make every
  // row already in that file a false phantom on the next check.
  const v1 = run(['update', '--ledger', legacy, '--id', 'D-002', '--status', 'redispatched']);
  check('v. update on an unjournaled legacy ledger exits 0', v1.status === 0, v1.stderr);
  check('v. update did not create a journal', !existsSync(legacy + '.journal.jsonl'), legacy);
  const v2 = run(['check', '--ledger', legacy]);
  check('v. check stays advisory-only after the update (exit 0)', v2.status === 0, v2.stdout + v2.stderr);

  // w. an unreadable journal line fails CLOSED — a journal that cannot be replayed cannot prove
  // anything about the rows it is supposed to vouch for.
  const badJournal = seedJournaled('BAD_JOURNAL_LEDGER.md');
  writeFileSync(badJournal + '.journal.jsonl',
    readFileSync(badJournal + '.journal.jsonl', 'utf8') + 'not json\n');
  const w = run(['check', '--ledger', badJournal]);
  check('w. malformed journal line exits 1', w.status === 1, w.stdout + w.stderr);
  check('w. malformed journal line is named with its line number', /!! JOURNAL\s+J4: unparseable journal line/.test(w.stdout), w.stdout);
  const illegalLedger = seedJournaled('ILLEGAL_TRANSITION_LEDGER.md');
  run(['update', '--ledger', illegalLedger, '--id', 'D-002', '--status', 'reported']);
  writeFileSync(illegalLedger + '.journal.jsonl', readFileSync(illegalLedger + '.journal.jsonl', 'utf8')
    + '{"op":"update","id":"D-002","to":"redispatched","actorId":"agent-c"}\n');
  const x = run(['check', '--ledger', illegalLedger]);
  check('x. replay rejects a transition out of reported', x.status === 1 && /invalid transition reported -> redispatched/.test(x.stdout), x.stdout + x.stderr);

  // y. L-050 report-file shape gate: an operative that wrote its own report returns a pointer, and
  // `update --status reported --report <path>` gates that file before the row turns terminal. A
  // missing, empty, or section-less file is a failed dispatch exactly like a malformed inline
  // report: exit 1, and neither the row nor the journal changes.
  const reportLedger = join(dir, 'REPORT_LEDGER.md');
  for (let i = 0; i < 6; i++)
    run(['add', '--ledger', reportLedger, '--role', 'reviewer', '--brief', `review slice ${i + 1}`, '--artifact', `reports/D-00${i + 1}.md`, '--model', 'claude-opus-5']);
  const good = join(dir, 'GOOD_REPORT.md');
  writeFileSync(good, '# Report D-001\n\n## Verdict\n\nPASS: no blocking findings.\n\n## Evidence\n\n### Commands\n\n```\n# not a heading\nnode check.mjs  (exit 0)\n```\n\n- src/a.mjs:12 guard present\n');
  const ya = run(['update', '--ledger', reportLedger, '--id', 'D-001', '--status', 'reported', '--report', good, '--sections', 'Verdict,Evidence']);
  check('y. a well-formed report file passes the gate (exit 0)', ya.status === 0, ya.stderr);
  check('y. passing report marks the row reported', /\|\s*D-001\s*\|[^\n]*\|\s*reported\s*\|/.test(readFileSync(reportLedger, 'utf8')), readFileSync(reportLedger, 'utf8'));
  const yb = run(['update', '--ledger', reportLedger, '--id', 'D-002', '--status', 'reported', '--report', good]);
  check('y. --report without --sections checks presence only (exit 0)', yb.status === 0, yb.stderr);

  const ledgerBefore = readFileSync(reportLedger, 'utf8');
  const journalBefore = readFileSync(reportLedger + '.journal.jsonl', 'utf8');
  const unchanged = () => readFileSync(reportLedger, 'utf8') === ledgerBefore
    && readFileSync(reportLedger + '.journal.jsonl', 'utf8') === journalBefore;
  const yc = run(['update', '--ledger', reportLedger, '--id', 'D-003', '--status', 'reported', '--report', join(dir, 'NO_SUCH_REPORT.md')]);
  check('y. a missing report file exits 1', yc.status === 1 && /report file missing/.test(yc.stderr), yc.stderr);
  check('y. a missing report file leaves the ledger and journal unchanged', unchanged());
  const emptyReport = join(dir, 'EMPTY_REPORT.md');
  writeFileSync(emptyReport, '  \n\n');
  const yd = run(['update', '--ledger', reportLedger, '--id', 'D-003', '--status', 'reported', '--report', emptyReport]);
  check('y. a whitespace-only report file exits 1', yd.status === 1 && /report file empty/.test(yd.stderr), yd.stderr);
  const noSection = join(dir, 'NO_SECTION_REPORT.md');
  writeFileSync(noSection, '## Verdict\n\nPASS\n');
  const ye = run(['update', '--ledger', reportLedger, '--id', 'D-004', '--status', 'reported', '--report', noSection, '--sections', 'Verdict,Evidence']);
  check('y. a report missing a required section exits 1', ye.status === 1 && /report section missing: Evidence/.test(ye.stderr), ye.stderr);
  const hollow = join(dir, 'HOLLOW_REPORT.md');
  writeFileSync(hollow, '## Verdict\n\nPASS\n\n## Evidence\n\n### Commands\n\n## Skipped\n\nnone\n');
  const yf = run(['update', '--ledger', reportLedger, '--id', 'D-005', '--status', 'reported', '--report', hollow, '--sections', 'Verdict,Evidence']);
  check('y. a section holding only subheadings counts as empty (exit 1)', yf.status === 1 && /report section empty: Evidence/.test(yf.stderr), yf.stderr);
  const fencedOnly = join(dir, 'FENCED_REPORT.md');
  writeFileSync(fencedOnly, '## Verdict\n\nPASS\n\n```\n## Evidence\nnot a real section\n```\n');
  const yg = run(['update', '--ledger', reportLedger, '--id', 'D-006', '--status', 'reported', '--report', fencedOnly, '--sections', 'Evidence']);
  check('y. a heading inside a code fence does not satisfy a section (exit 1)', yg.status === 1 && /report section missing: Evidence/.test(yg.stderr), yg.stderr);
  check('y. every rejected report left the ledger and journal unchanged', unchanged());
  const yh = run(['update', '--ledger', reportLedger, '--id', 'D-003', '--status', 'failed', '--report', good]);
  check('y. --report on a non-reported status is a usage error (exit 2)', yh.status === 2, yh.stderr);
  const yi = run(['update', '--ledger', reportLedger, '--id', 'D-003', '--status', 'reported', '--sections', 'Verdict']);
  check('y. --sections without --report is a usage error (exit 2)', yi.status === 2, yi.stderr);
  const yj = run(['check', '--ledger', reportLedger]);
  check('y. the ledger still checks clean after the rejections', yj.status === 0 && /journal: verified\./.test(yj.stdout), yj.stdout + yj.stderr);

  // ---- z. L-053/L-054: `add --contract <path> --unit <D-NNN>` keys the row by the contract's
  // unit id (never nextId), checks the row against the unit exactly, and — for a version 4
  // contract — requires and binds an actor. A minimal fixture (version, runId, units[{id, role,
  // model, brief, artifact}]) is all `add` reads; run-contract.mjs owns full contract validation.
  const writeContract = (name, overrides = {}) => {
    const p = join(dir, name);
    const contract = {
      version: 4,
      runId: 'calib-run-1',
      units: [
        { id: 'D-001', role: 'explorer', model: 'claude-sonnet-5', brief: 'map the payment lane', artifact: 'MAP.md' },
        { id: 'D-002', role: 'reviewer', model: 'claude-opus-5', brief: 'review the payment diff', artifact: 'REVIEW.md' },
      ],
      ...overrides,
    };
    writeFileSync(p, JSON.stringify(contract, null, 2));
    return p;
  };
  const contractPath = writeContract('contract.json');

  // z1. dispatching D-002 before D-001 keys the row D-002 — the id comes from the contract unit,
  // never the ledger's own nextId sequence.
  const contractLedger = join(dir, 'CONTRACT_LEDGER.md');
  const z1 = run(['add', '--ledger', contractLedger, '--role', 'reviewer', '--brief', 'review the payment diff', '--artifact', 'REVIEW.md', '--model', 'claude-opus-5', '--contract', contractPath, '--unit', 'D-002', '--actor-id', 'agent-a']);
  check('z1. contract add for D-002 exits 0 though dispatched first', z1.status === 0, z1.stderr);
  const textZ1 = readFileSync(contractLedger, 'utf8');
  check('z1. row is keyed D-002, not a sequential D-001', /\|\s*D-002\s*\|\s*reviewer@claude-opus-5\s*\|/.test(textZ1), textZ1);
  check('z1. no D-001 row was minted', !textZ1.includes('D-001'), textZ1);

  // z2. a field that does not match the contract unit is refused, naming the differing field.
  const mismatchLedger = join(dir, 'CONTRACT_MISMATCH_LEDGER.md');
  const z2 = run(['add', '--ledger', mismatchLedger, '--role', 'explorer', '--brief', 'map the wrong lane', '--artifact', 'MAP.md', '--model', 'claude-sonnet-5', '--contract', contractPath, '--unit', 'D-001', '--actor-id', 'agent-b']);
  check('z2. a brief mismatch vs the contract unit exits 1', z2.status === 1 && /brief/.test(z2.stderr) && /differ/.test(z2.stderr), z2.stderr);
  check('z2. no ledger was created on refusal', !existsSync(mismatchLedger));

  // z3. an unknown unit id is refused.
  const unknownLedger = join(dir, 'CONTRACT_UNKNOWN_LEDGER.md');
  const z3 = run(['add', '--ledger', unknownLedger, '--role', 'explorer', '--brief', 'map the payment lane', '--artifact', 'MAP.md', '--model', 'claude-sonnet-5', '--contract', contractPath, '--unit', 'D-999', '--actor-id', 'agent-c']);
  check('z3. an unknown contract unit exits 1', z3.status === 1 && /D-999/.test(z3.stderr), z3.stderr);
  check('z3. no ledger was created on refusal', !existsSync(unknownLedger));

  // z4. version 4 dispatch without --actor-id is refused.
  const noActorLedger = join(dir, 'CONTRACT_NOACTOR_LEDGER.md');
  const z4 = run(['add', '--ledger', noActorLedger, '--role', 'explorer', '--brief', 'map the payment lane', '--artifact', 'MAP.md', '--model', 'claude-sonnet-5', '--contract', contractPath, '--unit', 'D-001']);
  check('z4. a version 4 contract add without --actor-id exits 1', z4.status === 1 && /actor/i.test(z4.stderr), z4.stderr);
  check('z4. no ledger was created on refusal', !existsSync(noActorLedger));

  // z5. an actor already bound to a different unit is refused — caught at append time, not only
  // at finalization (the L-054 hazard).
  const reuseLedger = join(dir, 'CONTRACT_REUSE_LEDGER.md');
  const z5seed = run(['add', '--ledger', reuseLedger, '--role', 'explorer', '--brief', 'map the payment lane', '--artifact', 'MAP.md', '--model', 'claude-sonnet-5', '--contract', contractPath, '--unit', 'D-001', '--actor-id', 'agent-x']);
  check('z5. seed contract add exits 0', z5seed.status === 0, z5seed.stderr);
  const reuseLedgerBefore = readFileSync(reuseLedger, 'utf8');
  const reuseJournalBefore = readFileSync(reuseLedger + '.journal.jsonl', 'utf8');
  const z5 = run(['add', '--ledger', reuseLedger, '--role', 'reviewer', '--brief', 'review the payment diff', '--artifact', 'REVIEW.md', '--model', 'claude-opus-5', '--contract', contractPath, '--unit', 'D-002', '--actor-id', 'agent-x']);
  check('z5. reusing the same actor across units exits 1', z5.status === 1 && /agent-x/.test(z5.stderr) && /D-001/.test(z5.stderr), z5.stderr);
  check('z5. ledger unchanged after the actor-reuse refusal', readFileSync(reuseLedger, 'utf8') === reuseLedgerBefore);
  check('z5. journal unchanged after the actor-reuse refusal', readFileSync(reuseLedger + '.journal.jsonl', 'utf8') === reuseJournalBefore);

  // z6. redispatching on a bound journal without --actor-id is refused.
  const z6seed = run(['update', '--ledger', reuseLedger, '--id', 'D-001', '--status', 'failed', '--actor-id', 'agent-x']);
  check('z6. seed failed transition exits 0', z6seed.status === 0, z6seed.stderr);
  const z6Before = readFileSync(reuseLedger, 'utf8');
  const z6JournalBefore = readFileSync(reuseLedger + '.journal.jsonl', 'utf8');
  const z6 = run(['update', '--ledger', reuseLedger, '--id', 'D-001', '--status', 'redispatched']);
  check('z6. redispatch on a bound journal without --actor-id exits 1', z6.status === 1 && /actor/i.test(z6.stderr), z6.stderr);
  check('z6. ledger unchanged after the missing-actor refusal', readFileSync(reuseLedger, 'utf8') === z6Before);
  check('z6. journal unchanged after the missing-actor refusal', readFileSync(reuseLedger + '.journal.jsonl', 'utf8') === z6JournalBefore);

  // z7. an unbound `add` (no --contract) on a ledger already bound to a contract run is refused.
  const z7Before = readFileSync(reuseLedger, 'utf8');
  const z7JournalBefore = readFileSync(reuseLedger + '.journal.jsonl', 'utf8');
  const z7 = run(['add', '--ledger', reuseLedger, '--role', 'mech', '--brief', 'patch the payment retry', '--artifact', 'PATCH.diff', '--model', 'claude-haiku-5']);
  check('z7. an unbound add on a bound ledger exits 1', z7.status === 1 && /calib-run-1/.test(z7.stderr), z7.stderr);
  check('z7. ledger unchanged after the stickiness refusal', readFileSync(reuseLedger, 'utf8') === z7Before);
  check('z7. journal unchanged after the stickiness refusal', readFileSync(reuseLedger + '.journal.jsonl', 'utf8') === z7JournalBefore);

  // z8. `add --contract` naming a different runId than the ledger is already bound to is refused.
  const otherContractPath = writeContract('other-contract.json', { runId: 'other-run-9' });
  const z8Before = readFileSync(reuseLedger, 'utf8');
  const z8JournalBefore = readFileSync(reuseLedger + '.journal.jsonl', 'utf8');
  const z8 = run(['add', '--ledger', reuseLedger, '--role', 'reviewer', '--brief', 'review the payment diff', '--artifact', 'REVIEW.md', '--model', 'claude-opus-5', '--contract', otherContractPath, '--unit', 'D-002', '--actor-id', 'agent-y']);
  check('z8. a contract with a different runId exits 1', z8.status === 1 && /other-run-9/.test(z8.stderr) && /calib-run-1/.test(z8.stderr), z8.stderr);
  check('z8. ledger unchanged after the runId-mismatch refusal', readFileSync(reuseLedger, 'utf8') === z8Before);
  check('z8. journal unchanged after the runId-mismatch refusal', readFileSync(reuseLedger + '.journal.jsonl', 'utf8') === z8JournalBefore);

  // z9. a version 4 `--contract` add must start a binding on a fresh ledger — refused against an
  // existing ledger written by unbound (non-contract) adds.
  const preExisting = join(dir, 'PRE_EXISTING_LEDGER.md');
  const z9seed = run(['add', '--ledger', preExisting, '--role', 'explorer', '--brief', 'map something else', '--artifact', 'X.md', '--model', 'claude-sonnet-5']);
  check('z9. seed unbound add exits 0', z9seed.status === 0, z9seed.stderr);
  const z9Before = readFileSync(preExisting, 'utf8');
  const z9JournalBefore = readFileSync(preExisting + '.journal.jsonl', 'utf8');
  const z9 = run(['add', '--ledger', preExisting, '--role', 'reviewer', '--brief', 'review the payment diff', '--artifact', 'REVIEW.md', '--model', 'claude-opus-5', '--contract', contractPath, '--unit', 'D-002', '--actor-id', 'agent-z']);
  check('z9. a version 4 contract add on an existing unbound ledger exits 1', z9.status === 1 && /fresh ledger/.test(z9.stderr), z9.stderr);
  check('z9. ledger unchanged after the freshness refusal', readFileSync(preExisting, 'utf8') === z9Before);
  check('z9. journal unchanged after the freshness refusal', readFileSync(preExisting + '.journal.jsonl', 'utf8') === z9JournalBefore);

  // z10. --unit without --contract, and --contract without --unit, are usage errors (exit 2).
  const usageLedgerA = join(dir, 'USAGE_LEDGER_A.md');
  const z10a = run(['add', '--ledger', usageLedgerA, '--role', 'explorer', '--brief', 'map the payment lane', '--artifact', 'MAP.md', '--model', 'claude-sonnet-5', '--unit', 'D-001']);
  check('z10. --unit without --contract exits 2', z10a.status === 2, z10a.stderr);
  check('z10. no ledger was created', !existsSync(usageLedgerA));
  const usageLedgerB = join(dir, 'USAGE_LEDGER_B.md');
  const z10b = run(['add', '--ledger', usageLedgerB, '--role', 'explorer', '--brief', 'map the payment lane', '--artifact', 'MAP.md', '--model', 'claude-sonnet-5', '--contract', contractPath]);
  check('z10. --contract without --unit exits 2', z10b.status === 2, z10b.stderr);
  check('z10. no ledger was created', !existsSync(usageLedgerB));

  // z11. `check` reports a violation for a hand-written journal mixing bound and unbound adds —
  // the runId-bound/unbound consistency rule lives in ledger-grammar.mjs's replayDispatchJournal,
  // shared by every consumer.
  const mixedLedger = join(dir, 'MIXED_JOURNAL_LEDGER.md');
  writeFileSync(mixedLedger, [
    '| id | role | brief | expected artifact | status |',
    '| --- | --- | --- | --- | --- |',
    '| D-001 | explorer@claude-sonnet-5 | map the payment lane | MAP.md | dispatched |',
    '| D-002 | reviewer@claude-opus-5 | review the payment diff | REVIEW.md | dispatched |',
  ].join('\n') + '\n');
  writeFileSync(mixedLedger + '.journal.jsonl', [
    JSON.stringify({ op: 'add', id: 'D-001', status: 'dispatched', actorId: 'agent-a', runId: 'calib-run-1' }),
    JSON.stringify({ op: 'add', id: 'D-002', status: 'dispatched' }),
  ].join('\n') + '\n');
  const z11 = run(['check', '--ledger', mixedLedger]);
  check('z11. check flags a journal mixing bound and unbound adds', z11.status === 1 && /mixes/.test(z11.stdout + z11.stderr), z11.stdout + z11.stderr);

  // z12. a bound ledger passes `check --strict` once every row reports.
  const strictBound = join(dir, 'STRICT_BOUND_LEDGER.md');
  const z12a = run(['add', '--ledger', strictBound, '--role', 'explorer', '--brief', 'map the payment lane', '--artifact', 'MAP.md', '--model', 'claude-sonnet-5', '--contract', contractPath, '--unit', 'D-001', '--actor-id', 'agent-p']);
  const z12b = run(['add', '--ledger', strictBound, '--role', 'reviewer', '--brief', 'review the payment diff', '--artifact', 'REVIEW.md', '--model', 'claude-opus-5', '--contract', contractPath, '--unit', 'D-002', '--actor-id', 'agent-q']);
  check('z12. both contract adds exit 0', z12a.status === 0 && z12b.status === 0, z12a.stderr + z12b.stderr);
  run(['update', '--ledger', strictBound, '--id', 'D-001', '--status', 'reported']);
  run(['update', '--ledger', strictBound, '--id', 'D-002', '--status', 'reported']);
  const z12 = run(['check', '--ledger', strictBound, '--strict']);
  check('z12. a bound ledger passes check --strict once all rows report', z12.status === 0, z12.stdout + z12.stderr);
} finally {
  for (const d of cleanupDirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} dispatch-ledger regression check(s) failed:`);
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('\nOK — all dispatch-ledger regression checks passed.');
