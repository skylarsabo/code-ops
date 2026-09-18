---
type: reference
status: current
updated: 2026-09-13
---

# Measurements

## Contract

Every number here comes from a local receipt, never from an estimate or a hand-entered note.
The source and granularity are host-qualified: Claude exposes per-message transcript usage,
Codex exposes response usage in peer rollouts, and installed Grok 1.0.13 exposes cumulative
per-prompt snapshots in `updates.jsonl`. OpenCode has no automatic transcript receipt. Reading
supported local records costs no model tokens and nothing leaves the machine. A row without a
receipt does not enter this page.

Numbers age. Treat a row as true for the window it names and re-run the audit before acting on it.

## Instruments

- `node scripts/context-audit.mjs` summarizes Claude transcripts for the current directory.
  `--host codex` adapts Codex response usage and follows child rollout `parent_thread_id`
  links. Grok receipts normalize cumulative snapshots from `updates.jsonl`. Output is
  sanitized by default. `--json` emits the aggregate a receipt can hash.
  The report carries context shape per thread, spend by context band, cache rewrites, and
  subagents by agent type. `--all` merges every project under the host transcript root and ranks
  projects as `project-N`; `--raw` names them.
- `hooks/session-receipt.mjs` runs at `SessionEnd` on Claude, Codex, and installed Grok
  1.0.13. It appends one normalized row to the host-specific home ledger or
  `$CODE_OPS_RECEIPTS`; `off` disables it. Grok rows always record `ladderCard=false`.
  OpenCode has no corresponding callback.
- `node scripts/run-proof.mjs record -- <audit command>` turns an audit run into a replayable receipt row.
- `node scripts/context-audit.mjs receipts --purge-before <ISO date>` is the ledger's retention: it rewrites the file keeping rows at or after the date and prints what it removed.
- `evals/context-audit/run.mjs` pins the parser and the hook against a synthetic fixture.
- `node scripts/digest.mjs -- <cmd>` measures one command's own compressible share: it prints the before-and-after line counts in its trailer and appends `bytesIn`, `bytesOut`, `linesIn`, and `linesOut` to `DIGEST_RECEIPTS.jsonl`. The `PreToolUse` digest hook runs it for every allowlisted simple command, so the ledger fills on its own. A row exists only for a command the digest shrank: an output of at most 1,536 bytes, or one the digest cannot make smaller, passes through raw with no row, because the session measurement of 2026-09-03 found 77 of 84 receipted commands paid more in trailer than they saved. `evals/digest/run.mjs` reports the per-shape reduction on a fixed corpus and fails when it drops below the recorded floor.

Usage is deduplicated by message id. The host writes one assistant message as several transcript lines that repeat the same usage block, so a naive sum overcounts by more than two to one.

The `context-bundle view` regression fixture is 1,482 bytes against a 1,987-byte canonical
bundle, a 25.4% byte reduction. This is compiler-fixture evidence only. Hook evals likewise
prove exact output shape and side effects, not a live external model turn. Neither is evidence
of provider-token reduction, cache improvement, causal workflow improvement, or dollar
savings. Those claims require attributed observations from pre-registered, matched on/off
controls on the same host.

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

Each mechanism ships behind a per-repo switch where the host supports it. A row is added only
with the host and version, switch state, window, receipt id, and the same audit command. The
pre-registration protocol in `evals/README.md` names the metric and stopping rule before a
switch flips. No causal-control run has completed for the current cross-host mechanisms, so
their token-optimization and workflow-effect claims remain pending.

The ladder card (`hooks/ladder-card.mjs`, switch `CODE_OPS_LADDER_CARD`) is a Claude and Codex
arm. Its row compares implementer operative transcripts with the card against the brief-only
control on diff line count, tokens, and the correctness gate. Grok carries the ladder in its
instruction files and records this arm false. OpenCode has no ladder arm.

The symbol index (`context-query.mjs`, hook `index-refresh.mjs`, switch `CODE_OPS_INDEX`) is the Workstream C arm. Its row compares sessions that answer a structural question through the query tool against sessions that read the map, on tool calls, tokens, and the context resident at session end, which is the metric codegraph loses on.

## Pre-registered comparison, Phase 6

Every receipt row records which mechanisms the session ran under, in `arms`, each on unless its
switch said off, and the
context resident at session end, in `contextAtEnd`. `node scripts/context-audit.mjs receipts
--by-arm` groups rows by that record and prints per-session means, so an arm reads against
sessions run with a mechanism off on the same directory with the same command. Rows written
before the record existed group as `unknown` and are not a control.

The mechanisms ship on by default, so the control is a run with switches off. The schedule is
ten sessions each on this repository, in this order: all three off, digest only, digest and
index, then the full default. A session counts when it ends normally and lasts over five
minutes. The off switches live in the ignored `.claude/settings.local.json` of this checkout,
never in the tracked settings, so the arm is a property of this machine's sessions.

The decision rules are fixed before the rows exist:

- **Digest.** The default stays on when tool-result characters per turn fall by at least a
  quarter against the off run, total tokens per session do not rise, and every eval stays green.
  A smaller fall flips the default to off. A rise in tokens per session removes the hook.
- **Index.** The index stays when context at end and tool-result characters per session both
  fall against the preceding arm with tool calls per session not up by more than a tenth. Any
  other outcome removes the refresh hook and keeps the query tool as a plain command.
- **Ladder card.** The card stays when subagent tokens per session fall against the preceding
  arm with the deterministic gates green on the same work. Any other outcome removes the hook,
  and the ladder stays where it is, in the briefs and the conventions.

A row is published here with the arm, the window, the session count, the four per-session
means the rule reads, and the receipt of the `--by-arm` run. Evidence:
`plugins/code-ops-suite/hooks/session-receipt.mjs:68-71`, `scripts/context-audit.mjs:93-132`,
and `scripts/transcript-lib.mjs:212`.

## Cross-project spend audit, 2026-09-18

**CONFIRMED** from host usage records. Scope: every Claude transcript under the host's project
root with a turn on or after 2026-09-17, which is 14 lead threads and 113 subagent threads,
mostly from one other repository's implementation runs. Context per turn is input plus
cache-read plus cache-creation tokens, deduplicated by message identity. The report carries
counts only and quotes nothing from those repositories.

| Thread kind | Threads | Turns | Input-side tokens | First-turn context, median | Peak context, median | Peak, 90th percentile |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Lead | 14 | 953 | 207M | 73K | 259K | 410K |
| Subagent | 113 | 5,470 | 836M | 57K | 122K | 239K |

| Context band | Lead share | Subagent share |
| --- | ---: | ---: |
| under 100K | 4% | 14% |
| 100K to 150K | 8% | 22% |
| 150K to 200K | 16% | 22% |
| 200K to 300K | 43% | 27% |
| over 300K | 28% | 14% |

| Agent type and tier | Threads | Turns | First-turn context, median | Input-side tokens |
| --- | ---: | ---: | ---: | ---: |
| general-purpose, strong | 73 | 4,779 | 57K | 787M |
| host exploration agent, strong | 23 | 433 | 32K | 32M |
| general-purpose, frontier | 7 | 219 | 57K | 28M |
| suite `explorer`, strong | 10 | 153 | 18K | 11M |
| `mech`, mid | 3 | 89 | 24K | 4M |

Three readings follow. Spend is resident context multiplied by turn count: tool results
totalled about 4.5 million tokens, under 1% of the input side, so each resident token was
re-read about 200 times. Caching was healthy, with 41 turns that rewrote more than half their
context. A general-purpose operative starts 33,000 to 39,000 tokens above a restricted-tool
agent on every turn, because it inherits every host tool schema.

These numbers drove the `implementer` agent, the brief's Round budget field, and the handoff
threshold amendment below. They are one day from one operator, so they size the levers and do
not prove the fixes. **Pre-registered check:** the next audit of comparable runs, using
`context-audit.mjs --all`, should show implementation operatives with a median first-turn
context under 30,000 and a median peak under 150,000. If the first holds and the second does
not, the Round budget is not binding and needs a mechanical backstop.

## Pre-registered: handoff-card threshold

`hooks/handoff-card.mjs` (switch `CODE_OPS_HANDOFF_CARD`) nudges toward `/code-ops-suite:handoff`
once a session's resident context, read from the last assistant turn's usage record, crosses
150,000 tokens, and again every further 150,000-token band. That threshold and band width are
**SPECULATIVE**: chosen from the baseline's own resident-context evidence (this repository's
`main` thread averaged 986,553,451 cache-read tokens across 3,139 assistant messages, so a
per-turn context in the hundreds of thousands is ordinary, not exceptional) rather than from a
matched on/off comparison. This row pre-registers the metric and the decision rule before any
such comparison exists, per the protocol the ladder-card and index rows above already follow.

**Metric.** Once `hooks/session-receipt.mjs` is extended to record it (not yet done), each
session receipt's `arms` object would carry `handoffCard: true|false` the way it already carries
`digest`, `ladderCard`, and `index`, and the row would carry the highest band the marker file
reached during the session, alongside the existing `contextAtEnd` field the hook itself computes
independently. Until that extension lands, the only evidence available is the marker files
themselves and operator report.

**Amendment, 2026-09-18.** The threshold started at 200,000. The cross-project audit below found
71% of lead input-side tokens spent above 200,000, a median lead peak of 259,000, and a 90th
percentile of 410,000. Leads were far past the first nudge before any handoff, which is the
rule's "fires too late" outcome, so the threshold and band width moved to 150,000. This is
transcript evidence, not the matched on/off comparison the rule names, so the value stays
**SPECULATIVE**. The audit cannot show whether a nudged lead handed off, and the rule's removal
clause still applies once receipts record that.

**Decision rule, fixed before any row exists.** The threshold stays where it is when sessions
that received at least one nudge show a higher share of turns starting a `/code-ops-suite:handoff`
within one further band than sessions with the switch off, with no rise in sessions abandoned
mid-task. A threshold that fires too late (operators already past a natural workstream boundary
before the first nudge) lowers it one band; a threshold that fires with no natural boundary
nearby (nudges the same session repeatedly with no handoff opportunity) raises it. Any outcome
that shows the card firing but changing no operator behavior removes the hook, the same rule
the ladder card and index rows use.

## Effort sweep, Workstream D

Effort level names do not carry across model generations, so the routing table in
`code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md` is re-derived when the lead model
changes. The sweep is model-in-the-loop and operator-run. For each judgment-bearing agent
(`reviewer`, `tracer`, `verifier`, `claim-checker`) copy its definition three times with the host's
`effort:` frontmatter set to `low`, `medium`, and `high`, run the judgment evals under
`evals/judgment-matrix.json` once per variant against the same answer keys, and read recall and
decoy count per variant from the scoring receipts.

The decision rule is fixed before the runs: a dispatch steps down one effort level only where
recall is equal or higher and the decoy count equal or lower than the current level on two runs.
Review never steps below medium. A level that loses recall on either run is discarded. The
table's rows are rewritten from the receipts, with the run receipts cited, and the conventions'
routing sentence is edited in the same commit. The sweep has not been run for the current lead
model, and the table stands on the previous generation's runs until it is.
