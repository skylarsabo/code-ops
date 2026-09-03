---
name: code-ops-suite-run-cost-audit
description: "Use when you want to audit a completed orchestrated run's cost discipline, covering dispatch counts, artifact sizes, and tier and effort mix, against the suite's own bounded-wave and routing doctrine. It consumes a finished run's artifact folder, not a live one."
---

# RUN COST AUDIT: Cost Discipline Over a Completed Run

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-run-cost-audit`, or by the model through the `skill` tool as `code-ops-suite-run-cost-audit`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin, and specifically the
bounded-wave fan-out rule and the model and effort routing (`§1`), plus the artifact-size length
discipline (`§12`) this skill audits against.
**Mode:** ASSESS · **Consumes:** a completed run's artifact folder, holding the registers,
`DISPATCH_LEDGER.md`, `EXECUTIVE_SUMMARY.md`, and their siblings · **Produces:** `COST_AUDIT.md`
and `RUN_CONFORMANCE.md`.

This skill audits how a finished run spent its budget, not whether its findings were correct.

It is also the **data producer** for the forward-looking half of the same loop. Every stamped
ledger it reads back is what
`node <plugin-root>/scripts/estimate-run-cost.mjs --runs <runs dir> --skill <name>` uses
at the next run's Phase 0, to estimate a dispatch-count range and a model-class mix before the
budget is spent. See `code-ops-docs/40 Engineering/Handbook/09-cost-and-scoping.md`.

## Phase 0: the collection

Run `node <plugin-root>/scripts/calibration-metrics.mjs --artifacts <run folder>` for the
raw counts: dispatches, the tier and effort mix where recorded, and artifact line counts. Then
run
`node <plugin-root>/scripts/dispatch-ledger.mjs check --ledger <run folder>/DISPATCH_LEDGER.md`
for the dispatch, redispatch, and failure rates, and for any dangling rows.

The session receipt ledger is the second source, and it is machine-recorded rather than authored.
`node <plugin-root>/scripts/context-audit.mjs receipts --by-arm` groups the sessions by
which context mechanisms were on, so a cost comparison has a control rather than an impression.
`code-ops-docs/55 Operations/MEASUREMENTS.md` owns the measurement method, and
`code-ops-docs/50 Platform/INFRASTRUCTURE.md` owns the switches those arms record.

## Phase 1: the assessment against doctrine

- **Bounded-wave discipline (`§1`).** Compare the ledger's per-wave dispatch counts against the handful-of-agents-at-a-time rule, and flag any wave that fanned out unbounded.
- **Artifact-size bounds (`§12`).** Run `node <plugin-root>/scripts/co.mjs scan narration <run folder>/EXECUTIVE_SUMMARY.md <other run summaries>`. A HARD hit is an over-length or narrated artifact, and an advisory is a borderline one.
- **Tier and effort mix.** Compare each dispatch's model tier and reasoning effort, taken from the ledger's brief text or the operative transcripts where recorded, against the routing table in `code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md`. Flag mechanical work routed above the tier its floor requires, and any judgment-bearing dispatch routed below the strong tier. Under-tiered judgment work is a cost finding, not a saving, so price the redispatches and the discarded reports it caused.

## Phase 1b: the orchestration-discipline score

Write `RUN_CONFORMANCE.md` in the check-row grammar of
`code-ops-docs/40 Engineering/Techniques/artifact-grammars.md`, carrying a check slug, a verdict
of `PASS`, `FAIL`, or `N/A`, and the evidence. Score only what the artifacts decide mechanically.
A rule this run could not violate is `N/A`, never a quiet PASS. There are five checks:
- `ledger-coverage`: every dispatched agent has a ledger row, cross-checked against the `DISPATCH_LEDGER.md` grammar on the same page.
- `no-dangling`: no row is left `dispatched` with no reported, failed, or redispatched successor.
- `tier-routing`: judgment-bearing roles ran at the strong tier, and mech-class work sat at or above its lint-enforced floor (`AGENT_MODEL_FLOORS`, mirrored in `code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md`).
- `effort-routing`: no low reasoning effort on a review dispatch, and no xhigh on a breadth sweep.
- `artifact-placement`: dated artifacts landed in the vault's `80 Runs/YYYY-MM-DD slug/` when the target repo carries a vault (`§12`). It is `N/A` when the repo carries none.

This score covers discipline, not outcome, and it gates nothing. `calibration-metrics.mjs` reads
the file back so the rates become a trend, and the verdict on the run stays with the lead.

## Phase 2: the report

Write `COST_AUDIT.md` at one page or less, under the `§12` length discipline. Give the **top
three cost drivers**, each with a concrete routing or bounding recommendation, and cite each
recommendation to the `DISPATCH_LEDGER.md` rows or artifact evidence that supports it. Never
report a general impression.

## Done when

- `RUN_CONFORMANCE.md` carries a row for all five checks, each `PASS`, `FAIL`, or `N/A` with the evidence that decided it.
- `COST_AUDIT.md` is produced, and every recommendation cites the ledger row or artifact evidence behind it.
- The report itself passes `node <plugin-root>/scripts/co.mjs scan narration COST_AUDIT.md` clean.
- The top three drivers are presented first.
