# Changelog — rigor

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

## 2.1.0
- **Register freshness:** §10 SSOT now requires re-confirming a finding's proof still fails before it is written, carried across a phase boundary, or consumed; added `Verified-at: <sha>` to the §6 finding schema and bundled `scripts/revalidate-register.mjs` as a fast pre-filter; `fix-verified` runs it at Phase 0.
- **Automation-level ladder** (`gated` / `auto-safe` = CONFIRMED+NOW-SAFE / `auto-all`; always-gated categories; never auto-merge) promoted into CONVENTIONS §4.
- **Descriptions** rewritten to lead with `Use when…` triggers + scope clauses (orchestrator scope; deep-review as the high-rigor counterpart to code-ops-suite:pr-review).
- **Slimmed boilerplate:** the repeated ~50-word §-index recital in all 11 skill intros replaced with a concise methodology pointer (the full index lives in CONVENTIONS); a new lint guards against any skill copying a 40+ word passage verbatim from CONVENTIONS.

## 2.0.1
- **Packaging:** added an MIT `LICENSE` and a `license` field to the manifest.
- **Tooling:** covered by the new marketplace structural linter
  (`scripts/lint-plugins.mjs`) + CI. No skill behavior changes.

## 2.0.0
- Verification-first methodology v2: test-suite validation (flaky + mutation),
  characterization safety nets (`safety-net`), root-cause sibling sweeps,
  regression bisection (`regression-hunt`), and the regression guard. Skills:
  `ground-truth`, `test-suite-audit`, `safety-net`, `bug-hunt`, `regression-hunt`,
  `quality-scan`, `consistency-closure`, `improve-measured`, `fix-verified`,
  `deep-review`, and the `rigor-sweep` orchestrator. `tracer` + `verifier`
  subagents (verifier executes repros/mutations).
