---
description: "Use when you want the factual baseline before any analysis. Runs the real toolchain and captures ground truth plus a coverage and blind-spot map. Run this first."
---

# Ground truth: the factual baseline

**Invoked as `/rigor:ground-truth`.** First read the bundled
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows.

- **Mode:** AUDIT. It runs tooling and edits no source.
- **Produces:** `GROUND_TRUTH.md`, and seeds CONFIRMED items into `FINDINGS_REGISTER.md`.
- **Order:** run this skill first. Everything else builds on it.

## Phase 0: detect the toolchain  *(checkpoint if ambiguous)*

Identify what the repository has: a build or typecheck step, linters, the test runner and
its coverage tool, a benchmark harness, a mutation-testing tool, and any static analyzer.
Note what is missing.

## Phase 1: run the tools and harvest facts (`§C`)

Run each tool and capture its output as ground truth rather than opinion:

- Build or typecheck: compile and type errors, all CONFIRMED.
- Linters: real findings, skipping the purely cosmetic rules.
- Test suite: failures and flakes, all CONFIRMED, plus a coverage map of what the tests
  exercise and what they do not.
- Static analyzer: issues to reconcile in a later phase.

Then build the blind-spot list, meaning the modules and paths with little or no coverage.
Later hunting must be most careful there, and the `safety-net` skill must add
characterization tests there before any change.

## Deliverables

`GROUND_TRUTH.md` carries the tool results as facts, the coverage map, the blind-spot list,
and the lint and analyzer rules already enforced, so a later skill does not re-flag them.
Seed the unambiguous CONFIRMED items into `FINDINGS_REGISTER.md` with their proof.

## Done when

The toolchain has run, the results are captured as facts, the coverage and blind-spot map
exists, and the CONFIRMED tool findings are seeded. Hand the blind-spot list to
`safety-net`, and the question of whether the suite can be trusted to `test-suite-audit`.
