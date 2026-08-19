// Data-only source of truth for grammar (a) of docs/techniques/artifact-grammars.md — the
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
// module load, so importing it runs its CLI. This module has no side effects and no imports,
// which is what lets all three read from it.
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
