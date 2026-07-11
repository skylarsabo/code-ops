---
name: ship
description: "Use when you want to implement one change — a feature or a one-off — end to end at high quality, shipped as a clean traceless PR."
---

# SHIP — Implement One Change End-to-End, at Full Rigor

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:ship`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin — operating model, interaction protocol, safety rails (incl. the automation-level ladder `§4`), quality lenses (`§10`), and the implementation loop (`§11`) this skill follows.
**Mode:** IMPLEMENT. **Consumes:** an intent (ticket, request, or spec). **Produces:** the change, proven and shipped as a clean, traceless PR/stack. **Composes** (when installed): `rigor` (safety-net, proof, regression guard), `privacy-opsec-suite` (leak gate), and `code-ops-suite:pr-split` + `privacy-opsec-suite:authorship-hygiene` (the traceless finish). **Requires `rigor`**; the privacy phase runs only if `privacy-opsec-suite` is installed and the change touches a privacy surface.

Scale every phase to the change: a one-off is a light pass; a feature gets the full treatment.

## Phase 0 — Scope & design-check  *(checkpoint)*
Detect the stack; run `rigor:ground-truth` for the baseline; learn the repo's conventions. Size the change (one-off vs feature). For a feature, confirm the approach (options + a recommendation) before building; a true one-off proceeds. Set the **automation level** (`§4`). Confirm plugin availability (preflight; note anything missing).

## Phase 1 — Safety net (risky / low-coverage areas)
If the change touches code with thin coverage, run `rigor:safety-net` to characterize current behavior first, so the change is provably behavior-preserving where it should be.

## Phase 2 — Implement
Run the implementation loop (`§11`): the smallest correct change, matching existing conventions, upholding the quality lenses (`§10`). A feature ships its smallest valuable slice first (behind a flag if it isn't yet complete). Don't trade one issue for another.

## Phase 3 — Prove
Add tests that fail before and pass after; keep the full suite green; run the regression guard (`rigor §H`) so nothing prior breaks. A change without a test that demonstrates it is not done.

## Phase 4 — Privacy gate  *(if applicable)*
If the change touches egress, logging, identifiers, or a default — and `privacy-opsec-suite` is installed — run its gate: no new leak/egress/identifier/fingerprint, fail-closed preserved. Surface any anonymity regression as blocking.

## Phase 5 — Finish traceless
Ship the work as a clean PR: `code-ops-suite:pr-split` if it warrants a stack, otherwise a single PR scrubbed by `privacy-opsec-suite:authorship-hygiene`. `scan-ai-tells` passes fail-closed before push — if `privacy-opsec-suite` is not installed, run the bundled `<plugin-root>/scripts/scan-ai-tells.mjs` over the commit/PR text directly as the gate. **Never auto-merge**.

## Done when
The change is implemented at the smallest correct scope, proven (failing→passing tests, suite + regression guard green), behavior-preserving where intended, privacy posture intact (if applicable), docs updated, and shipped as a clean, trace-free PR/stack with nothing auto-merged. Present a summary, the PR link(s), and anything left for your decision.
