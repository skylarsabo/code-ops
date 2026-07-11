---
name: safety-net
description: "Use before refactoring or fixing low-coverage code — writes characterization tests that lock current observable behavior."
---

# SAFETY NET — Pin Behavior Before You Touch It

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `rigor:safety-net`.** First read the bundled `<plugin-root>/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
**Mode:** IMPLEMENT (adds tests only; changes no production code) · **Produces:** a characterization test suite + suspicious-behavior findings. Gives the regression guard (`§H`) something concrete to protect.

## Phase 0 — Pick targets  *(checkpoint)*
Choose what to pin: the **blind spots** from `GROUND_TRUTH.md`, code queued for a fix/refactor/improvement, and high-risk modules. Confirm scope.

## Phase 1 — Characterize current behavior
Write **characterization tests** that capture *current observable behavior* of the targets — including current quirks (these pin behavior, not correctness) — and run them **green against current code**. Exercise real edge/error inputs so the net is tight, not just the happy path. If you find behavior that looks wrong, **do not fix it here** — record it in `FINDINGS_REGISTER.md` as a candidate finding for `bug-hunt`/`fix-verified`.

## Deliverables
The characterization tests, committed and tagged so the regression guard can find them; a list of suspicious behaviors observed → `FINDINGS_REGISTER.md`. A note of which targets are now safe to change.

## Done when
The targeted/blind-spot code has characterization coverage that passes on current code; suspicious behaviors are logged (not fixed); refactors and fixes in those areas can now be proven behavior-preserving. Each kept characterization test is pinned via `node <plugin-root>/scripts/check-proof-integrity.mjs record PROOF_MANIFEST.md <finding-id> <test path>` so later fix batches mechanically detect a weakened or deleted proof (`§H`).
