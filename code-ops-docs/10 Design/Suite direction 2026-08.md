---
type: design
status: draft
updated: 2026-08-18
tags:
  - design
  - roadmap
---

# Suite direction 2026-08

Source: the 2026-08-18 gap sweep and the research cross-pollination study (run artifacts in `80 Runs/2026-08-18 vault standardization/`). This note ranks what the sweeps found and records the boundary decisions. It proposes; nothing here is committed work.

## Mission check

The suite is production-ready for single-repo adoption. The gaps cluster in three areas: team and multi-repo coordination, silent enforcement holes on secondary hosts, and machinery that is retrospective where it could be predictive.

## Ranked gaps

1. **Multi-repo orchestration.** Every skill operates on one repo. Fleet-wide runs, cross-repo finding deduplication, and doctrine propagation have no skill and no doctrine. Largest wide-adoption blocker.
2. **Grok tier-floor hole.** Grok Build ignores agent `model:` frontmatter, so lint-enforced tier floors have no carrier there. A Phase 0 runtime tier check would close it.
3. **Pre-run cost estimation.** The cost model and the post-run auditor exist; a pre-flight estimate from prior dispatch ledgers does not. Turns budgeting from retrospective to predictive.
4. **Partial-plugin adoption paths.** The handbook assumes all four plugins. Commands needing a specific plugin set are not marked.
5. **Standards propagation.** `adopt-standards` is per-repo. A fleet has no mechanism to push a doctrine change outward. `conform` is the natural carrier.
6. **Audit-trail generation.** Checkpoints and registers exist, but no skill renders a compliance-grade approval log.
7. **CI host coverage.** Gate examples are GitHub-only.
8. **Calibration lesson export.** Lessons stay in the graph. A sanitized lesson library (counts and classes, no internals) could seed other installs.
9. **Vault adoption is optional.** `conform` reports ABSENT but nothing requires a vault. Decide: require, or keep advisory.
10. **Atlas and vault freshness are two mechanisms.** Both cache judgment with different staleness models. A unified freshness check is worth a design pass, not a merge by default.

## Innovation directions worth building

- **Predictive cost**: fit dispatch-ledger history to estimate a run's cost at Phase 0 (pairs with gap 3).
- **Ledger provider column**: record model class and provider per dispatch, enabling per-provider cost trends.
- **Register shape gate**: validate every register against the artifact grammars at orchestrator checkpoints, fail-closed.
- **Promotion links**: a `promoted-to` field on vault decisions, checked mechanically, so promotion stops being manual discipline.
- **Skill DAG**: formalize the composition map into declarable pipelines. Lint check 22 already pins the map to the tree.

## Cross-pollination decisions

Code-ops → research is unrestricted: the one-way calibration channel, paneled refutation, atlas-style protocol stamping, and the dispatch-ledger grammar all serve the research program directly.

Research → code-ops admits generic discipline only. Approved candidates: claims-register fields (exact wording, scope, contrary evidence) on public-facing CONFIRMED findings; minimum-publishable-unit checks in `ship`; protocol-deviation logging in `run-cost-audit`; preregistered quality targets before sweeps.

Excluded from the suite, as the owner's research IP: the R-005 mechanism-aware reliability program, trace-monitorability methodology, activation-intervention techniques, small-model training dynamics, sandbox assurance methods, and the AI-assisted vulnerability-research workflow. The suite ships discipline, never these methods.

## Suggested order

Close the enforcement holes first (gaps 2, and 9 as a decision), then the adoption path (4, 7), then predictive cost (3), then multi-repo (1, 5) as the next major arc. Lesson export (8) rides on the calibration work that just landed.
