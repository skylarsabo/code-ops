---
name: rigor-regression-hunt
description: "Use when something used to work and you need to pinpoint the commit that broke it and find related regressions in recent changes."
---

# REGRESSION HUNT — When Did It Break, and What Else Did

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/rigor/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/rigor-regression-hunt`, or by the model through the `skill` tool as `rigor-regression-hunt`.** First read the bundled `<plugin-root>/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
**Mode:** AUDIT (uses VCS history + *executes* repros) · **Produces:** `REGRESSION_REPORT.md` + findings → `FINDINGS_REGISTER.md`. Best paired with `bug-hunt` (to bisect a confirmed bug) or run after a release.

## Phase 0 — Scope  *(checkpoint)*
Define the target: a known behavior change/bug to bisect to its origin, or "regressions introduced in the last N commits / since release X". Confirm the time range and what "correct" looked like before.

## Phase 1 — Locate and confirm
- **Bisect a known bug:** have a `verifier` write a test that detects it and execute the VCS bisect to the commit that introduced it; report the commit, the change, and *why* it caused the regression.
- **Sweep recent changes:** derive what recent commits altered; have the `verifier` run the accumulated proof set / characterization tests across them; look for behavior **and performance** regressions; check changed areas against the lenses (`§7`).
- **Related areas:** dispatch a `tracer` to identify other code the offending change touched or shares a root cause with, which may carry the same regression (`§G`).

## Deliverables
`REGRESSION_REPORT.md` — offending commit(s), the repro, blast radius, and related areas to check; CONFIRMED findings (the bisect + repro are the proof) → `FINDINGS_REGISTER.md`. If recent changes are clean, say so with the evidence.

## Done when
The regression's origin is pinpointed with a repro (or recent changes are cleared), related areas are flagged, and findings carry their bisect/repro proof.
