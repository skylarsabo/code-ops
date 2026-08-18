# Skill composition — the cross-skill invocation map

Most skills in this marketplace are self-contained: read `CONVENTIONS.md`, run the
loop, produce an artifact. A smaller set also *invoke* a named skill in another
plugin (or a sibling skill in their own plugin) mid-run — a fallback producer when
an expected register is missing, a baseline pass before the main work, or a
specialist audit gated on what the diff actually touches. A larger set names another
skill without calling it: a hand-off target for work that leaves the current skill's
mandate, or a routing pointer telling the reader which neighbor fits better.

This page is the ground truth for both. It carries one row for every qualified
`<plugin>:<skill>` reference (with or without the leading slash) found in
`plugins/*/skills/*/SKILL.md`, excluding each skill's own self-declaring "Invoked as"
line and its own name. The **When** column says which kind of edge each row is.
`scripts/lint-plugins.mjs` derives the same set and fails closed when a reference has
no row, or a row has no reference.

## The edges

| From skill | Invokes | When | Artifact passed |
| --- | --- | --- | --- |
| `code-ops-suite:adopt-standards` | `code-ops-suite:vault` | hand-off — the repo carries or adopts a `<repo>-docs/` vault the contract must route to | none named (the vault's `Standard.md`) |
| `code-ops-suite:calibration-run` | `code-ops-suite:full-sweep` | dispatched in the `assess-only` track as the mechanism under calibration | the run folder's registers and `EXECUTIVE_SUMMARY.md` |
| `code-ops-suite:calibration-run` | `rigor:rigor-sweep` | same, when `rigor` is the mechanism under calibration | the run folder's registers and `EXECUTIVE_SUMMARY.md` |
| `code-ops-suite:conform` | `code-ops-suite:adopt-standards` | the standards-contract surface is drifted or absent | `CONFORMANCE_REPORT.md` (the contract verdict and parity mode) |
| `code-ops-suite:conform` | `code-ops-suite:vault` | the vault is absent, or `check-vault-standard.mjs` exits non-zero | `CONFORMANCE_REPORT.md` (the detected vault mode) |
| `code-ops-suite:conform` | `code-ops-suite:atlas` | the atlas is absent, or `atlas-check.mjs check` reports a STALE section | `CONFORMANCE_REPORT.md` (the STALE section list) |
| `code-ops-suite:conform` | `code-ops-suite:doc-alignment` | the assessment surfaced a drift signal between the contract, the vault, and the repo docs — never unconditionally | `CONFORMANCE_REPORT.md` (the drift signals) |
| `code-ops-suite:conform` | `code-ops-suite:adopt-global-standards` | opt-in only, after asking: the global contract's marketplace stamp is behind this checkout | none named (user-scope, outside the repo) |
| `code-ops-suite:debug` | `rigor:ground-truth` | always, before tracing the symptom | `GROUND_TRUTH.md` |
| `code-ops-suite:debug` | `rigor:regression-hunt` | the bug is a regression — bisect to the introducing commit | none named (returns a commit) |
| `code-ops-suite:debug` | `rigor:fix-verified` | always, for the fix loop: repro passes, regression guard holds, sibling sweep, enforcement | `FINDINGS_REGISTER.md` |
| `code-ops-suite:debug` | `privacy-opsec-suite:metadata-leak-audit` | fix touches egress/logging/identifiers/a default, and the plugin is installed | findings enter `FINDINGS_REGISTER.md`, fail-closed preserved |
| `code-ops-suite:debug` | `privacy-opsec-suite:authorship-hygiene` | always, before push — the traceless gate | none named (scrubbed commits/PR) |
| `code-ops-suite:debug` | `code-ops-suite:pr-split` | the fix is multi-part and ships as a stack | none named (a PR stack) |
| `code-ops-suite:everything` | `code-ops-suite:conform` | always, in phase 0 before any register opens — assess-only by default | `CONFORMANCE_REPORT.md` |
| `code-ops-suite:everything` | `rigor:deep-review` | hand-off — the PR gate to wire in at phase 11 | none named (the review verdict) |
| `code-ops-suite:everything` | `privacy-opsec-suite:opsec-pr-gate` | hand-off — the anonymity PR gate to wire in at phase 11 | none named (the gate verdict) |
| `code-ops-suite:normalize` | `rigor:consistency-closure` | routing pointer — divergent implementations of one concept go there instead | none (routing pointer) |
| `code-ops-suite:performance` | `rigor:improve-measured` | routing pointer — broad behavior-preserving measured wins go there instead | none (routing pointer) |
| `code-ops-suite:pr-review` | `rigor:deep-review` | routing pointer — a verification-bar review blocking only on reproduced defects | none (routing pointer) |
| `code-ops-suite:pr-review` | `privacy-opsec-suite:opsec-pr-gate` | routing pointer — the anonymity gate | none (routing pointer) |
| `code-ops-suite:pr-split` | `rigor:ground-truth` | for the build/test/lint baseline | `GROUND_TRUTH.md` |
| `code-ops-suite:pr-split` | `privacy-opsec-suite:authorship-hygiene` | always, fail-closed, before any push | none named (scrubbed commits/PRs) |
| `code-ops-suite:remediation` | `code-ops-suite:codebase-audit` | `FINDINGS_REGISTER.md` is absent — fallback producer | `FINDINGS_REGISTER.md` |
| `code-ops-suite:remediation` | `rigor:bug-hunt` | same fallback, when the register should be proof-backed | `FINDINGS_REGISTER.md` |
| `code-ops-suite:ship` | `rigor:ground-truth` | for the baseline | `GROUND_TRUTH.md` |
| `code-ops-suite:ship` | `rigor:safety-net` | change touches thinly-covered code | none named (behavior characterization) |
| `code-ops-suite:ship` | `researcher:library-eval` | a new-dependency or library-choice decision | none named |
| `code-ops-suite:ship` | `researcher:research-verify` | a claim/assumption needs verification before a design commitment | none named |
| `code-ops-suite:ship` | `privacy-opsec-suite:metadata-leak-audit` | change touches egress/logging/identifiers/a default, and the plugin is installed | findings enter `FINDINGS_REGISTER.md`, anomaly regression surfaced as blocking |
| `code-ops-suite:ship` | `privacy-opsec-suite:authorship-hygiene` | always — the traceless finish | none named (scrubbed commits/PRs) |
| `code-ops-suite:ship` | `code-ops-suite:pr-split` | the change ships as a stack rather than one PR | none named (a PR stack) |
| `code-ops-suite:test-hardening` | `rigor:test-suite-audit` | routing pointer — auditing whether existing tests catch faults goes there | none (routing pointer) |
| `code-ops-suite:vault` | `code-ops-suite:adopt-standards` | hand-off — the contract pair owns the documentation section routing to the vault | none named (the contract pair) |
| `privacy-opsec-suite:authorship-hygiene` | `code-ops-suite:normalize` | hand-off — repo-wide one-style work is out of this skill's scope | none named |
| `privacy-opsec-suite:authorship-hygiene` | `rigor:consistency-closure` | hand-off — divergent implementations of one concept are out of scope | none named |
| `privacy-opsec-suite:opsec-pr-gate` | `code-ops-suite:pr-review` | routing pointer — the quality-lens counterpart | none (routing pointer) |
| `privacy-opsec-suite:opsec-pr-gate` | `rigor:deep-review` | routing pointer — the verification-bar counterpart | none (routing pointer) |
| `researcher:ecosystem-watch` | `code-ops-suite:dependency-upgrade` | hand-off — CVEs and version bumps | `ECOSYSTEM_WATCH.md` |
| `researcher:ecosystem-watch` | `privacy-opsec-suite:supply-chain-trust` | hand-off — egress/telemetry/provenance concerns | `ECOSYSTEM_WATCH.md` |
| `researcher:library-eval` | `code-ops-suite:adr` | hand-off — the decision and its rejected alternatives | none named |
| `researcher:library-eval` | `code-ops-suite:dependency-upgrade` | hand-off — adoption, migration, and any version bump | none named |
| `researcher:library-eval` | `privacy-opsec-suite:supply-chain-trust` | hand-off — flagged trust/egress concerns | none named |
| `researcher:research-ideate` | `code-ops-suite:feature-discovery` | routing pointer — ideas mined from the codebase alone go there | none (routing pointer) |
| `researcher:research-ideate` | `code-ops-suite:adr` | hand-off — an idea worth recording as a decision | `IDEAS_REGISTER.md` |
| `researcher:research-ideate` | `code-ops-suite:feature-implementation` | hand-off — the build | `IDEAS_REGISTER.md` |
| `researcher:research-improve` | `code-ops-suite:remediation` | hand-off — grounded improvements to implement | `RESEARCH_FINDINGS.md` |
| `researcher:research-improve` | `rigor:fix-verified` | hand-off — improvements needing proof-backed fixes | `RESEARCH_FINDINGS.md` |
| `researcher:research-improve` | `rigor:improve-measured` | hand-off — improvements needing a measured before→after delta | `RESEARCH_FINDINGS.md` |
| `researcher:research-spike` | `code-ops-suite:adr` | hand-off — an architectural decision worth recording | the design brief |
| `researcher:research-spike` | `code-ops-suite:feature-implementation` | hand-off — the build, when specs exist | the design brief |
| `researcher:research-spike` | `code-ops-suite:ship` | hand-off — the build, as one end-to-end change | the design brief |
| `researcher:research-sweep` | `code-ops-suite:adr` | hand-off — decisions surfaced by the sweep | `RESEARCH_FINDINGS.md` |
| `researcher:research-sweep` | `code-ops-suite:dependency-upgrade` | hand-off — dependency work | `RESEARCH_FINDINGS.md` |
| `researcher:research-sweep` | `code-ops-suite:feature-discovery` | hand-off — features and ideas | `RESEARCH_FINDINGS.md` |
| `researcher:research-sweep` | `code-ops-suite:feature-implementation` | hand-off — the build | `RESEARCH_FINDINGS.md` |
| `researcher:research-sweep` | `code-ops-suite:remediation` | hand-off — grounded improvements | `RESEARCH_FINDINGS.md` |
| `researcher:research-sweep` | `code-ops-suite:ship` | hand-off — the build, as one end-to-end change | `RESEARCH_FINDINGS.md` |
| `researcher:research-sweep` | `privacy-opsec-suite:supply-chain-trust` | hand-off — trust/egress concerns | `RESEARCH_FINDINGS.md` |
| `researcher:research-sweep` | `rigor:fix-verified` | hand-off — proof-backed fixes | `RESEARCH_FINDINGS.md` |
| `researcher:research-sweep` | `rigor:improve-measured` | hand-off — measured improvements | `RESEARCH_FINDINGS.md` |
| `researcher:research-verify` | `code-ops-suite:remediation` | hand-off — entries cleared by the verdict report | the verdict report |
| `researcher:research-verify` | `rigor:fix-verified` | hand-off — cleared entries needing proof-backed fixes | the verdict report |
| `researcher:research-verify` | `rigor:improve-measured` | hand-off — cleared entries needing a measured delta | the verdict report |
| `rigor:bug-hunt` | `rigor:ground-truth` | `GROUND_TRUTH.md` is absent — fallback producer | `GROUND_TRUTH.md` |
| `rigor:consistency-closure` | `code-ops-suite:normalize` | routing pointer — whole-repo style normalization goes there | none (routing pointer) |
| `rigor:deep-review` | `code-ops-suite:pr-review` | routing pointer — the all-lenses counterpart | none (routing pointer) |
| `rigor:fix-verified` | `rigor:bug-hunt` | `FINDINGS_REGISTER.md` is absent — fallback producer | `FINDINGS_REGISTER.md` |
| `rigor:improve-measured` | `code-ops-suite:performance` | routing pointer — profiling-led hot-path work goes there | none (routing pointer) |
| `rigor:quality-scan` | `rigor:ground-truth` | `GROUND_TRUTH.md` is absent — fallback producer | `GROUND_TRUTH.md` |

## Standalone skills

Every skill not named above issues no qualified reference and receives none — each
runs its own loop against its own `CONVENTIONS.md` only. Twenty of the marketplace's
sixty-four skills are standalone, and they fall in two plugins:

- `code-ops-suite` (10 of 32): `api-docs`, `architecture`, `current-docs`,
  `data-model`, `handoff`, `onboarding`, `ops-docs`, `provider-parity-audit`,
  `run-cost-audit`, `security-privacy-audit`.
- `privacy-opsec-suite` (10 of 14): `anon-session-audit`, `anonymity-threat-model`,
  `fingerprint-resistance`, `full-sweep`, `leak-incident-response`,
  `opsec-hardening`, `privacy-doc-alignment`, `privacy-feature-design`,
  `tor-egress-audit`, `traffic-analysis-resistance`.

Every `rigor` skill (11 of 11) and every `researcher` skill (7 of 7) carries at least
one edge.

Three of the four sweep orchestrators — `code-ops-suite:full-sweep`,
`privacy-opsec-suite:full-sweep`, and `rigor:rigor-sweep` — sequence their *own*
plugin's skills by name in prose rather than by qualified reference, so they appear
here only as targets, never as sources. `researcher:research-sweep` is the exception:
it names nine qualified hand-off targets. `code-ops-suite:everything` is the only
orchestrator that calls another skill outright — `conform`, in phase 0 — and it also
names `rigor:deep-review` and `privacy-opsec-suite:opsec-pr-gate` as the PR gates its
final phase hands off to.

## The handoff contract

An invocation only works if both sides agree on the artifact's shape. That contract
lives in each plugin's `CONVENTIONS.md` §6–§9 (schemas, evidence tiers, hand-off
map) — the standard filenames above (`GROUND_TRUTH.md`, `FINDINGS_REGISTER.md`) are
never ad hoc per skill.

*Verified-at: 4cbb343*
