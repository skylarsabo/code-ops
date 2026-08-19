# Standard Operating Mode

This page is the SSOT for what to reach for by default: which route handles a given
task, and the tier/effort rule that governs how work is delegated once a route is
chosen.

## Task type → route

| Task type | Route |
| --- | --- |
| Debug a bug | `/code-ops-suite:debug` |
| Ship a feature/change | `/code-ops-suite:ship` |
| Audit/quality sweep | `/code-ops-suite:full-sweep` or `/rigor:rigor-sweep` |
| Privacy/leak concern | `/privacy-opsec-suite` skills |
| Library/dependency decision | `/researcher:library-eval` |
| Claim verification | `/researcher:research-verify` |
| Standardization check or repair | `/code-ops-suite:conform` |
| Everything (broad, multi-domain) | `/code-ops-suite:everything` |

## Tier and effort rule

Tier is set by quality, not by price. Judgment-bearing operative work — tracing,
review, verification, implementation with any open question in it — runs at the
strong tier (opus) regardless of which tier the lead is on: a shallow or failed
operative report costs a redispatch round-trip plus the lead's attention, which is
dearer than the strong tier's price premium. Only mechanical, low-ambiguity work
(transcription-style edits, structural mapping, breadth scans) drops a tier, and
nothing ever runs below the lint-enforced `AGENT_MODEL_FLOORS`.

Effort is set by ambiguity, not importance:
mechanical/low-ambiguity work runs low effort, single-claim or execution-only work
runs medium, hard-to-reverse tracing/review runs high. Verdicts
(CONFIRMED/PROBABLE/SPECULATIVE) and acceptance of a subagent's report stay with the
lead, at the highest tier present in the session. See
[subagent-trade-offs.md](../techniques/subagent-trade-offs.md) for the full table
backing this rule.

## We do not close early

A line of inquiry closes on one of two things: evidence that it is exhausted, or a
recorded decision to stop. It never closes on convenience, and never on the first
plausible stopping point. The first plausible answer is a candidate, not a conclusion.

This binds hardest on research fronts, where nothing external tells you the question is
answered. It also binds on review loops: converged means the reviewer finds nothing on a
fresh pass, not that the operator tired of the loop. A loop that stops while findings are
still arriving has been abandoned, not closed.

Deferring is legitimate. Record it as a deferral, with the reason and the route back —
the artifact to resume from, and the condition that reopens it. A deferral with neither
is an abandonment wearing a better name.

## Related techniques

- [dispatch-brief-template.md](../techniques/dispatch-brief-template.md) — how to write an operative brief.
- [skill-composition.md](../techniques/skill-composition.md) — how skills invoke each other.

## The declared exception

Ad-hoc pipelines (hand-assembled tool sequences instead of an existing skill) are the
declared exception, used only when no existing skill fits the task.

*Verified-at: 09df64b*
