---
name: rigor-fix-verified
description: "Use when CONFIRMED bugs exist and you want them fixed at root cause with proof. Requires CONFIRMED findings as input."
---

# Verified fix: fix the cause, prove it, guard the class

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/rigor/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/rigor-fix-verified`, or by the model through the `skill` tool as `rigor-fix-verified`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows.

- **Mode:** IMPLEMENT.
- **Consumes:** `FINDINGS_REGISTER.md`.
- **Produces:** fixes as pull requests, each with a before-and-after repro, plus
  `IMPLEMENTATION_LOG.md` and the updated register.
- **Eligibility:** it fixes CONFIRMED items. A PROBABLE item must be reproduced, and so
  promoted to CONFIRMED, before it is fixed.

## Phase 0. Re-validate and sequence  *(checkpoint)*

If `FINDINGS_REGISTER.md` is absent, stop. There is nothing verified to fix, so route to
`/rigor-bug-hunt` to produce one. Never synthesize a register from memory.

Run `node <plugin-root>/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .`
as a fast staleness pre-filter (`CONVENTIONS §10`). It also flags a `DRIFTED` citation whose
cited line no longer carries the finding's Anchor (`§E`), so a stale or hallucinated location
is caught before you fix it. Then, for each CONFIRMED finding, have a `verifier` confirm
that its repro still fails on current code, and drop or re-tier anything that no longer
reproduces.

Where the run produced `RUN_RECEIPTS.md`, replay it with
`node <plugin-root>/scripts/run-proof.mjs verify RUN_RECEIPTS.md --root .`. Where a
`PROOF_MANIFEST.md` exists, run
`node <plugin-root>/scripts/check-proof-integrity.mjs verify PROOF_MANIFEST.md --root .`.
An exit-code mismatch or a tampered pinned proof drops or re-tiers the item before any fix
(`§H`).

An item that reaches a fix on static confidence rather than an executed repro must have
survived independent refutation (`§I`). Run one now if the register does not record it, and
drop anything refuted. An item CONFIRMED by its own executed repro proceeds as it stands.

Build a dependency and conflict graph, then sequence by demonstrated impact (`§D`). For a
NEEDS-DESIGN item, present the options and get a direction first.

## Phase 1. The fix-prove-guard loop (`§8`), per item

1. A `verifier` confirms the failing repro.
2. A `tracer` traces the item to its root cause (`§G`), and you make the minimal correct fix
   at the right layer.
3. The `verifier` confirms that the repro now passes and that the full suite is green.
4. The regression guard runs (`§H`): the `verifier` re-runs the entire accumulated proof
   set, and nothing prior may break. Never weaken a proof to make it pass.
5. Check behavior preservation.
6. Sweep for siblings (`§G`): a `tracer` finds other sites of the same cause, and you fix or
   register each one.
7. Add an enforcement so the class cannot recur, meaning a kept regression test plus a type,
   lint, or assertion guard.
8. Self-review, commit atomically referencing the finding ID and its proof, then update the
   register.

Stay conflict-aware across items. If fixes start cascading, the cascade circuit-breaker
(`§H`) stops the loop and escalates the cluster as NEEDS-DESIGN.

## Deliverables

Fixes as atomic pull requests, with tests and the proof set green, each carrying its
failing-then-passing repro. `IMPLEMENTATION_LOG.md` records the change, the proof, the root
cause, the siblings handled, and the behavior notes. The register is updated, with each item
either closed-with-proof or deferred-with-reason.

## Done when

Every fixed bug has a regression test that failed before and passes now, is fixed at root
cause, and has its siblings handled or registered. Enforcements are added. The regression
guard is green, with no prior proof broken, and the suite is green. The updated
`FINDINGS_REGISTER.md` passes
`node <plugin-root>/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root . --consumed <pre-run copy>`,
so no consumed item vanishes or closes without a pinned terminal form.
