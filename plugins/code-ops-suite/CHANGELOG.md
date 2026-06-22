# Changelog — code-ops-suite

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

## 1.3.0
- **Register freshness (fixes the proven field failure):** CONVENTIONS SSOT (§12) now mandates re-validating a finding against the current tree before it is written, carried across a phase boundary, or consumed; added a `Verified-at: <sha>` field to the Finding/Idea schemas (§7) and bundled `scripts/revalidate-register.mjs` (reports FRESH/MOVED/GONE/NO-REF). `codebase-audit` + `feature-discovery` stamp it; `remediation` runs it at Phase 0.
- **Evidence tiers + disconfirmation** added to the §7 Finding schema (CONFIRMED/PROBABLE/SPECULATIVE + a disconfirmation pass; only CONFIRMED drives an auto-fix) — borrowed from `rigor`.
- **Automation-level ladder** (`gated`/`auto-safe`/`auto-all` + always-gated categories, never auto-merge) promoted into CONVENTIONS §4.
- **Multi-boundary control-coverage** rule added to the Security lens (§10).
- Standardized the audit→discovery handoff on `FEATURE_OPPORTUNITIES.md` (dropped `FEATURE_IDEAS.md`).
- **Descriptions** rewritten to lead with `Use when…` triggers + scope/ownership clauses (orchestrator scope; cross-skill overlap disambiguation, e.g. performance↔improve-measured, pr-review↔deep-review↔opsec-pr-gate, normalize↔consistency-closure).

## 1.2.1
- **Fix:** `full-sweep` Phase 6 referenced a non-existent `code-normalization`
  skill; corrected to `normalize` (the real skill slug / `/code-ops-suite:normalize`).
- **Docs:** the README now lists the `full-sweep` and `everything` orchestrators
  (previously absent from the Skills section); the root README skill count is
  corrected to 14.
- **Packaging:** added an MIT `LICENSE` and a `license` field to the manifest.
- **Tooling:** the marketplace now ships `scripts/lint-plugins.mjs` (structural
  linter) wired into CI, which catches this class of doc/reference drift.

## 1.2.0
- General-engineering suite: `codebase-audit`, `security-privacy-audit`,
  `remediation`, `feature-discovery`, `feature-implementation`, `performance`,
  `test-hardening`, `dependency-upgrade`, `pr-review`, `normalize`,
  `doc-alignment`, `onboarding`, plus the `full-sweep` and `everything`
  orchestrators. `explorer` + `reviewer` subagents; shared `CONVENTIONS.md`.
