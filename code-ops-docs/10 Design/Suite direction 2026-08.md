---
type: design
status: draft
updated: 2026-09-03
tags:
  - design
  - roadmap
---

# Suite direction 2026-08

Source: the 2026-08-18 gap sweep and the research cross-pollination study (run artifacts in `80 Runs/2026-08-18 vault standardization/`). This note ranks what the sweeps found and records the boundary decisions. It proposes. Nothing here is committed work.

Three gaps have shipped code since the sweep. Each carries a **Shipped** line naming the file that closed it, checked against the tree on 2026-09-03. The other seven stand as the sweep left them.

## Mission check

The suite is production-ready for single-repo adoption. The gaps cluster in three areas:

- team and multi-repo coordination
- silent enforcement holes on secondary hosts
- machinery that reports after a run when it could report before one

## Ranked gaps

1. **Multi-repo orchestration.** Every skill operates on one repo. Fleet-wide runs, cross-repo finding deduplication, and doctrine propagation have no skill and no doctrine. Largest blocker to wide adoption.
   **Shipped, in part:** `scripts/check-fleet.mjs` reads a `FLEET.json` manifest and reports one conformance row per member per surface, and the fleet mode of the `conform` skill repairs member by member. Cross-repo finding deduplication stays open, and [[Cross-repo judgment]] states why.
2. **Tier-floor hole on a host that ignores agent frontmatter.** One host does not parse an agent's `model:` frontmatter, so the lint-enforced tier floors have no carrier there. A runtime tier check at Phase 0 would close it.
   **Shipped, in part:** `scripts/preflight.mjs` prints every bundled agent's declared floor at the start of a run, so the lead can route by hand. The floors still have no mechanical carrier on that host.
3. **Pre-run cost estimation.** The cost model and the post-run auditor exist. No pre-flight estimate reads prior dispatch ledgers, so a budget is only ever known after it is spent.
   **Shipped:** `scripts/estimate-run-cost.mjs --runs <dir>` reads prior `DISPATCH_LEDGER.md` files and prints a dispatch-count range and a model-class mix. It prints no money figure, because per-token prices drift.
4. **Partial-plugin adoption paths.** The handbook assumes all four plugins. Commands needing a specific plugin set are not marked.
5. **Standards propagation.** `adopt-standards` is per-repo. A fleet has no mechanism to push a doctrine change outward. `conform` is the natural carrier.
   **Shipped:** the fleet mode of `conform` names doctrine propagation as its canonical use, and it carries a moved source of truth to each consenting member as an ordinary reviewed change.
6. **Audit-trail generation.** Checkpoints and registers exist, but no skill renders a compliance-grade approval log.
7. **CI host coverage.** Gate examples name GitHub Actions only.
8. **Calibration lesson export.** Lessons stay in the graph. A sanitized lesson library, holding counts and classes and no internals, could seed other installations.
9. **Vault adoption is optional.** `conform` reports ABSENT, and nothing requires a vault. Decide whether to require one or keep the report advisory.
10. **Atlas and vault freshness are two mechanisms.** Both cache judgment under different staleness models. A unified freshness check is worth a design pass, not a merge by default.

## Innovation directions worth building

- **Predictive cost:** fit dispatch-ledger history to estimate a run's cost at Phase 0, which pairs with gap 3.
- **Ledger provider column:** record model class and provider for each dispatch, which enables per-provider cost trends.
- **Register shape gate:** validate every register against the artifact grammars at orchestrator checkpoints, fail-closed.
- **Promotion links:** add a `promoted-to` field on vault decisions, checked mechanically, so promotion stops being manual discipline.
- **Skill DAG:** formalize the composition map into declarable pipelines. Lint check 22 already pins the map to the tree.

## Cross-pollination decisions

Code-ops to research is unrestricted. The one-way calibration channel, paneled refutation, atlas-style protocol stamping, and the dispatch-ledger grammar all serve the research program directly.

Research to code-ops admits generic discipline only. The approved candidates are:

- claims-register fields, meaning exact wording, scope, and contrary evidence, on public-facing CONFIRMED findings
- minimum-publishable-unit checks in `ship`
- protocol-deviation logging in `run-cost-audit`
- preregistered quality targets before sweeps

Excluded from the suite, as the owner's research property: the R-005 mechanism-aware reliability program, trace-monitorability methodology, activation-intervention techniques, small-model training dynamics, sandbox assurance methods, and the AI-assisted vulnerability-research workflow. The suite ships discipline, never these methods.

## Suggested order

The sweep proposed this order: close the enforcement holes first, meaning gap 2 and a decision on gap 9. Then take the adoption path in gaps 4 and 7. Then take predictive cost in gap 3. Then take multi-repo work in gaps 1 and 5 as the next major arc. Lesson export in gap 8 follows the calibration work that landed with the sweep.

Work since then took gaps 3, 5, and part of 1 out of order. What remains, ranked as the sweep ranked it, is gap 9 as a decision, then gaps 4 and 7, then the cross-repo half of gap 1.

Related: [[Cross-repo judgment]], `code-ops-docs/40 Engineering/Techniques/fleet-standard.md`.
