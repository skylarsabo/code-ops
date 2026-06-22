---
description: "Use when you want measured, behavior-preserving improvements (baseline to change to before/after delta), not speculative refactors. For profiling-led hot-path optimization specifically, see code-ops-suite:performance."
disable-model-invocation: true
---

# IMPROVE (MEASURED) — No Speculative Refactors

**Invoked as `/rigor:improve-measured`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
**Mode:** IMPLEMENT (via the fix–prove–guard loop `§8`) · **Produces:** `IMPROVEMENTS_LOG.md`, diffs/PRs; summary with measured deltas. Rule: **if you can't measure the "before", you can't claim the "after".**

## Phase 0 — Scope + define "better"  *(checkpoint)*
Agree what improvement means here: runtime/latency, allocations/queries, complexity, bundle/footprint, removable code/deps, or API ergonomics. Read `GROUND_TRUTH.md`. Confirm a `safety-net` exists for the target (or run it first) so "behavior-preserving" is provable.

## Phase 1 — Baseline the candidates
For each candidate, capture a **concrete baseline measurement** first: a benchmark number, a complexity score, an allocation/query/IO count, a bundle size, or the exact dead code/dependency to remove. Reject speculative "feels cleaner" changes lacking a measurable basis.

## Phase 2 — Implement and re-measure
Apply the change **behavior-preservingly** (`§8`): keep the full suite + proof set green, then **re-measure** and record before → after → delta. Roll back any change whose measured delta doesn't justify it.
> Checkpoint per change if behavior-adjacent or touching a public contract.

## Deliverables
`IMPROVEMENTS_LOG.md` — each change with baseline → result → delta and its proof (benchmark output, metric, removed-lines count); diffs/PRs; a summary of the measured wins.

## Done when
Every shipped improvement shows a before/after metric, behavior is preserved (proof set green), and tests are green; speculative changes excluded.
