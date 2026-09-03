---
name: rigor-improve-measured
description: "Use when you want measured, behavior-preserving improvements, not speculative refactors. For profiling-led hot-path optimization specifically, see code-ops-suite:performance."
---

# Measured improvement: no speculative refactors

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/rigor/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/rigor-improve-measured`, or by the model through the `skill` tool as `rigor-improve-measured`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows.

- **Mode:** IMPLEMENT, through the fix-prove-guard loop in `§8`.
- **Produces:** `IMPROVEMENTS_LOG.md`, the diffs or pull requests, and a summary carrying
  the measured deltas.
- **Rule:** if you cannot measure the before, you cannot claim the after.

## Phase 0: scope and define better  *(checkpoint)*

Agree what improvement means here: runtime or latency, allocations or queries, complexity,
bundle or footprint size, removable code or dependencies, or API ergonomics. Read
`GROUND_TRUTH.md`. Confirm that a `safety-net` exists for the target, or run it first, so
that behavior-preserving is provable.

## Phase 1: baseline the candidates

For each candidate, have a `verifier` capture a concrete baseline measurement first: a
benchmark number, a complexity score, an allocation, query, or IO count, a bundle size, or
the exact dead code or dependency to remove. Reject any speculative change that has no
measurable basis.

## Phase 2: implement and re-measure

Apply the change behavior-preservingly (`§8`) and keep the full suite and the proof set
green. Then have the `verifier` re-measure and record the before, the after, and the delta.
Roll back any change whose measured delta does not justify it.

> Take a checkpoint per change when it is behavior-adjacent or touches a public contract.

## Deliverables

`IMPROVEMENTS_LOG.md` records each change with its baseline, result, and delta, and with its
proof, which may be benchmark output, a metric, or a removed-lines count. Add the diffs or
pull requests, and a summary of the measured wins.

## Done when

Every shipped improvement shows a before-and-after metric, behavior is preserved with the
proof set green, and the tests are green. Speculative changes are excluded.
