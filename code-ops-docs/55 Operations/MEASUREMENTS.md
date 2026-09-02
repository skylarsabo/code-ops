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
- `hooks/session-receipt.mjs` runs at `SessionEnd` and appends one row per session to `~/.claude/code-ops/session-receipts.jsonl` (or `$CODE_OPS_RECEIPTS`). `node scripts/context-audit.mjs receipts` summarizes the ledger.
- `node scripts/run-proof.mjs record -- <audit command>` turns an audit run into a replayable receipt row.
- `evals/context-audit/run.mjs` pins the parser and the hook against a synthetic fixture.

Usage is deduplicated by message id. The host writes one assistant message as several transcript lines that repeat the same usage block, so a naive sum overcounts by more than two to one.

## Baseline: this repository, 2026-06-23 to 2026-09-02

Recorded at commit `a9105a8` on 2026-09-02. Receipt: `RCPT-001` in the run folder `80 Runs/2026-09-02 phase0-context-audit/` (local, gitignored), output digest `4886ffd6d535`. Command: `node scripts/context-audit.mjs --top 10 --json`. Window: 23 sessions and 196 subagent threads.

### Exact tokens

| Thread | Assistant messages | Input | Cache read | Cache create | Output | Thinking | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main | 3,101 | 270,645 | 973,514,448 | 19,471,074 | 2,867,652 | 176,895 | 996,123,819 |
| subagents | 4,341 | 696,123 | 342,615,599 | 16,997,584 | 3,145,068 | 171,899 | 363,454,374 |
| all | 7,442 | 966,768 | 1,316,130,047 | 36,468,658 | 6,012,720 | 348,794 | 1,359,578,193 |

Cache reads are 96.8% of all tokens. Uncached input plus cache creation is 2.8%. Output is 0.4%. The cost lever is therefore what stays resident in the window turn after turn, not what is typed or generated.

### Context characters by source, all threads

| Source | Share |
| --- | ---: |
| Tool results | 77.4% |
| . Read | 48.9% |
| . Bash | 20.4% |
| . Grep | 2.6% |
| . Agent reports | 1.7% |
| Assistant text | 7.2% |
| Thinking text | 6.1% |
| User and system text | 9.3% |

### Where the tool bytes come from

| Bash family | Result chars |
| --- | ---: |
| git diff | 880,803 |
| grep | 587,265 |
| sed | 577,856 |
| echo | 348,786 |
| node | 230,767 |
| for (shell loops) | 204,398 |
| node run.mjs (evals) | 160,148 |
| gh pr | 149,814 |

The six largest single results were all Reads of `.txt` files between 62k and 76k characters. Those are persisted tool outputs and task outputs the suite itself produced, read back whole.

Repeat reads: 152 paths were read more than once, 207 extra reads, 1,099,139 characters re-read.

### What the baseline says

1. Reads are the first-order cost, at half of all context characters, and the largest ones are the suite's own artifacts. Bounded reads and a query surface come before any command filter.
2. Bash is second, and its top families are diffs, greps, and sed reads through the shell. A shape-keyed digest covers all three with one detector each.
3. Subagent threads carry 27% of all tokens and 52% of output tokens. Operative brief and return-shape discipline is a measurable lever.
4. Re-reads alone are 1.1 million characters. A staleness-aware read cache or the index refresh in the design note would remove most of them.

## Method for the next rows

Each mechanism ships behind a per-repo switch. A row is added only with the switch state, the window, the receipt id, and the same `context-audit.mjs` command. The pre-registration protocol in `evals/README.md` names the metric and the stopping rule before the switch flips. The design note `10 Design/Context and code economy 2026-09.md` owns the workstreams these rows measure.
