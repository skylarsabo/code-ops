---
name: rigor-sweep
description: "Use when you want the whole rigor suite run end-to-end as a checkpointed pipeline; start assess-only. Intra-plugin orchestrator."
---

# RIGOR SWEEP — The Whole Suite, End-to-End

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `rigor:rigor-sweep`.** First read the bundled `<plugin-root>/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
This skill **orchestrates the other skills in sequence** as one developer-in-the-loop pipeline — it doesn't replace them. It carries the registers and a growing **proof set** forward, keeps a master plan and a **coverage map**, and checks in at every phase boundary.

## Phase 0 — Scope the run  *(checkpoint)*
Detect the stack/size; confirm **track** (`assess-only` = facts + proven findings, no code changes · `full` = also fix/close/improve · or a custom subset) and scope. Open a master todo, a running `EXECUTIVE_SUMMARY.md`, and a coverage map. **Surface any CONFIRMED critical finding immediately.**

## Phase 1 — Ground truth
Run **ground-truth**: the deterministic toolchain becomes the factual baseline + coverage/blind-spot map.

## Phase 2 — Trust the tests
Run **test-suite-audit**: flaky/assertion/mutation check so you know where "green" is real before relying on it.

## Phase 3 — Find (read-only, with proofs)
Run **bug-hunt** (deep, per subsystem; root cause + sibling sweep) and **quality-scan**, both proving and disconfirming, into `FINDINGS_REGISTER.md`. (Use **regression-hunt** to bisect any confirmed regression.) → *Checkpoint:* review the **CONFIRMED-led** register; decide what to fix.

Before folding a dispatched tracer's or verifier's output into the register, gate it on shape — a tracer owes an evidence-cited trace/invariant map, a verifier owes a verdict plus its proof receipt; null, empty, or short of that shape counts as a failed dispatch (`§1`), marked accordingly in `DISPATCH_LEDGER.md` (`§10`) and redispatched or deferred, never synthesized around.

## Phase 4 — Safety net
Run **safety-net** on the blind spots and anything queued for change, so the next phase's fixes/refactors are provably behavior-preserving.

## Phase 5 — Fix (writes code — requires approval)
Run **fix-verified** on CONFIRMED bugs: each gets a failing→passing regression test, a root-cause fix, a sibling sweep, the regression guard, and an enforcement. → *Checkpoint per batch.*

## Phase 6 — Close inconsistencies
Run **consistency-closure**: approve a canonical form per concept, migrate every site, add the enforcement.

## Phase 7 — Improve (optional, as scoped)
Run **improve-measured**: only changes with a before/after metric ship.

## Done when
Every selected phase is complete; the test suite's trustworthiness is established; CONFIRMED bugs are fixed at root cause with regression proofs and siblings handled; inconsistencies are closed *and enforced*; improvements carry measured deltas; the regression guard is green; the master `EXECUTIVE_SUMMARY.md` separates CONFIRMED from PROBABLE/SPECULATIVE and states coverage; nothing code-changing happened without your approval.
