# Changelog — privacy-opsec-suite

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

## 1.3.0
- **New skill `authorship-hygiene`** + bundled `scripts/scan-ai-tells.mjs` — remove AI/tooling trace from commits/PRs/code across three surfaces: L1 metadata (attribution trailers, identity), L2 prose voice (match the author's style; kill assistant tells), L3 code-idiom blend-in (behavior-preserving; delegates repo-wide style to `normalize`, concept-divergence to `consistency-closure`). New CONVENTIONS §A non-negotiable: no tooling/AI trace in published work, fail-closed before push.

## 1.2.0
- **Register freshness:** CONVENTIONS §11 now mandates re-validating a leak before it is written, carried across a phase boundary, or consumed; added `Verified-at: <sha>` to the §6 leak schema and bundled `scripts/revalidate-register.mjs`; `opsec-hardening` runs it at Phase 0.
- **Evidence tiers + disconfirmation** added to the §6 leak schema (CONFIRMED/PROBABLE/SPECULATIVE).
- **Automation-level ladder** promoted into CONVENTIONS §4 (any anonymity-posture/egress/logging/identifier/default change is always gated; never auto-merge).
- **Multi-boundary control-coverage** rule added to the Egress & routing lens (§9).
- **Descriptions** rewritten to lead with `Use when…` triggers + lane-ownership clauses that disambiguate the overlapping audits (metadata-leak-audit vs fingerprint-resistance vs traffic-analysis-resistance vs anon-session-audit).

## 1.1.1
- **Docs:** the README now lists the `full-sweep` orchestrator (previously
  absent from the Skills section); the root README skill count is corrected to 13.
- **Packaging:** added an MIT `LICENSE` and a `license` field to the manifest.
- **Tooling:** covered by the new marketplace structural linter
  (`scripts/lint-plugins.mjs`) + CI.

## 1.1.0
- Privacy/anonymity & OpSec suite: `anonymity-threat-model`, `anon-session-audit`,
  `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`,
  `traffic-analysis-resistance`, `supply-chain-trust`, `opsec-hardening`,
  `privacy-feature-design`, `leak-incident-response`, `privacy-doc-alignment`,
  `opsec-pr-gate`, plus the `full-sweep` orchestrator. `explorer` +
  `privacy-reviewer` subagents; shared `CONVENTIONS.md` with the §A anonymity model.
