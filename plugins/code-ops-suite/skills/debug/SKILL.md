---
description: "Use when you have a bug symptom and want it driven from reproduction to a root-cause fix at full rigor: reproduce, isolate, confirm the cause, then fix with a regression proof and ship traceless."
disable-model-invocation: true
---

# DEBUG — Symptom to Root-Cause Fix, Proven

**Invoked as `/code-ops-suite:debug`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin — operating model, interaction protocol, safety rails, quality lenses, and the implementation loop this skill follows.
**Mode:** IMPLEMENT. **Consumes:** a symptom (error, stack trace, wrong behavior). **Produces:** a root-cause fix with a failing→passing regression test, shipped traceless. **Composes** (when installed): `rigor` (verifier, tracer, regression-hunt, fix-verified) and the traceless-PR finish. **Requires `rigor`**; the privacy phase runs only if `privacy-opsec-suite` is installed and the fix touches a privacy surface.

## Phase 0 — Reproduce  *(checkpoint)*
Capture the symptom precisely; run `/rigor:ground-truth` for the baseline. Use `rigor`'s verifier to build a **reliable reproduction** (a failing test or runnable repro). If it can't be reproduced, stop and report exactly what's needed (env, data, steps) — never guess a fix.

## Phase 1 — Isolate
Trace the control/data path with `rigor`'s tracer and derive the invariants the code must hold; narrow to the smallest triggering path. If it's a regression, `/rigor:regression-hunt` to bisect to the commit that introduced it.

## Phase 2 — Root-cause  *(checkpoint — confirm before changing code)*
Identify the real cause at the correct layer (not the nearest symptom), cited `file:line`, with a disconfirmation pass (reachable? handled elsewhere? intentional?). Present the root cause + the proposed fix and get a go before editing.

## Phase 3 — Fix with proof
Run the `rigor:fix-verified` loop: the repro now passes, the suite is green, the regression guard holds, sweep for **siblings** (other sites of the same cause), and add an enforcement so the class can't recur.

## Phase 4 — Privacy gate  *(if applicable)*
If the fix touches egress, logging, identifiers, or a default — and `privacy-opsec-suite` is installed — run its leak gate; fail-closed preserved.

## Phase 5 — Finish traceless
Ship as a clean PR scrubbed by `privacy-opsec-suite:authorship-hygiene` (use `code-ops-suite:pr-split` if the fix is multi-part); `scan-ai-tells` passes fail-closed before push; **never auto-merge**.

## Done when
The symptom is reproduced then resolved, fixed at root cause with a regression test that failed before and passes now, siblings handled and an enforcement added, the regression guard + suite green, privacy posture intact (if applicable), and shipped as a clean trace-free PR with nothing auto-merged.
