---
type: reference
status: current
updated: 2026-10-06
---

# Measurements

## Contract

Every number here comes from a local receipt, never from an estimate or a hand-entered note.
The source and granularity are host-qualified: Claude exposes per-message transcript usage,
Codex exposes response usage in peer rollouts, and installed Grok 1.0.13 exposes cumulative
per-prompt snapshots in `updates.jsonl`. OpenCode has no automatic transcript receipt. Reading
supported local records costs no model tokens and nothing leaves the machine. A row without a
receipt does not enter this page. A registration, such as the program metric registry below, fixes a
metric's source, owner, baseline, and decision rule before a receipt exists. It carries no
measured result of its own.

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
  `$CODE_OPS_RECEIPTS`; `off` disables it. Grok rows always record `ladderCard=false` and
  `handoffPickup=false`. `handoffCard` follows its switch. Every row also carries `handoffPickup` and
  `dispatchGuard` beside the older arms. Each row counts skill invocations by id in `skills`
  (`{}` when none ran), and `context-audit.mjs receipts` sums them across rows, so a usage
  audit is one ledger query rather than a transcript search.
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

## Pre-registered comparison, digest, index, and ladder card

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
`plugins/code-ops-suite/hooks/session-receipt.mjs:68-71`, `scripts/context-audit.mjs:299-337`,
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
not, the Round budget is not binding and needs a mechanical backstop. The dispatch guard below is
that backstop, pre-registered on its own metric and decision rule.

## Pre-registered: handoff-card threshold

`hooks/handoff-card.mjs` (switch `CODE_OPS_HANDOFF_CARD`) nudges toward `/code-ops-suite:handoff`
once a session's resident context, read from the last assistant turn's usage record, crosses
150,000 tokens, and again every further 150,000-token band. That threshold and band width are
**SPECULATIVE**: chosen from the baseline's own resident-context evidence (this repository's
`main` thread averaged 986,553,451 cache-read tokens across 3,139 assistant messages, so a
per-turn context in the hundreds of thousands is ordinary, not exceptional) rather than from a
matched on/off comparison. This row pre-registers the metric and the decision rule before any
such comparison exists, per the protocol the ladder-card and index rows above already follow.

**Metric.** Each session receipt's `arms` object carries `handoffCard: true|false` the way it
carries `digest`, `ladderCard`, and `index`. The row also carries `handoff`, with `band`, the
highest band the session's marker file reached, and `invoked`, true when the session's transcript
shows the operator running `/code-ops-suite:handoff` after the first prompt. A command in the first
prompt resumes an earlier session, and the marker quoted in a tool call is not a run, so neither
counts. A re-arm lowers the marker's live band but
never its peak, so a session that compacted back under the threshold still reports that it was
nudged. `context-audit.mjs receipts --by-arm` reports per arm how many sessions were nudged and
how many of those handed off, which is the ratio the decision rule reads. Rows written before the
hook recorded these fields count in neither figure. Evidence:
`plugins/code-ops-suite/hooks/session-receipt.mjs:64-87` and `scripts/context-audit.mjs:364-406`.

**Amendment, 2026-09-18.** The threshold started at 200,000. The cross-project audit below found
71% of lead input-side tokens spent above 200,000, a median lead peak of 259,000, and a 90th
percentile of 410,000. Leads were far past the first nudge before any handoff, which is the
rule's "fires too late" outcome, so the threshold and band width moved to 150,000. This is
transcript evidence, not the matched on/off comparison the rule names, so the value stays
**SPECULATIVE**. The audit cannot show whether a nudged lead handed off. Receipts now record
that, so the comparison starts from the rows written after this change, and the rule's removal
clause applies once enough of them exist.

**Decision rule, fixed before any row exists.** The threshold stays where it is when sessions
that received at least one nudge show a higher share of turns starting a `/code-ops-suite:handoff`
within one further band than sessions with the switch off, with no rise in sessions abandoned
mid-task. A threshold that fires too late (operators already past a natural workstream boundary
before the first nudge) lowers it one band; a threshold that fires with no natural boundary
nearby (nudges the same session repeatedly with no handoff opportunity) raises it. Any outcome
that shows the card firing but changing no operator behavior removes the hook, the same rule
the ladder card and index rows use.

**Amendment, 2026-09-18, message and pickup.** The nudge now escalates: band 1 advises a handoff at
the next workstream boundary, and band 2 and higher asks for it in this session. The routing card
also carries a pending-handoff line on a fresh session, under its own switch
`CODE_OPS_HANDOFF_PICKUP`, so a written handoff reaches the next session without the operator
carrying it. Both changes act on the same outcome the metric above reads, so the on/off comparison
reads `handoff.invoked` with pickup on, and a row written with `arms.handoffPickup=false` belongs to
the control rather than the arm.

**Amendment, 2026-09-21, lifecycle policy.** The fixed bands now request a CONTINUE, COMPACT, or
HANDOFF assessment at a safe boundary. They remain speculative reminders, not restart thresholds
or savings proof. Historical `handoff.band` records the peak reminder band and `handoff.invoked`
records an invocation, including an assess call; neither field identifies the selected action or
proves a handoff, compaction, delivery, or cost outcome.

## Pre-registered: dispatch guard

`hooks/dispatch-guard.mjs` (switch `CODE_OPS_DISPATCH_GUARD`) counts attempted subagent tool calls.
Its unregistered fallback warns at the environment budget and every further 20 calls, then denies
at twice that budget. A brief's `Round budget: <n>` line binds the unregistered counter: the hook reads the subagent's first transcript entry once, clamps above 120, and falls back to the environment budget without a readable line. The 40-call default and the
twice-budget stop are **SPECULATIVE**:
both come from the 2026-09-18 cross-project audit above, where one operative spent 71 tool uses
against a 40-round budget, not from a matched on/off comparison. The stop moved from three times
to twice the budget after the 10-day audit below: reviewers averaged about 90 rounds, under the
old 120-round stop, so that stop never bound them. This row fixes the metric and the decision
rule before any comparison exists.

**Amendment, 2026-09-28 (design item U4).** The stop moved from twice the budget to 1.5 times
it, rounded down and at least one call past it, so the default 40 now denies from call 60. The
warning at the budget is unchanged and serves as the checkpoint line. The comparison above
applies to the new stop from the release that carries it. The 1.5 value is also
**SPECULATIVE**. Evidence: `plugins/code-ops-suite/hooks/dispatch-guard.mjs` (`stopCall`) and
`scripts/opencode-lifecycle.js`.

Explicit controller registration now binds an exact agent ID to a budget and small checkpoint
allowance. Its sanitized receipt reports the declared budget, allowance, attempted calls, and
binding status. The effective runtime budget remains `UNKNOWN`, because the worker may have a
different environment from the receipt command. Unobserved request and token counts also remain `UNKNOWN`.
Synthetic tests establish isolation and stop behavior, not provider savings. The cost estimator's
component charges explain existing attributed totals without changing them. Selected worker views
measure byte reduction only; cache hits and accepted-task savings still require observed evidence.

**Metric.** Operative tool-use counts from `node scripts/context-audit.mjs --all`, read per agent
type, against the guard arm each session receipt records as `arms.dispatchGuard`. A
`CODE_OPS_DISPATCH_GUARD` of `warn` records the arm on, because every advisory still runs, so a
warn-only comparison needs its own checkout and its own rows.

**Decision rule, fixed before any row exists.** The default stays when guarded operatives show a
lower 90th-percentile tool-use count than the control, with no rise in units abandoned without a
checkpointed report. Denied operatives that return no usable report lower the warn threshold rather
than raise the stop, because the failure is a late warning, not a tight stop. A guard that fires
with no change in operative behavior removes the hook, the same rule the ladder card, index, and
handoff card rows use.

**Delivery observation, 2026-09-18.** Delivery of the warning into a live subagent is
**CONFIRMED** on the Claude host at suite 1.85.0. A read-only operative made 42 sequential tool
calls under a brief that did not quote the warning. At call 40 it received the guard's line as
`PreToolUse:Read hook additional context`, verbatim from the hook source, and no earlier call
carried it. The guard's counter file for that operative held 42 bytes afterward. This settles
where the warning lands. It says nothing about the decision rule above, because an operative told
to continue past the warning measures no change in behavior. The round stop is still
unobserved in a live operative.

## Pre-registered: context ceiling and wide-type deny

A 10-day transcript audit of this repository measured where lead and operative input went. Leads
spent 68% of input tokens. Lead turns above 300,000 tokens of context spent 2.68 billion of
3.69 billion lead input tokens. 1,942 lead turns ran above 600,000 tokens, and 38 sessions held
only 2 compactions. The 150,000-token handoff nudge alone did not change that behavior.
General-purpose operatives carried 29% of input tokens. Across 82 of them the mean was 156 turns,
and each started near 56,000 tokens of context, against 14,000 to 20,000 for a restricted agent.
These are one repository's numbers from one operator. They size the levers and prove nothing
about the fixes.

Two gates answer them in `hooks/dispatch-guard.mjs` and the OpenCode lifecycle plugin. The
context-ceiling gate denies a new lead dispatch at or above `CODE_OPS_CONTEXT_CEILING`, 300,000
tokens by default, until `/code-ops-suite:handoff assess` runs, and gates again at each further
150,000-token band. The wide-type gate denies a `general-purpose`, `claude`, `fork`, or unnamed
dispatch whose brief carries no `Wide-surface reason:` line. The 300,000 default and the band
width are **SPECULATIVE**: they come from this audit, not from a matched on/off comparison.

**Metric.** From `node scripts/context-audit.mjs --all` over comparable sessions: the share of lead
input tokens spent on turns above 300,000 tokens, the count of lead turns above 600,000, the
compactions and handoffs per session, and the share of operative input carried by wide-surface
types. Each session receipt's `arms.dispatchGuard` separates the arms.

**Decision rule, fixed before any row exists.** The ceiling gate stays when gated sessions show a
lower share of lead input above 300,000 tokens and fewer turns above 600,000 than the baseline,
with no rise in abandoned units. It also needs no rise in handoffs that fail `check-handoff.mjs`.
Gated sessions that record the assessment and then run on unchanged refute the gate: the lead
clicked through, and the ceiling moves down or the gate goes. The wide-type deny stays when the
wide-surface share of operative input falls with no rise in failed units. A deny that most briefs
answer with a boilerplate `Wide-surface reason:` refutes it.

## Handoff cost and the handoff line, 2026-09-24

Transcripts from two adopting repositories held 70 handoff hops. A hop cost about 3 to 5 million
tokens. The successor's resume phase took a median of 21 turns at about 2.9 million tokens, and
writing the handoff took about 1.7 million. Successor sessions started at a median of about
80,000 tokens of context.

The net saving per hop depended on the context the ending session would have carried:

| Context the ending session would carry | Net saving per hop | Hops that saved |
| --- | --- | --- |
| under 200,000 | +0.2M | not split out |
| 200,000 to 300,000 | about zero | 7 of 12 |
| 300,000 to 450,000 | +0.4M | not split out |
| over 450,000 | +1.5M | 18 of 21 |

Overall, the chains used 22% fewer lead tokens, about 18% price-weighted, than one continuous
session that auto-compacts near 994,000. The repository with short chains came out 11% worse
price-weighted.

History: these figures first set the handoff skill's context line at about 350,000 tokens. The
figures are **CONFIRMED** transcript measurements. The 350,000 value read from them was
**PROBABLE**, because no matched on/off comparison exists.

**Amendment, 2026-09-28 (DEC-3).** The line moved to about 225,000 tokens. The next section
records why and pre-registers the check. On context grounds alone, a lead now hands off at a phase
boundary past about 225,000 tokens. CONTINUE is right when the remaining work fits in about
100,000 more tokens. Quality triggers still select HANDOFF at any size. The 150,000-token band and
the 300,000-token ceiling stay as assessment points, and Grok hands off by its 200,000 line. The
225,000 and 100,000 values stay **PROBABLE**. Evidence:
`plugins/code-ops-suite/skills/handoff/SKILL.md`, "Assess the lifecycle first".

## Pre-registered: handoff point

DEC-3 moves the handoff point from about 350,000 to about 225,000 tokens. The 300,000-token
dispatch-guard ceiling stays. It now sits past the handoff point, so it forces an assessment on a
session that chose CONTINUE and overran. The 150,000-token card bands stay. This row pre-registers
the check before the change (design PR 3) lands. Source: `code-ops-docs/10 Design/Program state
handoffs and coordination 2026-09.md`, "Handoff economics", "H6", and open item DSN-3.

**Baseline.** Two trailing 72-hour windows were compared, the latest against the one before it.
All figures are **CONFIRMED** transcript measurements from the latest window:

- Lead mean context per turn was 209,000 tokens (157,000 in the earlier window).
- 19% of lead input sat above 300,000 tokens (0.5% in the earlier window).
- Resume overhead fell from 11.8% to 6.8% of chain input.

**Expected direction.** Both the lead mean context per turn and the share of lead input above
300,000 fall. Resume overhead may rise with more hops, and the comparison reports it.

**Window method.** Run `node "code-ops-docs/80 Runs/2026-09-27-handoff-fidelity-design/reports/handoff-windows.mjs" <now ISO>`.
It compares two trailing 72-hour windows. It links chain hops through `HANDOFF.consumed`
`bySession` and the `sessionId` in `SESSION.json`. `OLD_T` sets the replayed handoff point, so a
sweep of `OLD_T` values models each candidate point.

**Model, not measurement.** A replay of the recent window with a handoff at 209,000 cost 12-15%
less price-weighted lead spend, including 98 extra handoffs. A sweep put the best point at
200,000 to 240,000. This replay is a model and not a measurement. The 225,000 value therefore
stays **PROBABLE** until the comparison below runs.

**Decision rule.** Re-run the window method one week after PR 3 lands, over windows that start
after it. The point stays when both baseline measures fall. When neither falls, DEC-3 reopens
with the new windows as evidence. A mixed result is recorded here before any change. The
comparison closes DSN-3 in every case.

**Amendment, 2026-09-30 (DEC-73).** On Claude and Codex, auto-compaction is the routine context relief and the handoff point no longer applies. `CLAUDE_CODE_AUTO_COMPACT_WINDOW=250000` sets the compaction point. A handoff happens only for a new workstream, a host or operator change, session end, or a quality failure. Grok keeps the 200,000 point. The reason is measured hop cost: across 121 murmuration sessions from 2026-09-24, 113 began with a handoff resume. One hop cycle (median handoff-write tail plus median resume overhead, unpaired medians) cost about 10.8M billed tokens, about 46% of a median session.

**Amendment, 2026-10-04.** On Grok the 200,000-token line is a price line, not a handoff point. Context relief is a suite compact at 150,000 tokens. The card writes `COMPACT_SNAPSHOT.md` before compaction and names it on the next tool result, so the snapshot outranks the host summary. A typed prompt past the price line is blocked until `/compact`, a handoff command, or a live `Continue-until:` bound. A handoff remains for new work, a failed compact, updated plugins, or a host change. The hop-cost evidence in the 2026-09-30 amendment is why a token count does not select a handoff.

**Amendment, 2026-10-04, host compact.** Three code-ops sessions landed at 143k, 160k, and 179k after one to three segments compacts. Compacting at 150,000 returned the window to the same band. The host now compacts near 184,000 tokens, at 72 percent of the 256,000-token window. Band 1 checkpoints and waits. The 200,000 block remains for a compact that did not run. The post-compact note names the newest compaction segment. A second climb is a new session pointed at that segment.

**Compaction fidelity check (pre-registered).** On 2026-09-30 one Claude desktop session auto-compacted after a hand-written checkpoint. From the summary and the compact SessionStart card alone, the lead named every active item, every operator constraint verbatim, and every running agent. Agent ids were missing from the summary and came from host task notifications. No PreCompact snapshot hook existed. **CONFIRMED** for one session (n=1). The check repeats once the snapshot hook ships.

## Presence board hook latency, 2026-09-28

This row is the OI-18 baseline for these three hook events only. It measures the hook cost of the
presence board and the peer-guard redirect (design PR 10). The limit is 50 ms added at p95 per
tool call. Source: `code-ops-docs/10 Design/Program state handoffs and coordination 2026-09.md`,
"Cross-cutting: hook cost".

**Environment.** Node v24.16.0 on Windows 11 Pro (win32). A local bench script spawned each hook
with `spawnSync` and timed the wall clock. Each case ran 2 warmups, then 100 timed runs. The cases
ran interleaved in one loop. The fixture was a temporary repository and home, with
`CODE_OPS_HOME` set, `CODE_OPS_PEER_GUARD=on`, and `CODE_OPS_INDEX=off`. The redirect case
targeted a handed-off session whose successor has a host session id, and the output confirmed
`updatedInput`. "Added" is the case percentile minus the baseline percentile.

| Event | p50 ms | p95 ms | Added p50 ms | Added p95 ms | Within 50 ms p95 |
| --- | --- | --- | --- | --- | --- |
| Baseline `node -e 0` | 40.8 | 70.2 | 0 | 0 | not applicable |
| Peer guard, redirect path | 56.4 | 89.2 | 15.6 | 19.0 | yes |
| Peer guard, non-message tool (`Bash`) | 45.4 | 97.4 | 4.6 | 27.1 | yes |
| Edit hook, board write only | 56.3 | 94.9 | 15.5 | 24.7 | yes |

All three events are within the limit. The figures are **CONFIRMED** for this machine and run. An
earlier run with 20 samples put the redirect path at 50.3 ms added at p95. With 20 samples, p95 is
the 19th value, so that run was noisy. The 100-sample run supersedes it. The redirect path runs
only on a message to a handed-off peer. The non-message path runs on every tool call on Codex,
because the Codex projection drops the matcher. The edit hook runs on every edit.

## Hook latency baseline per event, 2026-09-29

This section closes OI-18. It is the p50 and p95 added latency of every hook event entry in
`plugins/code-ops-suite/hooks/hooks.json`, measured on `main` at `6722e28` before PR 11. The
limit is 50 ms added at p95 per tool call. Source: `code-ops-docs/10 Design/Program state handoffs and coordination 2026-09.md`,
"Cross-cutting: hook cost". The earlier section covers three of these entries and stays valid.

**Reproduce.** Add a detached worktree of the commit, then run the bench against its plugin root.
The bench is `scripts/bench-hooks.mjs`, and `--plugin-root` selects the tree to measure.

```powershell
git worktree add --detach <dir> 6722e28
node scripts/bench-hooks.mjs --plugin-root <dir>/plugins/code-ops-suite
node scripts/bench-hooks.mjs --plugin-root <dir>/plugins/code-ops-suite --env CODE_OPS_INDEX=off
```

**Environment.** Node v24.16.0 on Windows 11 Pro (win32), other work running on the machine. The
bench spawns each command of an entry one after another with `spawnSync` and times the whole
sequence. It runs 2 warmups, then 100 timed runs per case, and the cases run interleaved with the
start position rotated each pass. The fixture is a temporary git repository and a temporary home,
with `CODE_OPS_HOME`, `HOME`, and `USERPROFILE` pointing at it. Every `CODE_OPS_*` switch is unset,
so each mechanism runs at its default (on). The one exception is the second run, which sets
`CODE_OPS_INDEX=off`. The payloads are synthetic: fixed ids, fixture paths, and a 200-turn
transcript. The `Agent` case sends a complete brief, so the guard takes its allow path.
"Added" is the case percentile minus the percentile of the same number of `node -e 0` spawns, as
in the earlier section. Sequential spawning is the conservative model. A host that runs an
entry's commands in parallel adds less.

| Event entry | Commands | p50 ms | p95 ms | Added p50 ms | Added p95 ms |
| --- | --- | --- | --- | --- | --- |
| Baseline, 1 x `node -e 0` | 1 | 44.3 | 104.7 | 0 | 0 |
| Baseline, 2 x `node -e 0` | 2 | 86.8 | 145.2 | 0 | 0 |
| PreToolUse, Bash `git status` (traceless, digest) | 2 | 107.1 | 185.2 | 20.3 | 40.0 |
| PreToolUse, Bash `git commit` (traceless, digest) | 2 | 171.5 | 270.0 | 84.7 | 124.9 |
| PreToolUse, all tools, `Read` (dispatch guard) | 1 | 52.9 | 109.6 | 8.6 | 4.9 |
| PreToolUse, all tools, `Agent` dispatch (dispatch guard) | 1 | 58.9 | 115.7 | 14.6 | 11.1 |
| PreToolUse, `SendMessage` (peer guard) | 1 | 66.5 | 117.1 | 22.3 | 12.4 |
| PostToolUse, `Edit` (index refresh, board write) | 1 | 261.7 | 365.9 | 217.5 | 261.3 |
| PostToolUse, `Edit`, `CODE_OPS_INDEX=off` | 1 | 67.5 | 115.8 | 21.4 | 21.3 |
| PostToolUse, all tools, `Read` (handoff card) | 1 | 50.1 | 97.3 | 5.8 | -7.4 |
| UserPromptSubmit (handoff card) | 1 | 56.5 | 112.2 | 12.2 | 7.6 |
| SessionStart (routing card) | 1 | 51.1 | 100.0 | 6.8 | -4.7 |
| SessionEnd (session receipt, board end) | 1 | 72.7 | 128.0 | 28.4 | 23.4 |
| SubagentStart (ladder card) | 1 | 49.3 | 98.9 | 5.1 | -5.8 |
| SubagentStop (subagent report) | 1 | 52.4 | 106.6 | 8.1 | 1.9 |

The `CODE_OPS_INDEX=off` row comes from the second run, which has its own baselines
(46.1 and 93.2 ms at p50; 94.6 and 144.3 ms at p95). The rest come from the default run.

The entries that fire together on one tool call, summed per pass:

| Tool call | Entries | Added p50 ms | Added p95 ms | Within 50 ms p95 |
| --- | --- | --- | --- | --- |
| `Bash` | Bash pre, all-tools pre, all-tools post | 43.0 | 13.9 | yes |
| Other (`Read`) | all-tools pre, all-tools post | 17.7 | -43.4 | yes |
| Message (`SendMessage`) | all-tools pre, message pre, all-tools post | 49.5 | -53.5 | yes |
| `Edit`, index on (default) | all-tools pre, edit post, all-tools post | 235.4 | 193.2 | **no** |
| `Edit`, `CODE_OPS_INDEX=off` | all-tools pre, edit post, all-tools post | 45.1 | -35.7 | yes |

**Reading the tail.** One `node -e 0` spawn had p50 44.3 ms and p95 104.7 ms, so tail noise is
about 60 ms per spawn. A p95 cell at or below zero means that noise exceeded the hook cost. Read
those cells as "no measurable p95 cost", not as a negative cost. The p50 cells are stable. Across
three runs of each setting, the edit entry added 186 to 220 ms at p50 with the index on, and 17 to
27 ms with it off.

**Result.** Every event is within the limit except the edit entry with the index on. That entry
added 217.5 ms at p50 and 261.3 ms at p95 per edit. The hook starts a second Node process to run
`context-query.mjs refresh`, so an edit pays two startups plus the refresh. The fixture holds two
files, so a larger repository costs more. The next largest costs are the `git commit` scan (84.7 ms
p50, two spawns) and SessionEnd (28.4 ms p50, which reads the whole transcript). SessionEnd runs
once per session, so it is off the per-call path. PR 11 must add its per-call cost to the `Bash`,
`Edit`, and message rows and re-run this bench with `--plugin-root` on its tree.

The p50 figures are **CONFIRMED** for this machine and run. The p95 figures are **PROBABLE**,
because tail noise on a loaded machine is large. The edit-entry finding with the index on holds at
both percentiles in all three runs.

### After PR 11 (C2, C3, C6), 2026-09-29

This subsection measures the cost PR 11 adds to each tool call: the collision note (C2), the change
feed (C3), and the push record (C6). It supersedes the PR 11 figures from earlier working runs.

**Method.** Node v24.16.0 on Windows 11 Pro, other work running on the machine. Before is a
detached worktree of `6722e28` (`main`), which has no collision or change-feed code. After is the
PR 11 working tree, uncommitted. Each pair ran the bench with
`--runs 100 --env CODE_OPS_INDEX=off --json`, before first, then after. The run used 3 pairs.
The other bench settings are unchanged from the section above. The fixture holds 5 live peers on
the branch and one seeded push event per peer. The push cases replay a real git push summary. The
`solo` cases run against an empty home with no other live session, and reset it before each run.
Reproduce the after side with `node scripts/bench-hooks.mjs --runs 100 --env CODE_OPS_INDEX=off`.

Each cell is the median over the 3 pairs of the added time per tool call, against the same number
of `node -e 0` spawns. The delta is the median over the pairs of after minus before per pair.

| Tool call | Before p50 ms | After p50 ms | Delta p50 ms | Before p95 ms | After p95 ms | Delta p95 ms (range) |
| --- | --- | --- | --- | --- | --- | --- |
| `Read` | 16.6 | 18.6 | 2.0 | -13.2 | -6.5 | 9.5 (-70 to 65) |
| Message (`SendMessage`) | 36.5 | 36.2 | -0.3 | -27.4 | -27.2 | 12.7 (-96 to 103) |
| `Bash` `git status` | 28.5 | 33.5 | 5.9 | 22.4 | 11.9 | -16.2 (-26 to 39) |
| `Edit`, index off | 37.3 | 58.2 | 20.9 | -11.4 | 8.8 | 29.0 (-91 to 118) |
| `Bash` `git push`, with peers | 29.6 | 176.8 | 148.5 | 24.0 | 183.0 | 159.0 (135 to 234) |
| `Bash` `git push`, solo session | 29.5 | 57.2 | 27.7 | 21.6 | 64.4 | 42.8 (-7 to 74) |

After p95 per pair: `Read` 51, -28, -7. Message 76, -49, -27. `Bash` `git status` 42, -3, 12.
`Edit` 107, -41, 9. Push with peers 231, 183, 181. Push solo 70, 64, 24.

The push cases, added time per entry (after side, median of 3 pairs): the pre entry with peers
adds 70.4 ms at p50 and 101.3 ms at p95. The post entry with peers adds 81.7 ms at p50 and 101.6 ms
at p95. The solo pre entry adds 18.2 ms at p50 and the solo post entry adds 24.5 ms. The `Edit`
collision entry adds 27.7 ms at p50.

**Floor.** One git spawn costs about one Node startup on this machine. Measured over 15 spawns
each, p50: `git --version` 38.6 ms, `git rev-parse` 36.8 ms, `git status` 39.4 ms, `git diff`
42.0 ms, and `node -e 0` 40.1 ms. So any hook that spawns git adds about 40 ms at p50 on its own,
plus about 10 ms to import the board reader. Limiting the pathspec and `--no-optional-locks` did
not move `git status`. A row that spawns git once cannot reach 50 ms at p95 here.

**Verdict per row against 50 ms added at p95.**

| Tool call | Verdict | Basis |
| --- | --- | --- |
| `Read` | within | Delta p50 2.0 ms. After p95 is at or below zero in 2 of 3 pairs. |
| Message | within | Delta p50 -0.3 ms. After p95 is at or below zero in 2 of 3 pairs. |
| `Bash` `git status` | within | Delta p50 5.9 ms. After p95 is 42 ms or less in every pair. |
| `Edit` | within, noisy | Delta p50 20.9 ms with no git spawn. After p95 is 107 ms in one pair and 9 ms or less in the others. |
| `Bash` `git push`, with peers | **over** | After p95 is 181 to 231 ms in every pair. Delta p50 is 148.5 ms. The pre entry keeps one `git status` spawn and the post entry keeps one `git diff` spawn. |
| `Bash` `git push`, solo session | borderline | Delta p50 27.7 ms. After p95 is 70, 64, and 24 ms, so 2 of 3 pairs sit above 50 ms. The baseline p95 alone ranged from 48 to 91 ms across pairs. |

**Result.** The push row with peers exceeds the limit at both percentiles. One git spawn costs
about 40 ms here, so no fix that keeps a spawn can meet the limit. On 2026-09-29 the operator
accepted the amended limit: it excludes calls that run git push, pull, merge, or rebase. Those
calls already wait on the network or on git itself. A push with no other live session spawns no
git. Every other row stays within the limit. The solo row needs a quieter machine to settle its p95.

**Confidence.** The p50 figures, the floor, and the spawn counts are **CONFIRMED** for this machine
and these runs. The p95 figures are **PROBABLE** at best, because one `node -e 0` spawn showed a
p95 near 90 ms in some pairs. Read a p95 cell at or below zero as no measurable p95 cost. The push
with peers verdict holds at p50 and p95 in all 3 pairs. Before this section, the working tree with
peers measured about 350 ms at p50 (unit E), so the change removed about 60% of the push cost and
did not remove the excess.

## Startup context

A lead's first turn measured 62,000 to 72,000 tokens. About 50,000 of that is the host system
prompt and tool schemas, outside this repository's control. The plugin skill and agent listings
add about 4,000, and `CLAUDE.md` about 2,400 after its trim. Three operator levers remain, and none
is automated. Disable unused desktop connectors per session. Enable `privacy-opsec-suite` and
`researcher` only in projects that use them. Keep `MEMORY.md` an index rather than a store.

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

## Program metric registry, 2026-10-06

This is the single registration of every metric the code-ops program redesign judges itself by.
Each entry names its data source, owner, baseline, and decision rule. The registration happens
before the changes ship, so no later number is invented or moved. Item ids refer to the checklist in
the run folder `80 Runs/2026-10-06-program-redesign/PLAN.md` (local, gitignored).

Four rules bind every entry:

- **No invented targets.** A decision rule that needs a threshold not yet measured reads "set
  from" a named measurement. That measurement happens before the change ships.
- **Baselines cite their report.** Each baseline names its run-folder report, window, and sample
  size. The reports are local and gitignored. They live in `80 Runs/2026-10-07-program-build/reports/`
  and `80 Runs/2026-10-06-program-redesign/reports/`.
- **Amend, never edit in place.** A change to a rule or baseline goes in a dated amendment under
  its entry.
- **The owner is the plan item's role.** The owner reads the metric and acts on its rule. The
  lead keeps acceptance.

### CI cost

**CI wall time per job.**

- **Source and owner.** Job `completed_at` minus `started_at` for every job of `validate.yml`,
  from `gh api repos/skylarsabo/code-ops/actions/runs/<id>/jobs`. Queue time is excluded. The
  explorer measures it (P0-M1). The implementer acts on it (P6-M1, P6-Rebalance).
- **Baseline.** Report D-002, 8 successful `pull_request` runs, 2026-10-01 to 2026-10-06. The
  critical path is `structural-lint-windows-shard-1` at a 285 s median (244 to 326 s). Its
  neighbors are Windows shard-4 at 217.5 s, shard-5 at 161.5 s, and shard-2 at 121 s. Ubuntu shard
  medians run 103.5 to 126 s. Windows shard-3 has a 24.5 s median and a 591 s maximum, from one run
  where the record-collection eval took 571 s. `host-evals-macos` is skipped on pull requests, so
  macOS has no sample.
- **Decision rule.** P6-Rebalance holds when every Windows job stays within the per-job target set
  from the P6 profile over repeated runs. A run with an outlier step is reported with its step, and
  it is not dropped from the sample.

**Weighted runner minutes per platform (proxy, not an invoice).**

- **Source and owner.** The same job records. Weighted minutes are each job rounded up to a whole
  minute, times a platform multiplier. The repository is public, and the run `/timing` endpoint
  reports `total_ms` 0, so standard runners are not billed. The figure is a load proxy. The
  implementer derives it (P6-Rebalance) in `.github/ci-budgets.json`.
- **Baseline.** Report D-002, same 8 runs. The median is 39 weighted minutes per run, from 38 to
  60. Windows carries about 75 to 80 percent of it. The multipliers (Ubuntu x1, Windows x2) and
  the rounding rule are **UNVERIFIED**, because D-002 did not fetch them. The GitHub Actions runner
  pricing documentation would verify them.
- **Decision rule.** P6-Rebalance holds when the median of at least 8 post-change runs does not
  exceed the baseline median of 39. The target is set from the P6 profile. Verify the multipliers
  against that documentation before any weighted figure is read as cost.

**Record-collections spawn count.**

- **Source and owner.** The spawn counter that P6-M2 adds to `evals/record-collections/run.mjs`,
  read per platform. The implementer owns it (P6-M2, P6-RecordFix).
- **Baseline.** Set from the P6 profile (P6-M2). No spawn count exists yet. The one related
  observation is the step time in Windows shard-3: 571 s in one run and 16 to 40 s in the other 7
  (report D-002).
- **Decision rule.** P6-RecordFix holds when the spawn count falls below the P6-M2 baseline, the
  `ok` line list is identical, and Windows and Ubuntu pass with the same coverage.
- **Parallel split (D-037), win32.** The eval now runs as 12 section children. Wall time fell from
  468.5 s serial to 237 to 255 s over three default runs, and to 236.5 s at `--jobs 4`. The
  `incremental` section, about 206 s, is the critical path. Spawns rose from 867 to 933 because each
  section builds its own fixture, so D-037 trades spawns for wall time and does not meet the spawn
  rule above. The `ok` line set is identical (268 lines). Against the old serial run, 2 lines print
  in a different position; `--serial`, the default, and `--jobs 4` print the same order. The Linux
  timings and the 271-case total are not yet measured.


### Report legibility and links

**Operative report anchor density.**

- **Source and owner.** The share of bullet findings of at least four words, outside code fences,
  that match `REF_RE` (`scripts/citation-lib.mjs:30`), per report. The D-003 definition counts
  every bullet of four or more words, so padding anchors or splitting bullets moves the share. The
  match checks form and does not check that the anchor resolves. The explorer measures it (P0-M2).
  The implementer acts on it (P5-U1-Cost).
- **Baseline.** Report D-003, the 40 newest reports by run-folder date, 2026-10-01 to 2026-10-06,
  of which 36 hold findings. Pooled, 231 of 889 findings are anchored (26.0 percent). The
  per-report distribution is minimum 0.0, first quartile 8.2, median 22.1, third quartile 36.6,
  maximum 60.7 percent. 7 of 36 reports have no anchored finding. One run dominates the sample, so
  it may not represent older reports.
- **Decision rule.** The P5-U1-Cost advisory stays when the per-report median share rises against
  the baseline in reports written after it ships. The count of reports with zero anchored findings
  is the paired reading and must not rise. The size of the rise is set from the baseline
  distribution before the advisory becomes anything stronger than a note.

**File:line link adoption.**

- **Source and owner.** The share of file references in operative reports and final replies written
  as `[name](repo-relative/path:line)`, against bare anchors. The link form is pinned at
  `evals/lint-plugins/run.mjs:106`. The implementer owns it (P5-U2-Links).
- **Baseline.** Not yet measured. It is measured on the report sample of D-003 before the standard
  ships.
- **Decision rule.** The standard stays when the link share of anchors rises in reports written
  after it ships. The size of the rise is set from the pre-ship measurement.

**Docs-standards alignment.**

- **Source and owner.** The count of standards that no other standard cross-references, from
  `scripts/check-docs-standards-alignment.mjs`. The reviewer owns it (P8-U5-Org).
- **Baseline.** Set by the first run of that check across every standard. The check does not exist
  yet.
- **Decision rule.** The check fails closed. A new standard with no cross-reference fails it, and no
  threshold applies.

### Direction and context

**Circling.**

- **Source and owner.** `git log` on `main` and the `RUN_LOG.md` and `TASKS.md` files under
  `80 Runs/`. The explorer measured it (P0-M3). `co churn` (`scripts/churn.mjs`, P4-U1-Dir)
  reports it, and `evals/churn/run.mjs` pins each signal on a scratch repository.
- **Reproduction.** Run `node scripts/churn.mjs 3c1fa907 --since 2026-09-06 --until 2026-10-06
  --runs "<root>/code-ops-docs/80 Runs"`, or the same arguments after `co churn`. The git measures
  reproduce D-009 exactly: 292 commits, 0 reverts, re-fix 115 of 144, and fix-of-fix 22 commits in
  18 of 61 PRs (restamp 21 commits in 17 PRs, fix 1 in 1). The run-folder measures read the live
  gitignored folders, and the command skips folders dated after `--until`. On the folders dated
  through 2026-10-06 it reports 83 `Next:` lines in 5 of 26 files (0 repeats), 74 ids, and 30 in both
  states. D-009 also read `2026-10-07-program-build`, which then held 3 `Next:` lines and 8 ids, and
  reported 86 lines in 6 of 27 files, 82 ids, and 31.
- **Baseline.** Report D-009, `origin/main` at `3c1fa907`, 2026-09-06 to 2026-10-06, 292 commits.
  The fix-of-fix count is 22 commits in 18 of 61 merged PRs (median 0, maximum 3). Of the 22, 21
  have subjects that start Restamp, Re-stamp, or Refresh. They are mechanical digest stamps, the
  class DS-3 automates. One starts Fix (PR 219). Reverts: 0 of 292 commits.
- **Readings.** Two readings replace the single count.
  - *Primary reading (review fixes).* PRs with a follow-up commit that is not a mechanical restamp.
    A review-fix commit counts in any position when its subject starts with Fix. The baseline is 1
    commit in 1 PR (PR 219). PRs 193 and 183 open with a Fix first commit, so the after-first-commit
    rule excludes them. Counting them, the baseline is 3 PRs, which `co churn` reports as
    `anyPositionPrs`. A subject that only names a review does not count. Three PRs (177, 178, 216)
    match "review" and none starts with Fix. The sample is too small to judge. The rule is set from
    a 30-day post-change window.
  - *DS-3 reading (restamps).* PRs with a restamp follow-up commit. The baseline is 17 of 61 PRs (PR 219 has no restamp follow-up)
    and 21 commits. This reading must fall after DS-3 lands.
- **Secondary measures.** The re-fix rate is 115 of 144 commits (79.9 percent), **PROBABLE**. It
  enters a decision only after a run over 2026-08-06 to 2026-09-05 supplies a comparison. The
  reopened-id proxy is 31 of 82 ids, an upper bound, **SPECULATIVE**, because ids repeat across
  programs. `co churn` reports it as `bothStates` and adds `reopened`, an id checked in an earlier
  folder and unchecked in a later folder of one program. It is 3 of 74 ids through 2026-10-06. The
  program is the folder name without its date and `-ho<n>`, so it undercounts a program whose
  folders carry different names. Repeated `Next:` lines are 0 of 86 across 6 files, which gives no signal. Report
  D-003 measured carry age in handoff hops. D-009 supersedes that measure.
- **Decision rule.** The median is 0, so each reading uses a PR count. DS-3 (P1-D3) holds when the
  DS-3 reading falls against 17 of 61 over a window that starts after it lands. The primary
  reading gets its rule from the 30-day post-change window, not from the baseline. A revert is
  reported in every window. The re-fix rate and the reopened-id proxy take no part in a decision
  until their comparison runs.

**Compaction fidelity.**

- **Source and owner.** Two readings. First, handoff fields that survive a simulated compaction,
  from the parity case in `evals/compact-snapshot`. Second, the stale and partial snapshot rate:
  the `COMPACT_SNAPSHOT.md` header against the transcript boundary rows, through `snapshotState`
  in `scripts/compact-snapshot.mjs`. The implementer owns it (P7-U5-Compact).
- **Baseline.** Set by the P7-U5-Compact eval and the first live compaction. No rate exists. Two
  observations exist and neither is a rate. On 2026-09-30 one session named every active item,
  constraint, and running agent after a compact, with agent ids missing (n=1). The paragraph
  "Compaction fidelity check (pre-registered)" above records it. On 2026-10-06 one
  card printed STALE for a fresh snapshot (report D-008). The probable cause is a race in
  `routing-card.mjs:266`, where SessionStart read the transcript before the host wrote the
  boundary row.
- **Decision rule.** P7-U5-Compact holds when every handoff field survives the simulated
  compaction and the race and partial cases pass. A false STALE card counts as a failure in every
  window. The live rate threshold is set from the first live compactions after the change ships.

**Ceiling breach rate.**

- **Source and owner.** `node scripts/context-audit.mjs --all`: the share of lead input tokens on
  turns above 300,000 tokens, the count of lead turns above 600,000, and compactions and handoffs
  per session. The maintainer owns it (P10-CtxCeiling).
- **Baseline.** The existing figures in the section "Pre-registered: context ceiling and wide-type
  deny" and in the handoff point baseline. The 10-day audit counted 2.68 billion of 3.69 billion
  lead input tokens above 300,000 and 1,942 lead turns above 600,000. The later 72-hour window
  put 19 percent of lead input above 300,000. The windows differ, so no trend is read from them.
- **Decision rule.** The decision rule of that section applies unchanged. P10-CtxCeiling chooses the
  ceiling value from the measured band distribution, and the operator approves the value.

**Tokens re-read per operative.**

- **Source and owner.** `repeatReads` from `scripts/context-audit.mjs`: characters re-read from a
  path already read in the same thread, split by operative thread. The maintainer owns it.
- **Baseline.** The all-thread figure from 2026-06-23 to 2026-09-02, in the baseline section above:
  152 paths read more than once, 207 extra reads, and 1,099,139 characters. It mixes leads and
  operatives and counts characters, not tokens. The per-operative split is not measured.
- **Decision rule.** A lever that claims fewer re-reads holds when re-read characters per
  operative thread fall against the per-operative baseline with the correctness gates green. The
  size of the fall needed is set from that baseline before the lever ships.

### Guard and workflow

**Workflow contract-line adoption.**

- **Source and owner.** The share of Workflow dispatches whose brief carries the Run-contract
  line. The source is the advisory in `dispatch-guard.mjs` and the compliance export of
  `scripts/context-audit.mjs`. The implementer owns it (P2-DS4PR2, P2-DS4PR4).
- **Baseline.** Not measured. The advisory does not exist yet. The first compliance counts are the
  baseline.
- **Decision rule.** The advisory ships with no probe dependency and never denies. A flip to deny
  waits on the P2-DS4P0 probe and decision-log evidence, and the operator decides. The adoption
  threshold for that flip is set from the first compliance counts.

**Guard denial rate.**

- **Source and owner.** Denials divided by decisions, per guard rule, from the decision rows that
  `dispatch-guard.mjs` emits. The rows hold counts and no brief text. The implementer owns it
  (P2-DS4PR1).
- **Baseline.** Not measured. No decision rows exist before P2-DS4PR1.
- **Decision rule.** This rate feeds the decision rules already registered for the dispatch guard
  and the context ceiling above. A threshold that those rules leave open is set from the first
  window of decision rows.

**Decision log counts.**

- **Source and owner.** The permanent counts row that `pruneOldDecisions` and `writeSummaryRow` in
  `scripts/context-audit.mjs` write. The implementer owns it (P2b-DecisionLog30d).
- **Baseline.** None yet. The first counts row lands in this section with P2b-DecisionLog30d.
- **Decision rule.** Rows older than 30 days are deleted. The counts row is written first and holds
  no text. The counts match before and after the deletion, and no copy of the deleted text remains.

**M5 ratchet counts.**

- **Source and owner.** `scripts/ratchet-cli.mjs` counts `fail()` sites and eval coverage. The
  counts are stored in `.github/ratchet-baseline.json`. The implementer owns it (P2-DS4PR5).
- **Baseline.** Set at creation of `.github/ratchet-baseline.json`. That file does not exist yet.
- **Decision rule.** The CI step "M5 gate ratchet" fails when a count falls below the stored
  baseline. A lower count enters only through a reviewed edit of the baseline file.

**M3 compliance counts.** The `compliance` subcommand of `scripts/context-audit.mjs` (P2-DS4PR4)
reads Claude and Codex transcripts and prints counts only: no prompt, command, brief, or result
text reaches its output. Each row below fixes its decision rule before any count exists, and the
first window of counts is the baseline. The implementer owns the subcommand. Subagent threads,
unreadable files, and Grok and opencode transcripts are counted apart as skipped, so a count never
mixes hosts silently.

- **Workflow launches with a Run-contract line.**
  - **Source and owner.** `workflow.withContract` over `workflow.launches` in the compliance
    output, per session. The implementer owns it (P2-DS4PR4).
  - **Baseline.** Not measured. The first compliance run is the baseline.
  - **Decision rule.** An advisory ignored on 80 percent or more of at least 10 Workflow launches
    is proposed for deny, and the operator decides (DS4 decision A). No other threshold is set.
- **Prose-rule lapses by session.**
  - **Source and owner.** Dispatches denied by the guard (`denied`), briefs without a
    `Round budget` line (`briefsWithoutRoundBudget`), and Workflow launches without a contract
    line, each per `sessionId`. The implementer owns it (P2-DS4PR4).
  - **Baseline.** Not measured.
  - **Decision rule.** A prose-only rule with 2 or more lapses across 2 or more sessions gets a
    code backstop if the check is mechanical, else a criterion with a named actor. The lapse
    counts come from this subcommand and the hand-written closeout self-audit (M7).
- **Authority-bearing shell commands per operator prompt.**
  - **Source and owner.** `authority` counts (`gitPush`, `ghPrCreate`, `ghPrMerge`, `ghRelease`)
    over `operatorPrompts`, per session. The implementer owns it (P2-DS4PR4).
  - **Baseline.** Not measured.
  - **Decision rule.** These counts inform the operator-gated permission ask rules (DS4 decision C)
    and set no threshold. The operator decides after the first window.

### Round budgets and report shape

The baselines below come from the D-016 report, `80 Runs/2026-10-07-program-build/reports/D-016.md`.
No unit recorded a size before P12-BudgetSize, so no per-size median exists. Every size defaults
to the dispatch guard's 40-round fallback, and the budget advisory in `scripts/route-unit.mjs`
stays silent until P12-M1d fills a median.

**P12-M1a report presence.**

- **Source and owner.** Ledger rows that name an artifact whose file exists and is nonempty, over
  all ledger rows that name an artifact. The agent ledger and the run folders are the source. The
  implementer owns it (P12-BudgetSize).
- **Baseline.** 65 of 83 raw, for 2026-08-18 to 2026-09-27 across 21 run folders (D-016). Most of
  the 17 misses are review files in subfolders the resolver skipped, so the raw rate understates
  presence.
- **Decision rule.** This rate informs only. Report failures are rare, so a deny gate on a missing
  report buys little (D-016). No threshold is set.

**P12-M1b round-budget stop.**

- **Source and owner.** Units whose report shows a stop phrase and a unit id, over listed units.
  The run-folder reports are the source. The implementer owns it (P12-BudgetSize).
- **Baseline.** 9 of 157, for 2026-08-18 to 2026-10-07 (D-016). It is an upper bound, because the
  CHECKPOINT and "reached the" phrases over-match. All 9 stops sit in the two newest run folders.
- **Decision rule.** A rise after the size defaults ship goes to the operator. Set the per-size
  budgets from P12-M1d, never from this count.

**P12-M1c agent terminal failure.**

- **Source and owner.** Agent ledger units with a failed or no terminal row, over dispatched units.
  The agent ledger is the source. The implementer owns it (P12-BudgetSize).
- **Baseline.** 9 of 1419, for the agent ledger 2026-09-30 to 2026-10-06 (D-016). Of the 9, 5 are
  failures, and all 5 are lead stops or superseded results.
- **Decision rule.** This rate informs only. A threshold, if one is ever wanted, is set from the
  first window after the size defaults ship.

**P12-M1d median rounds per recorded size.**

- **Source and owner.** The rounds each operative report states, grouped by the unit `size` in
  `RUN_CONTRACT.json` (S, M, or L). The implementer owns it (P12-BudgetSize).
- **Baseline.** None. No unit has recorded a size, so no median exists, and `SIZE_MEDIAN_ROUNDS`
  holds `null` for each size.
- **Decision rule.** After the first window with at least one recorded unit per size, set each
  size's `SIZE_MEDIAN_ROUNDS` and `SIZE_ROUND_BUDGET` value from that size's median, in one edit
  with a dated amendment here. Until then every size keeps the 40-round default, and
  `budgetAdvisory` returns no advisory.

### Quality ratchet

**R1 lapse rate.**

- **Source and owner.** The share of dispatched units whose report shows no R1 verdict, or shows a
  net-negative touched-file delta without a reason. The sources are the M7 self-audit R1 verdicts
  (P2-DS4PR5, P3-U3-QR) and the `scan-overbuild.mjs` advisory (P3-U2-QR). The maintainer owns it.
- **Baseline.** Not measured. No R1 verdict exists before P0-R1 lands. The first window after it
  is the baseline.
- **Decision rule.** R1 is unconditional with no threshold, so every lapse is a finding. The rate
  decides whether the P3-U1-QR examples and the P3-U2-QR advisory stay. They stay when the rate
  falls against the window before them.

**Code-standard violations.**

- **Source and owner.** Hits per merged PR from `scripts/scan-overbuild.mjs` on changed files,
  beside `lint-plugins.mjs` failures. The maintainer owns it (R2).
- **Baseline.** Not measured. It is set by running `scan-overbuild.mjs` over the D-009 window,
  2026-09-06 to 2026-10-06, before any rule reads it.
- **Decision rule.** The gates stay binary and are never weakened. This count informs only. A rise
  in hits per merged PR after a doctrine change goes to the operator.

### Documentation

**Redundancy baseline.**

- **Source and owner.** Redundant words and passages across authored docs and `CONVENTIONS.md`
  files. The measuring method is the D-016 method: 12-word shingles, counting passages of 40 or
  more words that two or more authored `.md` files share. `scripts/check-duplication.mjs`
  (P8-U1-Org) uses 40-word runs over a different file set and reports 13,973 words at 96178115,
  so it is a gate on the pinned passages and not this metric. The lead owns the reading
  (P8-U2-Org, report D-026).
- **Baseline.** Report D-016, re-run on the refutation: 9,103 redundant words in 65 passages,
  **CONFIRMED**. It excludes two superseded design documents, "Docs state and history" and the
  handoff fidelity design, as D-016 names them. The remaining classes are the `CONVENTIONS.md` pinned blocks,
  the global-contract overlap, and the 12-skill 52-word stanza. The earlier figure of 15,872
  words is superseded.
- **Reproduction (D-026, CONFIRMED).** The D-016 method gives 9,103 words in 65 passages at
  ba472ed0, the last commit before D-016 ran, and 15,872 words with nothing excluded. At 96178115
  it gives 12,383 words in 75 passages. The rise of 3,280 words has three causes: the touch-improve
  rule adds 204 to the `CONVENTIONS.md` blocks (PR 239), the per-host contract renders add 2,988
  to the global-contract overlap (PR 237), and CHANGELOG repeats add 88. `scripts/measure-redundancy.mjs`
  implements the method and reproduces both readings with `node scripts/measure-redundancy.mjs --rev ba472ed0`
  and `--rev 96178115`.
- **Classes, owners, and targets.**

  | Class | Words at 96178115 | Owner | Target |
  |---|---|---|---|
  | `CONVENTIONS.md` blocks | 4,097 | lint check 14 | Keep the 1,781 pinned words; pin or reference the rest |
  | Global-contract overlap | 3,974 | `render-global-contracts.mjs` | Keep, derived renders |
  | CHANGELOG repeats | 2,197 | plugin maintainers | Keep |
  | Other passages | 1,221 | none yet | Name an owner before setting a target |
  | Skill stanzas | 894 | skill authors | Fall by up to 804 words if replaced by a reference |

- **Decision rule.** The next reading uses the D-016 method on the same exclusions. A fall counts
  only when the pinned passages stay byte-identical. Excluding the derived renders from the metric
  is a method change, so it starts a new baseline and never counts as a fall.

## Round budget stops, 2026-10-08

This reading drove three changes: per-agent default round budgets in `scripts/route-unit.mjs`, a
dispatch guard warning that lets an operative finish before the hard stop, and a doctrine line on
unit size. The source is every subagent transcript under `~/.claude/projects/` modified in the 14
days to 2026-10-08, across all projects. The counts hold no transcript text. A warned operative
is one whose transcript holds the guard's "tool rounds used against" warning.

- **Warn rate.** 1,494 of 3,761 operatives hit the warning (40%). Implementers: 1,120 of 2,496
  (45%), median 39 tool calls against a median budget of 40. The run-folder count in P12-M1b (9 of
  157) understates the stop rate, because most stops leave no report phrase it matches.
- **Budget size does not move the rate.** The warn rate stays between 30% and 50% for every brief
  budget from 25 to 80. Leads scale the unit to the budget.
- **The warning acted as the stop.** A warned operative made a median of 1 call after the warning,
  and its turns stopped at a median of 1.03 times the budget, though the hard stop sits at 1.5
  times. The warning told the operative to return.
- **Calls, not turns.** The median operative makes 1.00 tool calls per turn. Batching would not
  help, because the guard counts each call.
- **Relaunch length.** For 607 partial stops with an identifiable continuation, the continuation
  made a median of 37 calls (0.89 times the original budget). Only 94 (15%) would have fit inside
  the unused half of the original allowance. The match is heuristic, so this row is PROBABLE.
- **Measured spend per agent type.** Median and p90 tool calls: implementer 39 and 66, explorer 28
  and 40, reviewer 22 and 40, rigor tracer 30 and 42, rigor verifier 23 and 31, mech 12 and 32,
  web-researcher 15 and 28, probe 13 and 27, mech-review 6 and 12. `AGENT_ROUND_BUDGET` sets each
  default near the p90.
- **Recorded sizes.** 16 of 3,761 briefs carried a `Size:` line, so P12-M1d still has no median.
- **Decision rule.** Rerun this reading over the 14 days after the change ships. Success is an
  implementer warn rate under 25% with no rise in the median calls per finished unit. A warn rate
  that stays near 45% means leads still scale units to the budget, and the doctrine line on
  splitting units is the next lever.
