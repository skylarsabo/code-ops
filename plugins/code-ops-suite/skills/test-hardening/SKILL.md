---
description: "Use when critical paths lack meaningful coverage or tests are flaky; builds deterministic characterization + regression tests. To audit whether existing tests actually catch faults (mutation/assertion strength), use rigor:test-suite-audit."
disable-model-invocation: true
---

# TEST HARDENING — Build & Strengthen the Test Suite

**Invoked as `/code-ops-suite:test-hardening`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** IMPLEMENT · **Produces:** tests (committed), `TEST_COVERAGE_REPORT.md`; bugs exposed → `FINDINGS_REGISTER.md`.

Raise **meaningful** coverage where it matters — not a coverage number. Tests that assert behavior, run deterministically, and would catch real regressions.
**Hard rule:** never change product code to make a test pass; if a test exposes a bug, write a failing/skipped test documenting it and log a finding — fixing it belongs to the remediation prompt.

## Phase 0 — Map the test landscape  *(checkpoint)*
Detect the frameworks/runners/fixtures and how to run the suite + get coverage. Baseline pass/fail, coverage (overall + per critical area), and run time; identify **flaky** tests (run the suite a few times). Rank **targets** by risk × importance: critical paths, complex/branchy logic, security/privacy-sensitive code, recently-changed code, code with known bugs, and anything the audit flagged as under-tested.
> **CHECKPOINT:** present the landscape, baseline, flaky list, and prioritized targets with a proposed coverage focus; confirm scope.

## Phase 1 — Write tests (fan out per area)
Tests must be **behavior-focused** (not implementation-coupled), **complete on what matters** (happy + edge + boundary + error/unhappy paths), **deterministic** (control clocks/randomness/external calls; isolated state), **readable & conventional**, and **meaningful** (no assertion-free/tautological/coverage-only tests). Special passes: **characterization tests** to pin current behavior before refactors (flag, don't encode, behavior that looks wrong); **regression tests** for known/discovered bugs; **security/privacy-path tests** (authz boundaries hold, sensitive data isn't logged/leaked, defaults stay private). **Fix flaky tests at the root** (diagnose the nondeterminism — don't retry-wrap).

## Verify
Run the full suite (multiple times for new tests to confirm determinism); confirm coverage moved meaningfully **on the targeted areas**; no material slowdown; all green.

## Deliverables
The tests (committed, referencing what they cover); **`TEST_COVERAGE_REPORT.md`** (before→after on targeted areas, what's now protected, the characterization/regression/security tests added, flaky tests fixed + root cause, remaining gaps with why deferred); findings logged for any bug a test exposed.

## Done when
Targeted areas have meaningful, deterministic coverage; characterization tests exist for anything queued for refactor; flaky tests fixed at the root; suite green and not materially slower; no product code changed to force a pass; report complete. Present the report, leading with confidence gained on the most critical paths.
