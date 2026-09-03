---
name: deep-review
description: "Use when you want a PR or diff reviewed at the verification bar, blocking only on CONFIRMED defects and regressions. The high-rigor counterpart to code-ops-suite:pr-review."
---

# Deep review: the verification bar, applied to a change

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `rigor:deep-review`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows.

- **Mode:** REVIEW. It changes nothing unless you ask.
- **Produces:** tiered `file:line` comments and a verdict. They go to the pull request when
  a version-control tool is connected, and to `REVIEW.md` otherwise.

## Phase 0: understand the change

Pull the diff, its intent from the description and any linked issue or specification, and
the surrounding code. Run the `GROUND_TRUTH` tooling on the branch, meaning typecheck, lint,
and tests, so the review starts from facts. For a large diff, fan out to the tracer/verifier
subagents and synthesize their reports. For a changed exported symbol or a shared
contract, use a `tracer` to locate its dependents, so that ranking reflects demonstrated
reach (`§D`) rather than diff size.

## Phase 1: review against the lenses, with proof

Apply the correctness, failure-handling, consistency, and defect-causing-maintainability
lenses (`§7`). Reproduce each concern where that is feasible, with a failing test or a
trace, which makes it CONFIRMED. Otherwise tier it PROBABLE or SPECULATIVE and label it.
Run the disconfirmation pass (`§B`) on every concern.

Check that the change does not introduce an inconsistency, does not regress an existing
enforcement or a prior proof (`§H`), and does not land behavior without a test. Run a quick
bisect or history check if the change looks like it reverts a past fix.

For any concern you would mark Blocking whose severity rests on static reasoning rather than
an executed repro, run an independent refutation (`§I`). A fresh refuter tries to kill it by
locating a dominating guard elsewhere, and a refuted concern is dropped or downgraded. Each
comment carries a verbatim Anchor of its cited line (`§E`).

## Output: the review

Write comments at `file:line`, each with a tier and a concrete fix, grouped into three
levels:

- **Blocking**, for a CONFIRMED defect or regression.
- **Should-fix**, for a PROBABLE or quality item.
- **Nit**.

End with a verdict, which is approve, approve-with-nits, or request-changes, and a short
risk read. Do not inflate a tier. Do not block on a SPECULATIVE item, and do not wave
through a CONFIRMED defect.

## Done when

The change is reviewed at the verification bar. CONFIRMED issues carry repros. Consistency,
enforcements, and regressions are checked, and the verdict is calibrated.
