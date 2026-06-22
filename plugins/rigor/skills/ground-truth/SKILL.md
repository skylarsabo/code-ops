---
description: "Use when you want the factual baseline before any analysis: run the real toolchain (build/typecheck, lint, tests + coverage, static analysis) and capture it as ground truth + a coverage/blind-spot map. Run first."
disable-model-invocation: true
---

# GROUND TRUTH — Establish the Factual Baseline

**Invoked as `/rigor:ground-truth`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
**Mode:** AUDIT (runs tooling; no source edits) · **Produces:** `GROUND_TRUTH.md` + seeds CONFIRMED items into `FINDINGS_REGISTER.md`. Run this first — everything else builds on it.

## Phase 0 — Detect the toolchain  *(checkpoint if ambiguous)*
Identify what exists: build/typecheck, linter(s), the test runner + coverage tool, a benchmark harness, a mutation-testing tool, and any static analyzer / SAST. Note what's missing.

## Phase 1 — Run and harvest facts (`§C`)
Run each tool and capture output as **ground truth**, not opinion: build/typecheck → compile and type errors (CONFIRMED); linter(s) → real findings (skip pure-cosmetic rules); test suite → failures and flakes (CONFIRMED) plus a **coverage map** (exercised vs. not); static analyzer/SAST → issues to reconcile later. Build a **blind-spot list**: modules/paths with little or no coverage — where later hunting must be most careful and where the `safety-net` skill should add characterization tests before any change.

## Deliverables
`GROUND_TRUTH.md` — tool results as facts, the coverage map, the blind-spot list, and which lint/analyzer rules are already enforced (so later skills don't re-flag them). Seed unambiguous CONFIRMED items into `FINDINGS_REGISTER.md` with proof.

## Done when
The toolchain has been run, results captured as facts, the coverage/blind-spot map produced, and CONFIRMED tool findings seeded. Hand the blind-spot list to `safety-net` and the suite's trustworthiness question to `test-suite-audit`.
