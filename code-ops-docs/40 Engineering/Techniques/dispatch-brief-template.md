# Dispatch brief template

Every subagent the orchestrator spawns gets a brief carrying the same seventeen fields, plus a Wide-surface reason line when it needs a
wide agent type. A
missing field is the usual cause of a subagent guessing instead of escalating, or of two
subagents clobbering one file. This page holds the fill-in skeleton, one line per agent
kind, and a worked example.

## The skeleton

```
Objective: <one sentence: what this subagent must determine or produce>
Scope: <target files or dirs, explicitly disjoint from any sibling dispatch in this wave>
Context: <pointer into the repo map or IMPORT_GRAPH relevant to Scope: a path, not a paste.
  Name the `context-query.mjs` command that answers the structural question, not its output>
Effort: <default per agent-kind routing (see subagent-trade-offs.md); override only with a stated reason>
Routing rationale: <why this task needs this role, tier, and effort>
Focused checks: <exact checks for this scope; do not repeat unchanged inputs>
Check binding: <input snapshot or diff plus environment or receipt anchor>
Final gate owner: <lead, tool, reviewer, or user; executes the final required gates, while the lead accepts every unit>
Expected return:
  - sections + finding tiers (CONFIRMED / PROBABLE / SPECULATIVE)
  - dense, file:line cited, no raw dumps
Report path: <exact file inside the run folder, e.g. `80 Runs/<date slug>/reports/D-NNN-<role>.md`.
  With a write tool: write the full report there, then return only the path, a one-line verdict,
  and counts. Without one: return the full report inline>
Batching: request every independent item in one tool round; wait only on true dependencies
Round budget: <tool rounds this unit should finish inside, 40 unless stated; past it the operative
  checkpoints done, remaining, and the exact next action to the Report path, then returns>
Report cap: <at most N words for the returned report, at or under the agent definition's own cap>
Wide-surface reason: <only for a general-purpose, claude, fork, or unnamed agent type: why no
  suite agent fits; without this line the dispatch guard denies the dispatch>
Size discipline: <implementer briefs only: correctness and the safety floor, then boundaries, then
  measured performance, then readability, then size; mark a deliberate simplification
  deferred(<ceiling>, <upgrade path>)>
Escalation: <what counts as blocked or ambiguous for this task, and that it must escalate
  rather than guess>
Constraints: <do-not-touch list; no commits unless this brief explicitly says so>
Independence: <unit ids this operative validates but did not discover; empty for discovery>
```

Objective and Scope bound the work. Context points at orientation material instead of
re-explaining the codebase. Expected return sets the report shape, so the orchestrator
merges reports without re-deriving their structure. Report path puts the report on disk
without the lead re-emitting it. Escalation and Constraints keep a
subagent from improvising past what it was asked. Independence separates validation from
discovery. Round budget caps the context one operative accumulates, because every turn
re-reads all of it. The lead continues a checkpointed unit in a fresh operative, and splits a
unit that needs a second continuation. Report cap bounds the report the lead re-reads on every
later turn. Each agent definition already carries its own cap, 600 words for `reviewer`,
`privacy-reviewer`, and `implementer` and 400 for every other agent, and a brief may set a
smaller one. The lead dispatches in the background
and continues independent work, and it waits only when the next step depends on the result.

Three rules bind every dispatch. Always spawn a fresh operative with a brief rather than
forking or resuming one, because a fork or a resume starts from the context it inherited
instead of from the brief. Select each dispatch from the work and declared floors. A model
override is allowed only when the brief names its routing rationale, because it replaces the
agent definition's default tier.
A controller that knows the exact host agent ID can bind its Round budget with
`dispatch-guard.mjs register --agent-id <id> --budget <calls>`. Otherwise, a host that
supplies `agent_id` uses the environment/default counter and hosts without that identity keep
the fallback. A number in a brief never binds the hook by itself. The unregistered counter denies at twice
the budget. The hook denies a lead dispatch of a `general-purpose`, `claude`, `fork`, or unnamed
agent type unless the brief carries a `Wide-surface reason:` line, so dispatch a suite agent
instead wherever one fits. It also denies a new dispatch past the context ceiling, 300,000
tokens by default, until `/code-ops-suite:handoff assess` runs. It flags a dispatch that
overrides a tier or names no Round budget.

For a contract-backed dispatch, do not paste the canonical context bundle into the brief. Compile a bounded unit view with `co context bundle view`, place stable invariant files before unit-specific files, and build the exact payload with `co context brief build`. Verify its receipt with `co context brief verify` immediately before dispatch. The compiler fails on any prefix, unit, or total byte-budget breach rather than truncating a file. Reuse a check only when its input snapshot and environment binding both match; HEAD alone does not bind a dirty worktree.

## Where the report lands

Calibration lesson L-050 found that a lead re-emitting each report to persist it doubled the
report tokens at the most expensive tier. The Report path field removes that cost. The rule
itself lives in each plugin's `CONVENTIONS.md` under "Persist reports as they land".

The named path governs over any default reporting instruction in the agent definition.

- **Operative with a file-write tool** (shipped: verifier and implementer; any host agent that can write
  files): write the full report to the named path. Return a pointer of three lines at most:
  the path, a one-line verdict, and counts such as findings per tier.
- **Operative without a file-write tool** (shipped: explorer in code-ops-suite and
  privacy-opsec-suite, reviewer, privacy-reviewer, tracer, gatherer, claim-checker): return
  the full report inline. The lead writes it to the named path in the turn it arrives.
- **The lead, either way:** gate the file before the unit counts as covered. In code-ops-suite,
  run `dispatch-ledger.mjs update --status reported --report <path> --sections <names>`. A
  missing, empty, or section-less file fails the gate, and the row stays unreported. The lead
  opens the body only when synthesis needs it.

## What the Context line points at

Name a query, never a pasted map. `scripts/context-query.mjs` answers a structural
question with `file:line` anchors, so the operative reads the ranges it needs:

- `find <symbol>` lists every definition of a name.
- `callers <symbol>` and `callees <symbol>` give the edges around one definition.
- `blast <path>` lists the files that import a path, transitively to `--depth`.
- `explore "<terms>"` ranks definitions and lines matching every term, inside a byte budget.

Each command is also reachable as `co context query <command>`. The `PostToolUse` hook
`index-refresh.mjs` re-indexes each edited file, so the answers track the live tree. That
hook is on by default. To silence it, set `CODE_OPS_INDEX` to `off`, `0`, or `false` in
the `env` block of a `.claude/settings.json`. The index contract lives in
[CONTRACTS.md](../../35%20Contracts%20and%20Data/CONTRACTS.md), and the switch lives in
[INFRASTRUCTURE.md](../../50%20Platform/INFRASTRUCTURE.md).

## Notes per agent kind

- **explorer**: breadth over a disjoint slice, read-only. Report structure and `file:line`
  pointers, never edit.
- **tracer**: one control-flow or data-flow path end to end. Separate what was verified by
  reading from what was inferred.
- **reviewer**: a specific diff or file group. Group findings as Blocking, Should-fix, and
  Nit, in priority order.
- **verifier**: reproduce or kill by execution. Return the real command and its real output
  as the receipt, never a claimed result.
- **gatherer and claim-checker**: research one claim or source against the codebase and its
  history. Never reach the network directly.
- **implementer**: one bounded build, fix, or refactor unit with a disjoint Scope. Use it
  instead of a general-purpose agent, whose full tool surface costs about 35,000 more tokens
  on every turn. Name the verification commands and the Round budget.
- **mech**: an exact edit spec with no ambiguity to resolve. Transcribe the diff as briefed
  and report what changed.

## The ladder card an implementer also receives

An implementer-class subagent gets the code-economy ladder at `SubagentStart`, from the
hook `ladder-card.mjs`, in at most ten lines. The card is on by default. To silence it,
set `CODE_OPS_LADDER_CARD` to `off`, `0`, or `false` in the same `env` block. A brief still
carries its own Size discipline line, because the card states the ladder and the brief
states this task's ceiling.

## Who closes a finding

A subagent that hits a question the brief does not answer stops and escalates rather than
guessing. Judgment work stays with the highest-tier model present in the session:
assigning CONFIRMED, accepting a verdict, and deciding a finding is done. Subagents
execute the run and report evidence. They do not close the loop on their own findings.

## Example

```
Objective: Confirm whether the retry helper in src/net/retry.ts swallows a
  cancellation error instead of propagating it.
Scope: src/net/retry.ts, src/net/retry.test.ts (no other files)
Context: repo map §"net" section; run `co context query callers withRetry` for the
  call sites rather than pasting IMPORT_GRAPH
Effort: medium (default for verifier-shaped execution)
Expected return: CONFIRMED/PROBABLE/SPECULATIVE verdict, file:line evidence, one
  paragraph max, no pasted source.
Report path: 80 Runs/2026-09-14 retry-audit/reports/D-004-verifier.md (write it, then
  return the path, the verdict, and the command count)
Round budget: 15 tool rounds
Report cap: 150 words
Escalation: if the swallow looks intentional (a comment or test asserts it), stop
  and report that instead of guessing at intent.
Constraints: do not edit retry.ts; no commits.
```

*Verified-at: b0ffede*
