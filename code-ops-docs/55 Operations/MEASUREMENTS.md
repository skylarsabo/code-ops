---
type: reference
status: current
updated: 2026-09-02
---

# Measurements

## Contract

Every number here comes from a local receipt, never from an estimate or a hand-entered note. The sources are the host's own session transcripts, which carry exact per-message token usage, and the SessionEnd receipt ledger the suite writes from them. Reading either costs no model tokens and nothing leaves the machine. A row without a receipt does not enter this page.

Numbers age. Treat a row as true for the window it names and re-run the audit before acting on it.

## Instruments

- `node scripts/context-audit.mjs` summarizes the transcripts for the current directory: exact tokens by class with main and subagent threads apart, context characters by tool, Bash output by command family, repeat reads, and the largest results. Output is sanitized by default. `--json` emits the aggregate a receipt can hash.
- `hooks/session-receipt.mjs` runs at `SessionEnd` and appends one row per session to `~/.claude/code-ops/session-receipts.jsonl` (or `$CODE_OPS_RECEIPTS`, where `off` disables it). `node scripts/context-audit.mjs receipts` summarizes the ledger.
- `node scripts/run-proof.mjs record -- <audit command>` turns an audit run into a replayable receipt row.
- `evals/context-audit/run.mjs` pins the parser and the hook against a synthetic fixture.

Usage is deduplicated by message id. The host writes one assistant message as several transcript lines that repeat the same usage block, so a naive sum overcounts by more than two to one.

## Baseline: this repository, 2026-06-23 to 2026-09-02

Recorded at commit `a9105a8` on 2026-09-02. Receipt: `RCPT-004` in the run folder `80 Runs/2026-09-02 phase0-context-audit/` (local, gitignored), output digest `f80a73868920`. Command: `node scripts/context-audit.mjs --top 10 --json`. Window: 23 sessions and 200 subagent threads.

### Exact tokens

| Thread | Assistant messages | Input | Cache read | Cache create | Output | Thinking | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main | 3,139 | 286,585 | 986,553,451 | 19,580,780 | 2,925,676 | 188,530 | 1,009,346,492 |
| subagents | 4,454 | 696,349 | 349,241,719 | 17,414,420 | 3,275,991 | 228,021 | 370,628,479 |
| all | 7,593 | 982,934 | 1,335,795,170 | 36,995,200 | 6,201,667 | 416,551 | 1,379,974,971 |

Cache reads are 96.8% of all tokens. Uncached input plus cache creation is 2.8%. Output is 0.4%. The cost lever is therefore what stays resident in the window turn after turn, not what is typed or generated.

### Context characters by source, all threads

| Source | Share |
| --- | ---: |
| Tool results | 77.6% |
| . Read | 48.6% |
| . Bash | 21.0% |
| . Grep | 2.6% |
| . Agent reports | 1.7% |
| Assistant text | 7.1% |
| Thinking text | 6.0% |
| User and system text | 9.3% |

### Where the tool bytes come from

| Bash family | Result chars |
| --- | ---: |
| git diff | 1,009,739 |
| node | 887,800 |
| sed | 598,600 |
| grep | 596,598 |
| for | 470,756 |
| echo | 419,587 |
| cat | 297,471 |
| ls | 173,458 |

The six largest single results were all Reads of `.txt` files between 62,705 and 76,423 characters. Those are persisted tool outputs and task outputs the suite itself produced, read back whole.

Repeat reads: 152 paths were read more than once, 207 extra reads, 1,099,139 characters re-read.

### What the baseline says

1. Reads are the first-order cost, at 48.6% of all context characters, and the largest ones are the suite's own artifacts. Bounded reads and a query surface come before any command filter.
2. Bash is second, and its top families are diffs, script runs, sed and grep reads through the shell. A shape-keyed digest covers those with one detector each.
3. Subagent threads carry 26.9% of all tokens and 52.8% of output tokens. Operative brief and return-shape discipline is a measurable lever.
4. Re-reads alone are 1,099,139 characters. A staleness-aware read cache or the index refresh in the design note would remove most of them.

## Method for the next rows

Each mechanism ships behind a per-repo switch. A row is added only with the switch state, the window, the receipt id, and the same `context-audit.mjs` command. The pre-registration protocol in `evals/README.md` names the metric and the stopping rule before the switch flips. The design note `10 Design/Context and code economy 2026-09.md` owns the workstreams these rows measure.
