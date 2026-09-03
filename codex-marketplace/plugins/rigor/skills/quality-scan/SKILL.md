---
name: quality-scan
description: "Use when you want high-signal, defect-causing quality issues with evidence and tiers, not cosmetic nits."
---

# Quality scan: real issues, high signal

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `rigor:quality-scan`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows.

- **Mode:** AUDIT. It reads code and runs light execution.
- **Produces:** tiered findings in `FINDINGS_REGISTER.md`, plus a summary.
- **Target:** issues that cause defects or real maintenance pain. Cosmetic style is the
  formatter's job and stays out of scope.

## Phase 0: scope  *(checkpoint)*

Pick the area. Read `GROUND_TRUTH.md` so you skip what the linter and the type checker
already enforce. If that file is absent, run `rigor:ground-truth` first, or harvest the
`§C` toolchain baseline for the area yourself before scanning. Never reason ahead of the
toolchain.

## Phase 1: find the defect-causing quality issues

Dispatch a `tracer` to hunt the maintainability lenses in `§7` that actually bite:

- **Complexity hotspots**, each carried by a concrete metric rather than an impression.
- **Error-handling gaps**: swallowed or re-thrown errors, missing cleanup or rollback, and
  partial-failure paths.
- **Resource leaks**: unclosed handles, connections, and subscriptions, and leaked timers
  and listeners.
- **Type-safety holes**: unsafe casts, escape hatches, and unchecked nullability at
  boundaries.
- **Fragile coupling**: hidden temporal coupling and shared mutable state.
- **Dead or duplicated code** that hides intent.

Every item carries a `file:line`, its reachability and impact (`§D`), a tier (`§A`), and the
disconfirmation pass (`§B`). Suppress low-confidence noise, or mark it SPECULATIVE. Do not
pad the report.

## Deliverables

`FINDINGS_REGISTER.md` entries ranked by demonstrated impact, and a summary that separates
CONFIRMED from PROBABLE and SPECULATIVE. Each item names how it could be enforced once it
is fixed.

## Done when

Real, defect-causing quality issues are surfaced with evidence, a tier, and an impact.
Cosmetic noise is excluded, disconfirmation is done, and nothing is inflated. The finished
`FINDINGS_REGISTER.md` passes
`node <plugin-root>/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .`
with exit 0. Before the run is done, re-locate any non-FRESH citation against the real tree
or drop it (`§E`).
