---
name: run-cost-audit
description: "Use when you want to audit a completed orchestrated run's cost discipline — dispatch counts, artifact sizes, tier/effort mix — against the suite's own bounded-wave and routing doctrine. Consumes a finished run's artifact folder, not a live one."
---

# RUN COST AUDIT — Cost Discipline Over a Completed Run

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:run-cost-audit`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin — specifically the bounded-wave fan-out rule and model/effort routing (`§1`) and the artifact-size length discipline (`§12`) this skill audits against.
**Mode:** ASSESS · **Consumes:** a completed run's artifact folder (registers, `DISPATCH_LEDGER.md`, `EXECUTIVE_SUMMARY.md` and siblings) · **Produces:** `COST_AUDIT.md` and `RUN_CONFORMANCE.md`.

Audits how a finished run spent its budget, not whether its findings were correct.

## Phase 0 — Collect
Run `node <plugin-root>/scripts/calibration-metrics.mjs --artifacts <run folder>` for the raw counts (dispatches, tier/effort mix if recorded, artifact line counts), and `node <plugin-root>/scripts/dispatch-ledger.mjs check --ledger <run folder>/DISPATCH_LEDGER.md` for dispatch/redispatch/failure rates and any dangling rows.

## Phase 1 — Assess against doctrine
- **Bounded-wave discipline (`§1`).** Compare the ledger's per-wave dispatch counts against the "handful of agents at a time" rule; flag any wave that fans out unbounded.
- **Artifact-size bounds (`§12`).** Run `node <plugin-root>/scripts/scan-narration.mjs <run folder>/EXECUTIVE_SUMMARY.md <other run summaries>` — a HARD hit is an over-length or narrated artifact, an advisory is a borderline one.
- **Tier/effort mix.** Compare each dispatch's model tier and reasoning effort (from the ledger's brief text or the operative transcripts, where recorded) against the routing table in `docs/techniques/subagent-trade-offs.md` — flag mechanical work routed above the tier its floor requires, and any judgment-bearing dispatch routed below the strong tier. Under-tiered judgment work is a cost finding, not a saving: price the redispatches and the discarded reports it caused.

## Phase 1b — Score orchestration discipline
Write `RUN_CONFORMANCE.md` in the check-row grammar of `docs/techniques/artifact-grammars.md` — check slug, `PASS | FAIL | N/A`, evidence. Score only what the artifacts decide mechanically; a rule this run could not violate is `N/A`, never a quiet PASS. Five checks:

- `ledger-coverage` — every dispatched agent has a ledger row, cross-checked against the `DISPATCH_LEDGER.md` grammar on the same page.
- `no-dangling` — no row left `dispatched` with no reported, failed, or redispatched successor.
- `tier-routing` — judgment-bearing roles ran at the strong tier, and mech-class work sat at or above its lint-enforced floor (`AGENT_MODEL_FLOORS`, mirrored in `docs/techniques/subagent-trade-offs.md`).
- `effort-routing` — no low reasoning effort on a review dispatch, no xhigh on a breadth sweep.
- `artifact-placement` — dated artifacts landed in the vault's `80 Runs/YYYY-MM-DD slug/` when the target repo carries a vault (`§12`); `N/A` when it carries none.

This scores discipline, not outcome, and it gates nothing: `calibration-metrics.mjs` reads the file back so the rates become a trend, and the verdict on the run stays with the lead.

## Phase 2 — Report
Write `COST_AUDIT.md` (≤1 page, `§12` length discipline): the **top 3 cost drivers**, each with a concrete routing or bounding recommendation, each recommendation cited to the `DISPATCH_LEDGER.md` row(s) or artifact evidence that supports it — never a general impression.

## Done when
`RUN_CONFORMANCE.md` carries a row for all five checks, each `PASS`, `FAIL`, or `N/A` with the evidence that decided it; `COST_AUDIT.md` is produced; every recommendation cites the ledger row or artifact evidence behind it; and the report itself passes `node <plugin-root>/scripts/scan-narration.mjs COST_AUDIT.md` clean. Present the top 3 drivers first.
