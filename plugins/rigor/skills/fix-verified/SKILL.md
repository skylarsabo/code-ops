---
description: "Use when CONFIRMED bugs exist and you want them fixed at root cause with proof (failing-then-passing regression test, regression guard, sibling sweep, enforcement). Requires CONFIRMED findings as input."
disable-model-invocation: true
---

# FIX (VERIFIED) — Fix the Cause, Prove It, Guard the Class

**Invoked as `/rigor:fix-verified`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
**Mode:** IMPLEMENT · **Consumes:** `FINDINGS_REGISTER.md` · **Produces:** fixes (PRs) each with a before/after repro, `IMPLEMENTATION_LOG.md`, updated register. Fixes **CONFIRMED** items; a PROBABLE item must be reproduced (promoted to CONFIRMED) before it's fixed.

## Phase 0 — Re-validate & sequence  *(checkpoint)*
If `FINDINGS_REGISTER.md` is absent, stop — there is nothing verified to fix; route to `/rigor:bug-hunt` to produce one. **Never synthesize a register from memory.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .` as a fast staleness pre-filter (`CONVENTIONS §10`) — it now also flags a **`DRIFTED`** citation whose cited line no longer carries the finding's `Anchor` (`§E`), so a stale or hallucinated location is caught before you fix it. Then for each CONFIRMED finding confirm its **repro still fails** on current code (drop or re-tier anything that no longer reproduces). An item that reaches a fix on **static confidence rather than an executed repro** must have **survived independent refutation** (`§I`) — run one now if the register doesn't record it, and drop anything refuted; an item CONFIRMED by its own executed repro proceeds as-is. Build a dependency/conflict graph; sequence by demonstrated impact (`§D`). For **NEEDS-DESIGN** items, present options and get a direction first.

## Phase 1 — The fix–prove–guard loop (`§8`), per item
confirm the failing repro → trace to **root cause** (`§G`) and make the minimal correct fix **at the right layer** → the repro now passes **and** the full suite is green → **regression guard** (`§H`): re-run the entire accumulated proof set — nothing prior breaks (never weaken a proof to pass) → behavior-preservation check → **sweep for siblings** (`§G`): fix or register other sites of the same cause → **add an enforcement** so the class can't recur (kept regression test + a type/lint/assertion) → self-review → commit atomically referencing the finding ID + proof → update the register. Conflict-aware across items. If fixes start cascading, the **cascade circuit-breaker** (`§H`) stops the loop and escalates the cluster as NEEDS-DESIGN.

## Deliverables
Fixes as atomic PRs (tests + proof set green), each carrying its failing→passing repro; `IMPLEMENTATION_LOG.md` (change, proof, root cause, siblings handled, behavior notes); the register updated (closed-with-proof / deferred-with-reason).

## Done when
Every fixed bug has a regression test that failed before and passes now, is fixed at root cause, and its siblings are handled or registered; enforcements added; the regression guard is green (no prior proof broken); the suite is green.
