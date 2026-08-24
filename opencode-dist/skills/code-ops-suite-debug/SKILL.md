---
name: code-ops-suite-debug
description: "Use when you have a bug symptom and want it driven from reproduction to a root-cause fix at full rigor."
---

# DEBUG — Symptom to Root-Cause Fix, Proven

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-debug`, or by the model through the `skill` tool as `code-ops-suite-debug`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin — operating model, interaction protocol, safety rails, quality lenses, and the implementation loop this skill follows.
**Mode:** IMPLEMENT. **Consumes:** a symptom (error, stack trace, wrong behavior). **Produces:** a root-cause fix with a failing→passing regression test, shipped traceless. **Composes** (when installed): `rigor` (verifier, tracer, regression-hunt, fix-verified) and the traceless-PR finish. **Requires `rigor`**; the privacy phase runs only if `privacy-opsec-suite` is installed and the fix touches a privacy surface.

Scale every phase to the symptom: a trivially-scoped fix is a light pass; a deep or cross-cutting bug gets the full treatment.

## Phase 0 — Reproduce  *(checkpoint)*
Run `node <plugin-root>/scripts/preflight.mjs --artifact-dir <run folder>` — a FAIL stops the run before fan-out. Prepare one exact context snapshot and compile the explorer's scoped bundle; context drift or an explicit compiler marker stops dispatch and triggers a replan. Hand the verified bundle to the explorer. Capture the symptom precisely; run `/rigor-ground-truth` for the baseline. Use `rigor`'s verifier to build a **reliable reproduction** (a failing test or runnable repro). If it cannot reproduce the symptom, stop and report the missing environment, data, or steps; never guess a fix.

## Phase 1 — Isolate
Trace the control/data path with `rigor`'s tracer and derive the invariants the code must hold; narrow to the smallest triggering path. If it's a regression, `/rigor-regression-hunt` to bisect to the commit that introduced it.

## Phase 2 — Root-cause  *(checkpoint — confirm before changing code)*
Identify the real cause at the correct layer (not the nearest symptom), cited `file:line`, with a disconfirmation pass (reachable? handled elsewhere? intentional?). Present the root cause + the proposed fix and get a go before editing. For a trivially-scoped fix (one file, obvious root cause), this checkpoint may be merged into the fix report in Phase 3 instead of a standalone pause; anything broader keeps the checkpoint mandatory.

## Phase 3 — Fix with proof
Run the `rigor:fix-verified` loop: the repro now passes, the suite is green, the regression guard holds, sweep for **siblings** (other sites of the same cause), and add an enforcement so the class can't recur. If the fix keeps cascading into new findings, the **cascade circuit-breaker** (`CONVENTIONS §11`) stops the loop and escalates as NEEDS-DESIGN.

Gate the tracer's and verifier's reports on shape before acting on them — a null, empty, or malformed report is a failed dispatch (`§1`), marked `failed` in `DISPATCH_LEDGER.md` (`§12`) and redispatched or deferred, never patched over with an assumed root cause.

## Phase 4 — Privacy gate  *(if applicable)*
If the fix touches egress, logging, identifiers, or a default — and `privacy-opsec-suite` is installed — run `/privacy-opsec-suite-metadata-leak-audit` scoped to the fix's diff; its findings enter `FINDINGS_REGISTER.md`, fail-closed preserved.

## Phase 5 — Finish traceless
Ship as a clean PR scrubbed by `privacy-opsec-suite:authorship-hygiene` (use `code-ops-suite:pr-split` if the fix is multi-part); `scan-ai-tells` passes fail-closed before push — if `privacy-opsec-suite` is not installed, run the bundled `<plugin-root>/scripts/scan-ai-tells.mjs` directly as the gate; **never auto-merge**.

## Done when
The symptom is reproduced then resolved, fixed at root cause with a regression test that failed before and passes now, siblings handled and an enforcement added, the regression guard + suite green, privacy posture intact (if applicable), and shipped as a clean trace-free PR with nothing auto-merged.
