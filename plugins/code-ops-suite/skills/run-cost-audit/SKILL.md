---
description: "Use when you want to audit a completed orchestrated run's cost discipline — dispatch counts, artifact sizes, tier/effort mix — against the suite's own bounded-wave and routing doctrine. Consumes a finished run's artifact folder, not a live one."
---

# RUN COST AUDIT — Cost Discipline Over a Completed Run

**Invoked as `/code-ops-suite:run-cost-audit`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin — specifically the bounded-wave fan-out rule and model/effort routing (`§1`) and the artifact-size length discipline (`§12`) this skill audits against.
**Mode:** ASSESS · **Consumes:** a completed run's artifact folder (registers, `DISPATCH_LEDGER.md`, `EXECUTIVE_SUMMARY.md` and siblings) · **Produces:** `COST_AUDIT.md`.

Audits how a finished run spent its budget, not whether its findings were correct.

## Phase 0 — Collect
Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/calibration-metrics.mjs --artifacts <run folder>` for the raw counts (dispatches, tier/effort mix if recorded, artifact line counts), and `node ${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-ledger.mjs check --ledger <run folder>/DISPATCH_LEDGER.md` for dispatch/redispatch/failure rates and any dangling rows.

## Phase 1 — Assess against doctrine
- **Bounded-wave discipline (`§1`).** Compare the ledger's per-wave dispatch counts against the "handful of agents at a time" rule; flag any wave that fans out unbounded.
- **Artifact-size bounds (`§12`).** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/scan-narration.mjs <run folder>/EXECUTIVE_SUMMARY.md <other run summaries>` — a HARD hit is an over-length or narrated artifact, an advisory is a borderline one.
- **Tier/effort mix.** Compare each dispatch's model tier and reasoning effort (from the ledger's brief text or the operative transcripts, where recorded) against the routing table in `docs/techniques/subagent-trade-offs.md` — flag mechanical work routed to a higher tier than its floor requires, and judgment work routed below its floor.

## Phase 2 — Report
Write `COST_AUDIT.md` (≤1 page, `§12` length discipline): the **top 3 cost drivers**, each with a concrete routing or bounding recommendation, each recommendation cited to the `DISPATCH_LEDGER.md` row(s) or artifact evidence that supports it — never a general impression.

## Done when
`COST_AUDIT.md` is produced; every recommendation cites the ledger row or artifact evidence behind it; and the report itself passes `node ${CLAUDE_PLUGIN_ROOT}/scripts/scan-narration.mjs COST_AUDIT.md` clean. Present the top 3 drivers first.
