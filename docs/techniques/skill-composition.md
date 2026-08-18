# Skill composition — the cross-skill invocation map

Most skills in this marketplace are self-contained: read `CONVENTIONS.md`, run the
loop, produce an artifact. A smaller set also *invoke* a named skill in another
plugin (or a sibling skill in their own plugin) mid-run — a fallback producer when
an expected register is missing, a baseline pass before the main work, or a
specialist audit gated on what the diff actually touches. This page is the ground
truth for those edges: every `/<plugin>:<skill>` reference found across
`plugins/*/skills/*/SKILL.md` bodies (excluding each skill's own self-declaring
"Invoked as" line).

## The edges

| From skill | Invokes | When | Artifact passed |
| --- | --- | --- | --- |
| `code-ops-suite:debug` | `rigor:ground-truth` | always, before tracing the symptom | `GROUND_TRUTH.md` |
| `code-ops-suite:debug` | `rigor:regression-hunt` | the bug is a regression — bisect to the introducing commit | none named (returns a commit) |
| `code-ops-suite:debug` | `privacy-opsec-suite:metadata-leak-audit` | fix touches egress/logging/identifiers/a default, and the plugin is installed | findings enter `FINDINGS_REGISTER.md`, fail-closed preserved |
| `code-ops-suite:conform` | `code-ops-suite:adopt-standards` | the standards-contract surface is drifted or absent | `CONFORMANCE_REPORT.md` (the contract verdict and parity mode) |
| `code-ops-suite:conform` | `code-ops-suite:vault` | the vault is absent, or `check-vault-standard.mjs` exits non-zero | `CONFORMANCE_REPORT.md` (the detected vault mode) |
| `code-ops-suite:conform` | `code-ops-suite:atlas` | the atlas is absent, or `atlas-check.mjs check` reports a STALE section | `CONFORMANCE_REPORT.md` (the STALE section list) |
| `code-ops-suite:conform` | `code-ops-suite:doc-alignment` | the assessment surfaced a drift signal between the contract, the vault, and the repo docs — never unconditionally | `CONFORMANCE_REPORT.md` (the drift signals) |
| `code-ops-suite:conform` | `code-ops-suite:adopt-global-standards` | opt-in only, after asking: the global contract's marketplace stamp is behind this checkout | none named (user-scope, outside the repo) |
| `code-ops-suite:everything` | `code-ops-suite:conform` | always, as the phase-0.5 standardization preflight, assess-only by default | `CONFORMANCE_REPORT.md` |
| `code-ops-suite:pr-split` | `rigor:ground-truth` | for the build/test/lint baseline | `GROUND_TRUTH.md` |
| `code-ops-suite:remediation` | `code-ops-suite:codebase-audit` (or `rigor:bug-hunt`) | `FINDINGS_REGISTER.md` is absent — fallback producer | `FINDINGS_REGISTER.md` |
| `code-ops-suite:ship` | `rigor:ground-truth` | for the baseline | `GROUND_TRUTH.md` |
| `code-ops-suite:ship` | `rigor:safety-net` | change touches thinly-covered code | none named (behavior characterization) |
| `code-ops-suite:ship` | `researcher:library-eval` | a new-dependency or library-choice decision | none named |
| `code-ops-suite:ship` | `researcher:research-verify` | a claim/assumption needs verification before a design commitment | none named |
| `code-ops-suite:ship` | `privacy-opsec-suite:metadata-leak-audit` | change touches egress/logging/identifiers/a default, and the plugin is installed | findings enter `FINDINGS_REGISTER.md`, anomaly regression surfaced as blocking |
| `rigor:bug-hunt` | `rigor:ground-truth` | `GROUND_TRUTH.md` is absent — fallback producer | `GROUND_TRUTH.md` |
| `rigor:fix-verified` | `rigor:bug-hunt` | `FINDINGS_REGISTER.md` is absent — fallback producer | `FINDINGS_REGISTER.md` |
| `rigor:quality-scan` | `rigor:ground-truth` | `GROUND_TRUTH.md` is absent — fallback producer | `GROUND_TRUTH.md` |

This branch's two additions are both present and grounded above: `ship`/`debug` →
`privacy-opsec-suite:metadata-leak-audit` (diff-scoped, gated on the fix/change
touching egress/logging/identifiers/a default) and `ship` →
`researcher:library-eval` + `researcher:research-verify` (dependency decisions and
pre-commitment claim checks).

## Standalone skills

Every skill not listed above issues no qualified `/<plugin>:<skill>` reference and
receives none — each runs its own loop against its own `CONVENTIONS.md` only. That
includes the sweep orchestrators (`code-ops-suite:full-sweep`, `rigor:rigor-sweep`,
`privacy-opsec-suite:full-sweep`, `researcher:research-sweep`), which sequence their
*own* plugin's skills by name in prose rather than by qualified reference.
`code-ops-suite:everything` is the one orchestrator with an edge of its own: it calls
`conform` as a preflight before its phases begin, and sequences the rest in prose.
This is intentional, not a coverage gap: `code-ops-suite` (20 of 32: everything but
`adopt-global-standards`, `adopt-standards`, `atlas`, `codebase-audit`, `conform`,
`debug`, `doc-alignment`, `everything`, `pr-split`, `remediation`, `ship`, `vault`),
`rigor` (5 of 11: `consistency-closure`, `deep-review`, `improve-measured`,
`rigor-sweep`, `test-suite-audit`), `privacy-opsec-suite` (13 of 14: everything but
`metadata-leak-audit`), and `researcher` (5 of 7: everything but `library-eval`,
`research-verify`).

## The handoff contract

An invocation only works if both sides agree on the artifact's shape. That contract
lives in each plugin's `CONVENTIONS.md` §6–§9 (schemas, evidence tiers, hand-off
map) — the standard filenames above (`GROUND_TRUTH.md`, `FINDINGS_REGISTER.md`) are
never ad hoc per skill.

*Verified-at: 2a921cb*
