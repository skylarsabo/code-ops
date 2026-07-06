---
description: "Use when you need to know whether a green suite actually catches faults. Validates the tests other proofs rest on."
disable-model-invocation: true
---

# TEST-SUITE AUDIT — Trust the Tests Only as Far as They're Proven

**Invoked as `/rigor:test-suite-audit`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
**Mode:** AUDIT (executes the suite repeatedly + mutation checks; adds hardening tests only) · **Produces:** `TEST_SUITE_REPORT.md` + a trust map; targeted hardening tests. This is the foundation under every other proof (`§F`).

## Phase 0 — Scope  *(checkpoint)*
Target the whole suite, or focus on the modules you rely on as proofs / intend to change. Read `GROUND_TRUTH.md` for the coverage map.

## Phase 1 — Establish what "green" is worth
- **Flaky / nondeterministic:** run the suite (or target tests) several times; flag tests with unstable results → quarantine list (a flaky green is not a green).
- **Assertion strength:** find tests that execute code but assert little, happy-path-only tests, and missing edge/error assertions — coverage without verification.
- **Mutation testing:** on relied-upon / to-be-changed code, inject representative faults (or run a mutation tool if available) and confirm the suite **kills** them. Surviving mutants mark exactly where passing tests guard nothing. Cross-reference coverage: **high coverage + low kill rate = the danger zone.**

## Phase 2 — Harden the gaps
Propose (and, for NOW-SAFE additions, write) targeted tests that kill the surviving mutants and add the missing edge/error assertions. Re-run to confirm the kill rate improves.

## Deliverables
`TEST_SUITE_REPORT.md` — flaky/quarantine list, weak-assertion tests, mutation kill-rate gaps, and a **trust map** (which areas' green is real). The hardening tests added; anything genuinely broken surfaced into `FINDINGS_REGISTER.md`.

## Done when
Flaky tests are identified, assertion gaps found, mutation gaps on relied-upon code reported, and hardening tests proposed/added so later proofs rest on tests that actually detect faults.
