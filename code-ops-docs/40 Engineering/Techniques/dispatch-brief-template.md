# Dispatch brief template

Every subagent the orchestrator spawns gets a brief with the same six sections. A
brief that is missing one of these is the usual cause of a subagent guessing instead
of escalating, or two subagents clobbering the same file. This page is the fill-in
skeleton, one line per agent kind on what changes, and a short worked example.

## The skeleton

```
Objective: <one sentence — what this subagent must determine or produce>
Scope: <target files or dirs — explicitly disjoint from any sibling dispatch in this wave>
Context: <pointer into the repo map or IMPORT_GRAPH relevant to Scope — a path, not a paste>
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

Objective and Scope bound the work; Context points at orientation material instead of
re-explaining the codebase; Expected return sets the report shape so the orchestrator
can merge without re-deriving structure; Escalation and Constraints are the guardrails
that keep a subagent from improvising past what it was asked. The lead dispatches in the
background and continues independent work; it waits only when the next step depends on
the result.

## Per-agent-kind notes

- **explorer** — breadth over a disjoint slice, read-only; report structure and
  file:line pointers, never edit.
- **tracer** — one control- or data-flow path end-to-end; distinguish verified-by-reading
  from inferred.
- **reviewer** — a specific diff or file-group; findings grouped Blocking / Should-fix /
  Nit, prioritized.
- **verifier** — reproduce-or-kill by execution; return the real command and real
  output as the receipt, never a claimed result.
- **gatherer / claim-checker** — research a specific claim or source against the
  codebase and history; never reach the network directly.
- **mech** — an exact edit spec only, no ambiguity to resolve; transcribe the diff as
  briefed and report what changed.

## Escalation and judgment

A subagent that hits a question the brief does not answer stops and escalates rather
than guessing. Judgment work — assigning CONFIRMED, accepting a verdict, deciding a
finding is done — stays with the highest-tier model present in the session; subagents
execute the run and report evidence, they do not close the loop on their own findings.

## Example

```
Objective: Confirm whether the retry helper in src/net/retry.ts swallows a
  cancellation error instead of propagating it.
Scope: src/net/retry.ts, src/net/retry.test.ts (no other files)
Context: repo map §"net" section; IMPORT_GRAPH shows retry.ts consumed only by
  src/net/client.ts
Effort: medium (default for verifier-shaped execution)
Expected return: CONFIRMED/PROBABLE/SPECULATIVE verdict, file:line evidence, one
  paragraph max, no pasted source.
Escalation: if the swallow looks intentional (a comment or test asserts it), stop
  and report that instead of guessing at intent.
Constraints: do not edit retry.ts; no commits.
```

*Verified-at: d1d86c0*
