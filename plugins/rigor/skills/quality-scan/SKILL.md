---
description: "Use when you want high-signal, defect-causing quality issues (complexity, error-handling gaps, leaks, type holes, fragile coupling) with evidence and tiers — not cosmetic nits."
disable-model-invocation: true
---

# QUALITY SCAN — Real Issues, High Signal

**Invoked as `/rigor:quality-scan`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
**Mode:** AUDIT (reads + light execution) · **Produces:** tiered findings → `FINDINGS_REGISTER.md`; summary. Targets issues that *cause defects or real maintenance pain* — cosmetic style is the formatter's job and is out of scope.

## Phase 0 — Scope  *(checkpoint)*
Pick the area; read `GROUND_TRUTH.md` so you skip what the linter/type-checker already enforces. If it's absent, run `/rigor:ground-truth` first (recommended), or harvest the `§C` toolchain baseline for the area yourself before scanning; never reason ahead of the toolchain.

## Phase 1 — Find defect-causing quality issues
Hunt the maintainability/`§7` lenses that actually bite: **complexity hotspots** (with a concrete metric, not a vibe); **error-handling gaps** (swallowed/re-thrown errors, missing cleanup/rollback, partial-failure paths); **resource leaks** (unclosed handles/connections/subscriptions, leaked timers/listeners); **type-safety holes** (unsafe casts, escape hatches, unchecked nullability at boundaries); **fragile coupling** (hidden temporal coupling, shared mutable state); **dead/duplicated code that hides intent**. For each: `file:line`, reachability/impact (`§D`), a tier (`§A`), and the **disconfirmation pass** (`§B`). Suppress low-confidence noise or mark it SPECULATIVE — do not pad the report.

## Deliverables
`FINDINGS_REGISTER.md` entries ranked by **demonstrated impact**; a summary separating CONFIRMED from PROBABLE/SPECULATIVE. Each item names how it could be enforced once fixed.

## Done when
Real, defect-causing quality issues are surfaced with evidence, tier, and impact; cosmetic noise excluded; disconfirmation done; nothing inflated.
