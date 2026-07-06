---
description: "Use when you want a PR/diff reviewed at the verification bar — blocking only on CONFIRMED defects/regressions. The high-rigor counterpart to code-ops-suite:pr-review."
disable-model-invocation: true
---

# DEEP REVIEW — The Verification Bar, Applied to a Change

**Invoked as `/rigor:deep-review`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
**Mode:** REVIEW (no changes unless asked) · **Produces:** tiered, `file:line` comments + a verdict (PR comments if a VCS tool is connected, else `REVIEW.md`).

## Phase 0 — Understand the change
Pull the diff and its intent (description, linked issue/spec) and the surrounding code. Run the `GROUND_TRUTH` tooling on the branch (typecheck, lint, tests) so the review starts from facts. For large diffs, fan out to the tracer/verifier subagents and synthesize. For changed exported symbols or shared contracts, use the tracer to locate their dependents so ranking reflects demonstrated reach (`§D`), not diff size.

## Phase 1 — Review against the lenses, with proof
Apply the correctness, failure-handling, consistency, and defect-causing-maintainability lenses (`§7`). For each concern, **reproduce it** (a failing test or trace) where feasible → CONFIRMED; otherwise tier PROBABLE/SPECULATIVE and label it. Run the **disconfirmation pass** (`§B`) on every concern. Check the change doesn't **introduce an inconsistency**, **regress an existing enforcement or prior proof** (`§H`), or land behavior without a test. Use a quick bisect/history check if it looks like it reverts a past fix. For any concern you would mark **Blocking** whose severity rests on static reasoning rather than an executed repro, run an **independent refutation** (`§I`) — a fresh refuter tries to kill it by locating a dominating guard elsewhere; a refuted concern drops or downgrades. Each comment carries a verbatim **Anchor** of its cited line (`§E`).

## Output — the review
Comments at `file:line`, each with a tier and a concrete fix, grouped **Blocking** (CONFIRMED defect/regression) · **Should-fix** (PROBABLE / quality) · **Nit**. End with a verdict (approve / approve-with-nits / request-changes) and a short risk read. **No tier inflation** — don't block on a SPECULATIVE; don't wave through a CONFIRMED defect.

## Done when
The change is reviewed at the verification bar; CONFIRMED issues carry repros; consistency, enforcements, and regressions are checked; a calibrated verdict is given.
