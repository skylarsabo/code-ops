# Applying the quality lenses

The quality lenses are a decision aid for where to spend review attention, not a checklist
to tick top to bottom. Read this page before scoping any review or audit. It teaches which
lenses apply to a given stack, and how to weight the ones that do.

## Exec summary (stop here if that is all you need)

The suite defines eleven quality lenses in
[code-ops-suite `CONVENTIONS.md` §10](../../../plugins/code-ops-suite/CONVENTIONS.md).
Skills reference them by name and apply "the ones relevant to the task and the project".
That phrase is the whole point. The lenses are a menu, not a mandatory pass.

Two moves turn the menu into a plan:

1. **Decide which lenses apply.** A lens applies when your stack has the surface it
   inspects. Two of the eleven are explicitly conditional in §10: UI/UX, styling and
   accessibility *(if the project has a UI)*, and Privacy and data handling *(scaled to how
   much personal or sensitive data the system handles)*. The rest apply wherever their
   surface exists. Drop the ones whose surface your code does not have, and say so.
2. **Decide how to weight the ones that apply.** Rank by the suite's priority formula,
   impact × reach ÷ effort, weighted by confidence, with severity as a floor
   ([§8](../../../plugins/code-ops-suite/CONVENTIONS.md)). Severity sets a minimum. The
   formula orders everything above that floor.

One rule rides on top of the Security lens and applies to any control, gate, or invariant
you review. It is the multi-boundary control-coverage rule: enumerate every entry point
that can reach the protected action, and verify the control at each. Verified at one
boundary but not enumerated is a finding, not a pass
([§10](../../../plugins/code-ops-suite/CONVENTIONS.md)).

To pick the command that applies the right lenses for your goal, use the
[command router](../Handbook/commands/README.md).

---

## The eleven lenses

These are the shared definitions from
[code-ops-suite `CONVENTIONS.md` §10](../../../plugins/code-ops-suite/CONVENTIONS.md),
quoted by name. Each lens is a family of failure modes, a way the code can be wrong, not a
single check.

| Lens | What it inspects | Conditional? |
| --- | --- | --- |
| **Modularity & architecture** | Coupling/cohesion, dependency direction, leaky abstractions, circular deps, duplication, dead code, unclear boundaries, config sprawl. | No |
| **Size and boundary** | The change is the smallest that satisfies the ordered objective (§11). No new file, interface, wrapper, or dependency without the ladder's evidence. Boundaries unchanged unless the task is a boundary change. | No |
| **Performance** | Algorithmic complexity, N+1/over-fetching, blocking-on-async, missing/incorrect caching, allocations & leaks; for UIs, bundle size, render thrash, asset weight. | No |
| **Efficiency / resource use** | Redundant work, chatty I/O, hot-path logging, unpooled/unclosed resources, slow/redundant CI. | No |
| **Correctness & intricate bugs** | Races/TOCTOU, off-by-one/overflow/rounding, timezone/locale, null/coercion traps, swallowed errors, missing rollback/cleanup, non-idempotent retries, illegal states, contract/serialization mismatches. | No |
| **Security** | Injection, XSS/SSRF/CSRF, IDOR, authn/authz, session/cookies, crypto, secrets handling, input validation/output encoding, security headers, rate limiting. Carries the multi-boundary control-coverage rule (below). | No |
| **Privacy & data handling** | Data minimization, PII in logs/telemetry/errors, third-party data egress, identifiers/correlation/fingerprinting surface, metadata leakage, retention/deletion, anonymization quality, private-by-default posture. | **Scaled** to how much personal/sensitive data the system handles. |
| **UI/UX, styling & accessibility** | Design tokens vs. hardcoded values, theme parity, component reuse, state coverage (loading/empty/error/success), responsiveness, a11y (contrast, focus, keyboard, ARIA, reduced-motion), consistent copy. | **Only if the project has a UI.** |
| **Testing & reliability** | Coverage on critical/risky paths, flaky or assertion-free tests, missing edge/error tests, observability gaps. | No |
| **Documentation accuracy** | Docs vs. code, stale/contradictory content, dead setup steps, diagrams vs. reality. Carries the claims-vs-enforcement check: a doc, comment, contract, or JSDoc asserts X while the adjacent code, schema, migration, or type enforces Y. | No |
| **Dependencies & supply chain** | Outdated/deprecated/duplicate deps, known CVEs, license concerns, unused deps, risky floating versions. | No |

§10 opens with the operative instruction: *"Apply the ones relevant to the task and the
project."* The lenses that are not marked conditional still apply only where their surface
exists. A library with no network egress does not get a meaningful SSRF check, and a repo
with no CI does not get the slow-CI efficiency check. The discipline is the same for all
eleven. Apply a lens when the code gives it something to inspect, then state which lenses
you applied and which you did not. That is the self-scoping habit the suite expects of
every assessment.

---

## Step 1: decide which lenses apply

The question for each lens is narrow. Does my stack have the surface this lens inspects?
Three cases follow.

### Conditional lenses, gated by surface

Two lenses are explicitly conditional in §10, and the condition is the decision:

- **UI/UX, styling & accessibility** applies only if the project has a UI. A headless
  service, a CLI with no rendered surface, or a pure library does not get the lens. The
  moment a rendered surface exists, the lens applies in full, accessibility included. A web
  app, a desktop UI, and an email template all count.
- **Privacy & data handling** is scaled to how much personal or sensitive data the system
  handles. The lens is a range, not a switch. A stateless transform over non-personal data
  gets a light pass, mostly asking whether it accidentally starts logging or egressing
  something. A system holding PII, health, financial, or location data gets the full lens,
  weighted heavily: minimization, retention, egress, and correlation surface. The more
  sensitive the data, the more weight the lens carries, up to becoming the dominant lens
  for the run.

> When a project's privacy or anonymity needs are first-class, the dedicated
> privacy-opsec-suite anonymity track applies the privacy lens at depth: a threat model,
> the six leak audits, fail-closed hardening, and the PR and authorship gates. The §10
> privacy lens is the breadth version. Reach for the dedicated track when the data demands
> it, and see the [command router](../Handbook/commands/README.md) for the hand-off.

### Unconditional lenses, gated by whether the surface exists

The other nine apply wherever their surface is present. They are not conditional in the
§10 sense, but reality still scopes them:

- **Security** scales with attack surface. An internet-facing endpoint that takes untrusted
  input gets the full lens. An internal pure function does not get a SQL-injection check it
  cannot have.
- **Performance** and **Efficiency** sharpen on hot paths and resource-bound code. A config
  loader run once at startup is not where they pay off.
- **Size and boundary** applies to any change that adds code. It is strongest on a diff,
  where the ladder's evidence for a new file, interface, wrapper, or dependency is either
  present or missing.
- **Dependencies & supply chain** applies to anything with a dependency manifest. A
  zero-dependency module mostly clears it.
- **Documentation accuracy** applies wherever docs make claims about the code.

### State what you skipped

Skipping a lens is a decision you record, not a gap you leave silent. The suite's
self-scoping convention says each assessment "states what it covered and what it did not"
([§13](../../../plugins/code-ops-suite/CONVENTIONS.md), the documentation-quality standard,
where the rule is explicit for the generators). It applies to lens selection too. "No UI
present, so the UI/UX/a11y lens does not apply" is a legitimate, useful line in a report.
An unexplained absence is not.

---

## Step 2: weight the lenses that apply

Selection tells you which lenses are in play. Weighting tells you where to go deep. The
suite gives one ordering rule, in
[§8](../../../plugins/code-ops-suite/CONVENTIONS.md):

> Rank by **impact × reach ÷ effort** (weighted by confidence), with **severity as a floor**.

Read it as two pieces working together.

### Severity is a floor, not a sort key

Severity is the [§8](../../../plugins/code-ops-suite/CONVENTIONS.md) scale: critical (data
loss or leak, security breach, corruption), high, medium, low, and nit. It sets a minimum
priority. A critical finding cannot be buried under a pile of cheap, high-reach nits, no
matter what the formula computes. It does not by itself order the list. Two critical
findings are both above the floor, and the formula decides which you do first.

Severity and the formula are separate for that reason. Severity answers "can this be
ignored?", and the answer is no if it is critical. The formula answers "of the things that
cannot be ignored, what is the best use of the next hour?"

### The formula orders everything above the floor

Rank by impact × reach ÷ effort, weighted by confidence:

- **Impact**: how bad is it when it bites? A corrupted invoice total outranks a misaligned button.
- **Reach**: how many users, requests, or code paths does it touch? Every checkout outranks one admin screen.
- **Effort**: how much work to fix? A cheap fix to a real problem outranks an expensive fix to a slightly worse one.
- **Confidence**: how sure are you? A `CONFIRMED` finding (reproduced) outweighs a `SPECULATIVE` lead at the same nominal impact.

Confidence is where the evidence tiers feed in. See
[evidence and tiers](../Handbook/05-evidence-and-tiers.md) and the
[disconfirmation pass](disconfirmation-pass.md) for how a finding earns its tier.

The practical effect across lenses is a sorting one. A lens that is in play but surfaces
only low-impact, low-reach findings sinks. A lens that surfaces a high-impact, high-reach,
cheap-to-fix defect rises to the top of the run, whichever lens it came from. You do not
pre-rank the lenses. You rank the findings the lenses produce, and the high-value findings
pull their lens to the front. Lead the deliverable with a ranked top N
([§8](../../../plugins/code-ops-suite/CONVENTIONS.md)).

```mermaid
flowchart TD
  L[Eleven lenses §10] --> A{Surface exists for this lens?}
  A -->|no| S[Skip; state it explicitly]
  A -->|yes, conditional| C{UI present? / data sensitivity?}
  A -->|yes, unconditional| W
  C --> W[Lens applies]
  W --> F[Findings, each tiered]
  F --> SEV{Severity floor}
  SEV -->|critical| TOP[Cannot be buried]
  SEV -->|below critical| RANK[Rank by impact × reach ÷ effort, weighted by confidence]
  TOP --> RANK
  RANK --> N[Ranked top-N deliverable §8]
```

---

## The size-and-boundary lens

The lens asks one question of a change: is this the smallest change that satisfies the
ordered objective? The objective order is fixed in
[§11](../../../plugins/code-ops-suite/CONVENTIONS.md): correctness and the safety floor,
then module boundaries, then measured performance on hot paths, then readability, then
size. Fewer lines wins only between candidates equal on the first four, so the lens never
argues for a terse solution that costs correctness.

The lens is applied by climbing the ladder before writing code:

1. Does it need to exist? Scope is the request.
2. Does it exist here? Search before you write.
3. Does the standard library, the platform, or an installed dependency do it? Verify against current docs, never memory.
4. Does it fit inside the owning module? Extend before you add a file.
5. Is there evidence for an extraction? A second caller, a unit needing its own test, or a file past the repository's own size norm.
6. Then write the minimum edge-case-correct implementation.

Mark a deliberate simplification with a `deferred(<ceiling>, <upgrade path>)` comment. Two
scripts stand under the lens. `co scan overbuild --git <range>` reports the tells of an
over-built change, advisory except for an unrecorded dependency, and
`co scan deferrals` harvests the `deferred(...)` comments so a simplification routes back
to a decision. Both contracts live in
[CONTRACTS.md](../../35%20Contracts%20and%20Data/CONTRACTS.md).

---

## The multi-boundary control-coverage rule

The rule lives inside the Security lens in §10 and is general enough to apply to any
control you review: authz, a feature flag, validation, a rate limit, or a redaction step.
Quoted from [§10](../../../plugins/code-ops-suite/CONVENTIONS.md):

> **Control coverage (multi-boundary):** for any control/gate/invariant (authz, feature flag, validation, rate limit, redaction), enumerate **every** entry point and runtime that can reach the protected action and verify the control at each — *verified at one boundary but not enumerated is a finding, not a pass.*

The failure mode it guards against is the most common way a real control fails. The control
is present and correct at the boundary you happened to look at, and absent at one you did
not enumerate. Consider a refund amount validated at the HTTP route but unguarded at the
internal job that also calls `ledger.credit`. Or an authz check on the web handler but not
on the gRPC entry point. Or a redaction applied in one logger but not the error path.

So the rule is procedural, not a one-time check:

1. **Identify the protected action**: the privileged write, the sensitive read, or the egress the control guards.
2. **Enumerate every entry point and runtime that can reach it**: HTTP routes, RPC handlers, background jobs, CLIs, admin tools, scheduled tasks, and every language runtime in the repo.
3. **Verify the control at each**: present and correct, not merely present.
4. **Treat an un-enumerated boundary as a finding**: the unverified path is the one that gets exploited.

The rule is the same instinct as the sibling sweep in the verification layer. A defect
handled at one caller is not handled until you have checked every caller. The
[05 · Evidence and tiers](../Handbook/05-evidence-and-tiers.md) page walks a worked example
where a guard verified at the route layer was missing at a reconcile job that called the
same primitive, so the control was real at one boundary and absent at another.

---

## Worked example: choosing lenses for three stacks

The same menu produces three very different plans.

**A) An internet-facing payments API holding PII.** In play and weighted high: Security
(untrusted input, authz, the multi-boundary rule on every money-moving control), Privacy
and data handling (PII, so the full lens rather than the light one), Correctness and
intricate bugs (rounding, idempotent retries, illegal states on money), and Testing and
reliability (critical paths). In play at lower weight: Performance, Efficiency, Size and
boundary, Dependencies, Documentation, and Modularity. Skipped and stated: UI/UX/a11y, for
lack of a rendered surface. The top N will almost certainly be led by Security and
Correctness findings, because impact × reach is highest there on this stack.

**B) A zero-dependency string-formatting library, no network, no UI, no personal data.** In
play: Correctness and intricate bugs (locale, off-by-one, coercion, the heart of it),
Modularity and architecture, Size and boundary, Performance (if it is on a hot path),
Testing and reliability, and Documentation accuracy. Privacy sits at its lightest setting,
asking only whether it accidentally logs inputs. Skipped and stated: UI/UX/a11y (no UI),
Dependencies and supply chain (no manifest to speak of), and most of Security (no
untrusted-input surface). The run goes deep on correctness and tests and barely touches the
rest, correctly.

**C) A design-system component library with a rendered UI.** In play and weighted high:
UI/UX, styling and accessibility (the whole reason it exists: tokens against hardcoded
values, theme parity, state coverage, a11y), Modularity and architecture (component reuse,
boundaries), and Performance (bundle size and render thrash, the UI-specific sub-items in
the Performance lens). In play at lower weight: Testing, Documentation, Size and boundary,
and Dependencies. Light: Privacy (unless it handles user data) and most of Security
(depending on what the components do with input). Here the conditional UI lens is the
dominant one.

The menu never changes. What changes is which lenses have a surface to inspect, and which
findings the formula floats to the top.

---

## A reusable checklist

Copy this into your working notes when scoping a review:

```
Stack: <one line> — UI? ___  data sensitivity? none/low/PII/regulated  attack surface? ___

Lens selection (apply / skip-and-say-why):
[ ] Modularity & architecture      surface present? ____
[ ] Size and boundary              change adds code? ____   → climb the ladder, run `co scan overbuild`
[ ] Performance                    hot paths? ____
[ ] Efficiency / resource use      resource-bound code / CI? ____
[ ] Correctness & intricate bugs   (almost always applies) ____
[ ] Security                       untrusted input / controls? ____   → run multi-boundary rule
[ ] Privacy & data handling        SCALE to data sensitivity: ____
[ ] UI/UX, styling & a11y          UI present? if no → SKIP, state it
[ ] Testing & reliability          critical/risky paths? ____
[ ] Documentation accuracy         docs make claims about code? ____   → claims-vs-enforcement
[ ] Dependencies & supply chain    dependency manifest? ____

For every control/gate/invariant found:
[ ] protected action: ____
[ ] entry points/runtimes enumerated: ____
[ ] control verified at EACH: ____  (un-enumerated boundary = finding, not pass)

Weighting:
- severity floor applied (critical can't be buried): ____
- ranked by impact × reach ÷ effort, weighted by confidence (tier): ____
- top-N led with: ____
```

---

## Related

- [Command reference: index and task router](../Handbook/commands/README.md): pick the command that applies the right lenses for your goal.
- [Reading a findings register](reading-a-findings-register.md): where lens-tagged findings land, and the tracks they carry.
- [The disconfirmation pass](disconfirmation-pass.md): how a candidate earns its tier, the confidence weight in the formula, and the sibling-sweep instinct behind the multi-boundary rule.
- [Choosing an automation level](choosing-an-automation-level.md): what a high-confidence, high-priority finding is allowed to trigger automatically.
- [05 · Evidence and tiers](../Handbook/05-evidence-and-tiers.md): CONFIRMED, PROBABLE, and SPECULATIVE, the confidence weight in impact × reach ÷ effort.
- [code-ops-suite `CONVENTIONS.md`](../../../plugins/code-ops-suite/CONVENTIONS.md): §8 severity and priority, §10 the quality lenses and the multi-boundary control-coverage rule, §11 the ordered objective and the ladder, §13 self-scoping.

*Verified-at: b0ffede*
