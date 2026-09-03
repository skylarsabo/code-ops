# Standard Operating Mode

This page is the single source of truth for what to reach for by default. It decides
which route handles a task, how work is delegated once a route is chosen, and what
counts as finishing. Read it before starting substantive work in any repository.

## Task type to route

| Task type | Route |
| --- | --- |
| Debug a bug | `/code-ops-suite:debug` |
| Ship a feature or change | `/code-ops-suite:ship` |
| Audit or quality sweep | `/code-ops-suite:full-sweep` or `/rigor:rigor-sweep` |
| Privacy or leak concern | `/privacy-opsec-suite` skills |
| Library or dependency decision | `/researcher:library-eval` |
| Claim verification | `/researcher:research-verify` |
| Docs vault work | `/code-ops-suite:vault` |
| Standardization check or repair | `/code-ops-suite:conform` |
| Everything (broad, multi-domain) | `/code-ops-suite:everything` |

## The tier and effort rule

Set tier by quality, not by price. Judgment-bearing operative work runs at the strong
tier whatever tier the lead runs at. Tracing, review, verification, and any
implementation carrying an open question all count as judgment-bearing. A shallow or
failed operative report costs a redispatch round trip plus the lead's attention, which
is dearer than the strong tier's price premium. Only mechanical, low-ambiguity work
drops a tier, and nothing runs below the lint-enforced `AGENT_MODEL_FLOORS`.

Set effort by ambiguity, not by importance. Mechanical work runs at low effort.
Single-claim and execution-only work runs at medium. Hard-to-reverse tracing and review
run at high. Verdicts and acceptance of an operative's report stay with the lead, at the
highest tier present in the session. Tier and effort partially substitute for one
another, so a stronger model at medium approximates a mid model at high. See
[subagent-trade-offs.md](../Techniques/subagent-trade-offs.md) for the table backing this
rule and for the floor values themselves.

## The ordered objective and the code-economy ladder

Every implementation route carries one ordered objective and one ladder. The objective
is ordered: correctness and the safety floor, then module boundaries, then measured
performance on hot paths, then readability, then size. Fewer lines wins only between
candidates equal on the first four. Before writing code, climb the ladder. Ask whether
the code needs to exist, because scope is the request. Ask whether it exists here, and
search before you write. Ask whether the standard library, the platform, or an installed
dependency does it, verified against current documentation rather than memory. Ask
whether it fits inside the owning module, and extend before you add a file. Extract only
on evidence, meaning a second caller, a unit that needs its own test, or a file past the
repository's own size norm. Then write the minimum edge-case-correct implementation, and
mark a deliberate simplification with a `deferred(<ceiling>, <upgrade path>)` comment.
`co scan overbuild --git <range>` is the mechanical floor under the ladder, advisory on
every tell except an unrecorded dependency, and `co scan deferrals` collects the markers
into `DEFERRALS_REGISTER.md`.

Chapter 12 of this handbook owns context and code economy in full: the output digest,
the symbol index, the ladder card, and the session receipts, each on by default with a
named off switch. For the switch values themselves, see
[INFRASTRUCTURE.md](../../50 Platform/INFRASTRUCTURE.md).

## We do not close early

A line of inquiry closes on one of two things: evidence that it is exhausted, or a
recorded decision to stop. It never closes on convenience, and never on the first
plausible stopping point. The first plausible answer is a candidate, not a conclusion.

This rule binds hardest on research fronts, where nothing external tells you the question
is answered. It also binds on review loops. Converged means the reviewer finds nothing on
a fresh pass, not that the operator tired of the loop. A loop that stops while findings
are still arriving has been abandoned, not closed.

Deferring is legitimate. Record a deferral with the reason and the route back: the
artifact to resume from, and the condition that reopens it. A deferral carrying neither
is an abandonment under a better name.

## The declared exception

Ad-hoc pipelines are hand-assembled tool sequences used instead of an existing skill.
They are the declared exception, used only when no existing skill fits the task. Say so
when you run one.

## Related techniques

- [dispatch-brief-template.md](../Techniques/dispatch-brief-template.md): how to write an operative brief.
- [skill-composition.md](../Techniques/skill-composition.md): how skills invoke each other.
- [context-hygiene.md](../Techniques/context-hygiene.md): keeping a long run's spend linear.

*Verified-at: b0ffede*
