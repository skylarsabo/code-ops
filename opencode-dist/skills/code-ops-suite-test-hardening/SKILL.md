---
name: code-ops-suite-test-hardening
description: "Use when critical paths lack meaningful coverage or tests are flaky. It builds characterization and regression tests. To audit whether existing tests actually catch faults, use rigor:test-suite-audit."
---

# Test hardening: build and strengthen the test suite

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-test-hardening`, or by the model through the `skill` tool as `code-ops-suite-test-hardening`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section.
**Mode:** IMPLEMENT · **Produces:** committed tests and `TEST_COVERAGE_REPORT.md`. Bugs exposed
go to `FINDINGS_REGISTER.md`.

Raise **meaningful** coverage where it matters, rather than raising a coverage number. Write
tests that assert behavior, run deterministically, and would catch real regressions.

**The hard rule:** never change product code to make a test pass. When a test exposes a bug,
write a failing or skipped test documenting it and log a finding. Fixing it belongs to the
remediation prompt.

## Phase 0: the test landscape  *(checkpoint)*

Dispatch an `explorer` operative to detect the frameworks, runners, and fixtures, and how to run
the suite and get coverage. Capture the baseline for pass and fail, coverage overall and per
critical area, and run time. Identify the **flaky** tests by running the suite a few times. Rank
the **targets** by risk times importance: critical paths, complex or branchy logic, security- and
privacy-sensitive code, recently changed code, code with known bugs, and anything the audit
flagged as under-tested.

> **CHECKPOINT:** present the landscape, the baseline, the flaky list, and the prioritized targets with a proposed coverage focus. Confirm the scope.

## Phase 1: the tests

Dispatch an ephemeral implementation operative per area, with conflict-aware fan-out
(`CONVENTIONS §1`). Every test must be:
- **Behavior-focused**, rather than coupled to the implementation.
- **Complete on what matters**, covering the happy, edge, boundary, and error paths.
- **Deterministic**, controlling clocks, randomness, and external calls, with isolated state.
- **Readable and conventional.**
- **Meaningful**, with no assertion-free, tautological, or coverage-only tests.

Run three special passes as well. Write **characterization tests** to pin current behavior before
refactors, flagging rather than encoding behavior that looks wrong. Write **regression tests** for
known and discovered bugs. Write **security- and privacy-path tests**, proving that authorization
boundaries hold, that sensitive data is not logged or leaked, and that defaults stay private.

**Fix flaky tests at the root.** Diagnose the nondeterminism, and do not wrap a test in a retry.

## The verification

Run the full suite, several times for the new tests, to confirm determinism. Confirm that
coverage moved meaningfully **on the targeted areas**. Confirm no material slowdown, and that
everything is green.

## Deliverables

- The tests, committed, each referencing what it covers.
- **`TEST_COVERAGE_REPORT.md`**: the before-and-after on the targeted areas, what is now protected, the characterization and regression and security tests added, the flaky tests fixed with their root cause, and the remaining gaps with the reason each was deferred.
- Findings logged for any bug a test exposed.

## Done when

- The targeted areas have meaningful, deterministic coverage.
- Characterization tests exist for anything queued for refactor.
- Flaky tests are fixed at the root.
- The suite is green and not materially slower.
- No product code was changed to force a pass, and the report is complete.
- The report is presented, leading with the confidence gained on the most critical paths.
