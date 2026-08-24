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

export function replayDispatchJournal(text) {
  const expected = new Map();
  const violations = [];
  const events = [];
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
      if (expected.has(entry.id)) { violations.push(`${at}: duplicate add for ${entry.id}`); return; }
      expected.set(entry.id, entry.status); events.push(entry); return;
    }
    if (entry.op === 'update') {
      if (typeof entry.id !== 'string' || !/^D-\d+$/.test(entry.id) || !LEDGER_STATUSES.includes(entry.to)) { violations.push(`${at}: malformed update entry: ${line.slice(0, 100)}`); return; }
      if (!expected.has(entry.id)) { violations.push(`${at}: update for ${entry.id}, which was never added`); return; }
      expected.set(entry.id, entry.to); events.push(entry); return;
    }
    violations.push(`${at}: unknown journal op: ${line.slice(0, 100)}`);
  });
  return { expected, violations, events };
}
