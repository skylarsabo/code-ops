# Dispatch brief template

Every subagent the orchestrator spawns gets a brief carrying the same nine fields. A
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
Expected return:
  - sections + finding tiers (CONFIRMED / PROBABLE / SPECULATIVE)
  - dense, file:line cited, no raw dumps
Batching: request every independent item in one tool round; wait only on true dependencies
Size discipline: <implementer briefs only: correctness and the safety floor, then boundaries, then
  measured performance, then readability, then size; mark a deliberate simplification
  deferred(<ceiling>, <upgrade path>)>
Escalation: <what counts as blocked or ambiguous for this task, and that it must escalate
  rather than guess>
Constraints: <do-not-touch list; no commits unless this brief explicitly says so>
```

Objective and Scope bound the work. Context points at orientation material instead of
re-explaining the codebase. Expected return sets the report shape, so the orchestrator
merges reports without re-deriving their structure. Escalation and Constraints keep a
subagent from improvising past what it was asked. The lead dispatches in the background
and continues independent work, and it waits only when the next step depends on the result.

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
Escalation: if the swallow looks intentional (a comment or test asserts it), stop
  and report that instead of guessing at intent.
Constraints: do not edit retry.ts; no commits.
```

*Verified-at: b0ffede*
