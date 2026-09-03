---
name: rigor-test-suite-audit
description: "Use when you need to know whether a green suite actually catches faults. Validates the tests other proofs rest on."
---

# Test-suite audit: what a green run is worth

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/rigor/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/rigor-test-suite-audit`, or by the model through the `skill` tool as `rigor-test-suite-audit`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows.

- **Mode:** AUDIT. It executes the suite repeatedly and runs mutation checks. It adds
  hardening tests and nothing else.
- **Produces:** `TEST_SUITE_REPORT.md` with a trust map, plus targeted hardening tests.
- **Standing:** the foundation under every other proof (`§F`).

## Phase 0: scope  *(checkpoint)*

Target the whole suite, or focus on the modules you rely on as proofs or intend to change.
Read `GROUND_TRUTH.md` for the coverage map.

## Phase 1: establish what green is worth

- **Flaky or nondeterministic tests.** Have a `verifier` run the suite, or the target
  tests, several times. Flag any test with unstable results into a quarantine list. A flaky
  green is not a green.
- **Assertion strength.** Dispatch a `tracer` to find tests that execute code but assert
  little, tests that cover only the happy path, and missing edge and error assertions. That
  is coverage without verification.
- **Mutation testing.** On code you rely on or intend to change, have a `verifier` inject
  representative faults, or run a mutation tool if one exists, and confirm the suite kills
  them. A surviving mutant marks exactly where a passing test guards nothing. Cross-check
  against coverage: high coverage with a low kill rate is the dangerous combination.

## Phase 2: harden the gaps

Propose targeted tests that kill the surviving mutants and add the missing edge and error
assertions. Write the NOW-SAFE additions yourself. Re-run to confirm the kill rate improves.

## Deliverables

`TEST_SUITE_REPORT.md` carries the flaky and quarantine list, the weak-assertion tests, the
mutation kill-rate gaps, and a trust map naming the areas whose green is real. Add the
hardening tests. Surface anything genuinely broken into `FINDINGS_REGISTER.md`.

## Done when

Flaky tests are identified, assertion gaps are found, and mutation gaps on relied-upon code
are reported. Hardening tests are proposed or added, so that later proofs rest on tests that
actually detect faults.
