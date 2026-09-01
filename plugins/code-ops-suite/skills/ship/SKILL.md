---
description: "Use when you want to implement one change — a feature or a one-off — end to end at high quality, shipped as a clean traceless PR."
---

# SHIP — Implement One Change End-to-End, at Full Rigor

**Invoked as `/code-ops-suite:ship`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin — operating model, interaction protocol, safety rails (incl. the automation-level ladder `§4`), quality lenses (`§10`), and the implementation loop (`§11`) this skill follows.
**Mode:** IMPLEMENT. **Consumes:** an intent (ticket, request, or spec). **Produces:** the change, proven and shipped as a clean, traceless PR/stack. **Composes** (when installed): `rigor` (safety-net, proof, regression guard), `privacy-opsec-suite` (leak gate), and `code-ops-suite:pr-split` + `privacy-opsec-suite:authorship-hygiene` (the traceless finish). **Requires `rigor`**; the privacy phase runs only if `privacy-opsec-suite` is installed and the change touches a privacy surface.

Scale every phase to the change: a one-off is a light pass; a feature gets the full treatment.

## Phase 0 — Scope & design-check  *(checkpoint)*
Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs --artifact-dir <run folder>` (add `--need gh` if the run will publish) — a FAIL stops the run before fan-out. Confirm plugin availability. Prepare one exact context snapshot and compile the explorer's scoped bundle; context drift or an explicit compiler marker stops dispatch and triggers a replan. Hand the verified bundle to the explorer, then run `/rigor:ground-truth` for the baseline. Size the change (one-off vs feature). For a feature, confirm the approach before building; a true one-off proceeds. Set the **automation level** (`§4`).

## Phase 1 — Safety net (risky / low-coverage areas)
If the change touches code with thin coverage, run `/rigor:safety-net` to characterize current behavior first, so the change is provably behavior-preserving where it should be.

## Phase 2 — Implement
Run the implementation loop (`§11`): the smallest correct change, matching existing conventions, upholding the quality lenses (`§10`). A feature ships its smallest valuable slice first (behind a flag if it isn't yet complete). Don't trade one issue for another. A new-dependency or library-choice decision routes through `/researcher:library-eval`; a claim or assumption needing verification before a design commitment uses `/researcher:research-verify`.

## Phase 3 — Prove
Add tests that fail before and pass after; keep the full suite green; run the regression guard (`rigor §H`) so nothing prior breaks. A change without a test that demonstrates it is not done.

Before trusting any composed skill's or dispatched operative's report at this or a later phase, check it has the shape its role promises (e.g. a proof artifact from `rigor`'s verifier, a leak verdict from the privacy gate) — anything null, empty, or short of that shape is a failed dispatch (`§1`), logged `failed` in `DISPATCH_LEDGER.md` (`§12`) and redispatched or deferred, never treated as a pass.

## Phase 4 — Privacy gate  *(if applicable)*
If the change touches egress, logging, identifiers, or a default — and `privacy-opsec-suite` is installed — run `/privacy-opsec-suite:metadata-leak-audit` scoped to the change's diff: no new leak/egress/identifier/fingerprint, fail-closed preserved. Its findings enter `FINDINGS_REGISTER.md`; surface any anonymity regression as blocking.

## Phase 5 — Review locally and finish traceless
Commit the final intended diff, then run `code-ops-suite:local-review-gate` before the PR exists. Its exact-SHA plan composes both local review roles, records both reports, and refuses stale or incomplete receipt coverage. A fix changes HEAD and requires both reviews again.

Ship the work as a clean PR: `code-ops-suite:pr-split` if it warrants a stack, otherwise a single PR scrubbed by `privacy-opsec-suite:authorship-hygiene`. `scan-ai-tells` passes fail-closed before push — if `privacy-opsec-suite` is not installed, run the bundled `${CLAUDE_PLUGIN_ROOT}/scripts/scan-ai-tells.mjs` over the commit/PR text directly as the gate. Push the branch, publish the local receipt statuses for that exact SHA, and only then open the PR. Hosted CI runs deterministic checks only. **Never auto-merge**.

If the repo carries an atlas (`code-ops-docs/98 System/Atlas/MANIFEST.json`, or `atlas/MANIFEST.json`), close the loop on it here: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/atlas-check.mjs check --atlas <atlas dir>`, and for any section this change turned STALE, refresh and stamp it **in this session** — the rationale behind the diff is hot now and unrecoverable later, which is why the update belongs to the change that caused it rather than to a future reader. When a full section rewrite is out of scope for this change, append the observation with the `inbox` subcommand and leave the section STALE instead.

## Done when
The change is implemented at the smallest correct scope, proven (failing→passing tests, suite + regression guard green), behavior-preserving where intended, privacy posture intact, reviewed locally against the final committed diff, docs updated, and shipped as a clean, trace-free PR/stack with nothing auto-merged. Present the local receipt identity, summary, PR link(s), and anything left for your decision.
