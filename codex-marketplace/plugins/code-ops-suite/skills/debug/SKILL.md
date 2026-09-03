---
name: debug
description: "Use when you have a bug symptom and want it driven from reproduction to a root-cause fix at full rigor."
---

# Debug: symptom to root-cause fix, proven

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:debug`.** First read the `<plugin-root>/CONVENTIONS.md`
bundled with this plugin: the operating model, the interaction protocol, the safety rails, the
quality lenses, and the implementation loop this skill follows.
**Mode:** IMPLEMENT. **Consumes:** a symptom, meaning an error, a stack trace, or a wrong
behavior. **Produces:** a root-cause fix with a failing-then-passing regression test, shipped
traceless. **Composes,** when installed: `rigor` for the verifier, tracer, regression-hunt, and
fix-verified, plus the traceless-PR finish. **Requires `rigor`.** The privacy phase runs only
when `privacy-opsec-suite` is installed and the fix touches a privacy surface.

Scale every phase to the symptom. A trivially-scoped fix is a light pass. A deep or cross-cutting
bug gets the full treatment.

## Phase 0: the reproduction  *(checkpoint)*

Run `node <plugin-root>/scripts/preflight.mjs --artifact-dir <run folder>`. A FAIL stops
the run before fan-out. Prepare one exact context snapshot and compile the explorer's scoped
bundle. Context drift or an explicit compiler marker stops dispatch and triggers a replan. Hand
the verified bundle to the explorer. Capture the symptom precisely, then run
`rigor:ground-truth` for the baseline. Use `rigor`'s verifier to build a **reliable
reproduction**, either a failing test or a runnable repro. When it cannot reproduce the symptom,
stop and report the missing environment, data, or steps. Never guess a fix.

## Phase 1: the isolation

Trace the control and data path with `rigor`'s tracer, and derive the invariants the code must
hold. Narrow to the smallest triggering path. When the bug is a regression, run
`rigor:regression-hunt` to bisect to the commit that introduced it.

## Phase 2: the root cause  *(checkpoint, confirm before changing code)*

Identify the real cause at the correct layer, not at the nearest symptom, cited `file:line`,
with a disconfirmation pass asking whether the path is reachable, handled elsewhere, or
intentional. Present the root cause and the proposed fix, and get approval before editing. For a
trivially-scoped fix, meaning one file with an obvious root cause, you may merge this checkpoint
into the fix report in Phase 3 instead of pausing. Anything broader keeps the checkpoint
mandatory.

## Phase 3: the fix, with proof

Run the `rigor:fix-verified` loop. The repro now passes, the suite is green, and the regression
guard holds. Sweep for **siblings**, meaning other sites of the same cause, and add an
enforcement so the class cannot recur. When the fix keeps cascading into new findings, the
**cascade circuit-breaker** (`CONVENTIONS §11`) stops the loop and escalates as NEEDS-DESIGN.

Gate the tracer's and verifier's reports on shape before acting on them. A null, empty, or
malformed report is a failed dispatch (`§1`). Mark it `failed` in `DISPATCH_LEDGER.md` (`§12`)
and redispatch or defer it. Never patch over it with an assumed root cause.

## Phase 4: the privacy gate  *(when applicable)*

When the fix touches egress, logging, identifiers, or a default, and `privacy-opsec-suite` is
installed, run `privacy-opsec-suite:metadata-leak-audit` scoped to the fix's diff. Its findings
enter `FINDINGS_REGISTER.md`, with fail-closed behavior preserved.

## Phase 5: the traceless finish

Ship the fix as a clean PR scrubbed by `privacy-opsec-suite:authorship-hygiene`. Use
`code-ops-suite:pr-split` when the fix is multi-part. `scan-ai-tells` passes fail-closed before
push. When `privacy-opsec-suite` is not installed, run the bundled
`<plugin-root>/scripts/co.mjs scan ai-tells` directly as the gate. **Never auto-merge.**

## Done when

- The symptom was reproduced and then resolved, fixed at root cause with a regression test that failed before and passes now.
- Siblings are handled and an enforcement is added.
- The regression guard and the suite are green.
- The privacy posture is intact, when the privacy phase applied.
- The work shipped as a clean, trace-free PR with nothing auto-merged.
