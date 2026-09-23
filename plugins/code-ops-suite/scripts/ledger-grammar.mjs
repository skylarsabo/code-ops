// @ts-check
// Data-only source of truth for grammar (a) of code-ops-docs/40 Engineering/Techniques/artifact-grammars.md — the
// DISPATCH_LEDGER.md table row.
//
// WHY: the row shape had three character-identical copies (dispatch-ledger.mjs, which writes
// it; calibration-metrics.mjs and estimate-run-cost.mjs, which read it) and nothing pinned
// them to one another. Each reader treats a non-matching row as `malformed`, so an edit to one
// copy would not crash the others — it would quietly undercount dispatches in whichever tool
// still carried the old shape, and undercounted dispatches are exactly the number the cost
// machinery exists to report. One module removes the drift instead of policing it.
//
// The writer could not serve as the SSOT: scripts/dispatch-ledger.mjs dispatches on argv at
// module load, so importing it runs its CLI. This module has no side effects, which lets every
// ledger consumer share the grammar and journal replay without invoking the writer.
//
// Three consumers:
//   - scripts/dispatch-ledger.mjs    — writes and validates rows.
//   - scripts/calibration-metrics.mjs — scores a finished run's ledger.
//   - scripts/estimate-run-cost.mjs   — estimates the next run from prior ledgers.
//
// The phase marker (`> phase: <title> · lead@<model>`) is deliberately NOT here: the writer
// and the readers hold intentionally different tolerances for its whitespace, and collapsing
// them would be a behavior change rather than a dedupe.

// `| id | role | brief | expected artifact | status |`, capture groups in column order.
export const LEDGER_ROW_RE = /^\|\s*(D-\d+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/;

// The closed set of values the status column may carry.
export const LEDGER_STATUSES = ['dispatched', 'reported', 'failed', 'redispatched'];

// The table header a ledger opens with, written by dispatch-ledger.mjs.
export const LEDGER_HEADER = '| id | role | brief | expected artifact | status |\n'
  + '| --- | --- | --- | --- | --- |\n';

/** @param {string} text */
export function replayDispatchJournal(text) {
  const expected = new Map();
  const activeActor = new Map();
  const violations = [];
  /** @type {any[]} */
  const events = [];
  /** @type {(from: string, to: string) => boolean} */
  const transitionAllowed = (from, to) => {
    if (from === 'reported') return false;
    if (from === 'failed') return to === 'redispatched';
    return ['reported', 'failed', 'redispatched'].includes(to);
  };
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) return;
    const at = `J${index + 1}`;
    let entry;
    try { entry = JSON.parse(line); } catch { violations.push(`${at}: unparseable journal line: ${line.slice(0, 100)}`); return; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { violations.push(`${at}: journal entry is not an object: ${line.slice(0, 100)}`); return; }
    if (entry.op === 'phase') {
      if (typeof entry.title !== 'string' || !entry.title) violations.push(`${at}: phase entry needs a non-empty title: ${line.slice(0, 100)}`);
      else events.push(entry);
      return;
    }
    if (entry.op === 'add') {
      if (typeof entry.id !== 'string' || !/^D-\d+$/.test(entry.id) || entry.status !== 'dispatched') { violations.push(`${at}: malformed add entry: ${line.slice(0, 100)}`); return; }
      if ('actorId' in entry && (typeof entry.actorId !== 'string' || !/^\S{1,200}$/u.test(entry.actorId))) { violations.push(`${at}: malformed add actorId: ${line.slice(0, 100)}`); return; }
      // `runId` marks the add as bound to a version 4 contract run (dispatch-ledger.mjs `add
      // --contract`, calibration lessons L-053/L-054); optional, kebab-case like the contract's
      // own runId when present.
      if ('runId' in entry && (typeof entry.runId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.runId))) { violations.push(`${at}: malformed add runId: ${line.slice(0, 100)}`); return; }
      if (expected.has(entry.id)) { violations.push(`${at}: duplicate add for ${entry.id}`); return; }
      expected.set(entry.id, entry.status);
      activeActor.set(entry.id, entry.actorId || null);
      events.push(entry); return;
    }
    if (entry.op === 'update') {
      if (typeof entry.id !== 'string' || !/^D-\d+$/.test(entry.id) || !LEDGER_STATUSES.includes(entry.to)) { violations.push(`${at}: malformed update entry: ${line.slice(0, 100)}`); return; }
      if ('actorId' in entry && (typeof entry.actorId !== 'string' || !/^\S{1,200}$/u.test(entry.actorId))) { violations.push(`${at}: malformed update actorId: ${line.slice(0, 100)}`); return; }
      if (!expected.has(entry.id)) { violations.push(`${at}: update for ${entry.id}, which was never added`); return; }
      const from = expected.get(entry.id);
      if (!transitionAllowed(from, entry.to)) { violations.push(`${at}: invalid transition ${from} -> ${entry.to} for ${entry.id}`); return; }
      if (entry.to === 'redispatched') activeActor.set(entry.id, entry.actorId || null);
      else if (entry.actorId && activeActor.get(entry.id) && entry.actorId !== activeActor.get(entry.id)) {
        violations.push(`${at}: outcome actorId for ${entry.id} differs from its active dispatch`); return;
      }
      expected.set(entry.id, entry.to); events.push(entry); return;
    }
    violations.push(`${at}: unknown journal op: ${line.slice(0, 100)}`);
  });
  // A version 4 binding (calibration lessons L-053/L-054) stamps `runId` on every add event
  // once a ledger commits to a contract run — a journal straddling bound and unbound adds, or
  // naming more than one run, cannot be trusted to say which run a dispatch belongs to.
  const addEvents = events.filter((e) => e.op === 'add');
  const boundAdds = addEvents.filter((e) => e.runId);
  const unboundAdds = addEvents.filter((e) => !e.runId);
  if (boundAdds.length && unboundAdds.length) violations.push('dispatch journal mixes runId-bound and unbound add events');
  const runIds = new Set(boundAdds.map((e) => e.runId));
  if (runIds.size > 1) violations.push(`dispatch journal add events carry different runIds: ${[...runIds].sort().join(', ')}`);
  return { expected, violations, events };
}
