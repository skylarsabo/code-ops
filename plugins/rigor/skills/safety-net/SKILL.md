---
description: "Use before refactoring or fixing low-coverage code. Writes characterization tests that lock current observable behavior."
---

# Safety net: pin behavior before you touch it

**Invoked as `/rigor:safety-net`.** First read the bundled
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows.

- **Mode:** IMPLEMENT. It adds tests and changes no production code.
- **Produces:** a characterization test suite, plus suspicious-behavior findings.
- **Purpose:** it gives the regression guard (`§H`) something concrete to protect.

## Phase 0: pick targets  *(checkpoint)*

Choose what to pin: the blind spots listed in `GROUND_TRUTH.md`, the code queued for a fix,
a refactor, or an improvement, and the high-risk modules. Confirm the scope.

## Phase 1: characterize current behavior

Dispatch a `tracer` to trace each target's current observable behavior across its call
sites, including its current quirks, because these tests pin behavior rather than
correctness. Write characterization tests from that trace and run them green against
current code. Exercise real edge and error inputs so the net is tight rather than
happy-path only. If you find behavior that looks wrong, do not fix it here. Record it in
`FINDINGS_REGISTER.md` as a candidate finding for `bug-hunt` or `fix-verified`.

## Deliverables

The characterization tests, committed and tagged so the regression guard can find them. A
list of the suspicious behaviors observed, written into `FINDINGS_REGISTER.md`. A note
naming the targets that are now safe to change.

## Done when

The targeted and blind-spot code has characterization coverage that passes on current code.
Suspicious behaviors are logged rather than fixed. A refactor or a fix in those areas can
now be proven behavior-preserving. Each kept characterization test is pinned with
`node ${CLAUDE_PLUGIN_ROOT}/scripts/check-proof-integrity.mjs record PROOF_MANIFEST.md <finding-id> <test path>`,
so a later fix batch mechanically detects a weakened or deleted proof (`§H`).
