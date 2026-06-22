---
description: "Use when you want the most exhaustive end-to-end pass across all three plugins (map to prove to leak-audit to fix to close to improve); token-expensive and checkpointed. Cross-plugin superset — requires code-ops-suite, rigor, and privacy-opsec-suite installed."
disable-model-invocation: true
---

# EVERYTHING — The Full Pass Across All Three Suites

**Invoked as `/code-ops-suite:everything`.** This orchestrates every workflow across the three code-ops plugins into one exhaustive pipeline. It does not replace the individual skills — it runs them in the right order, deduplicated, carrying every register and a growing **proof set** forward, and checking in at phase boundaries.

**Prerequisites:** `code-ops-suite`, `rigor`, and `privacy-opsec-suite` all installed. First read this plugin's `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`, then also load the `CONVENTIONS.md` and the relevant skill files from the **rigor** and **privacy-opsec-suite** plugins (search the plugin directories) so each phase applies its governing methodology — especially rigor's verification-first rules (evidence tiers, the disconfirmation pass, the regression guard).

**Cost & shape:** this is deliberately the most thorough and most token-expensive option. It is **phased with checkpoints, not a blind firehose** — you can widen or narrow scope and dial check-ins up or down at Phase 0.

## Phase 0 — Scope, automation level & preflight  *(checkpoint)*
Detect the stack/size; confirm all three plugins are available. Confirm with me:
- **Scope** — the whole repo, or the riskiest subsystems first (recommended for large repos; bug-hunting goes deep per subsystem).
- **Privacy track** — include the privacy-opsec phases? (yes if the project has anonymity/opsec requirements; otherwise skip them).
- **Remediation automation level** — governs every code-changing phase:
  - `gated` *(default)* — pause for my approval at each fix/closure batch.
  - `auto-safe` *(recommended ceiling)* — automatically apply **CONFIRMED + NOW-SAFE** fixes (each on a branch, each carrying a failing→passing regression test, each passing the regression guard); pause only for NEEDS-REVIEW, NEEDS-DESIGN, and the always-gated categories.
  - `auto-all` — *not recommended*; even here the always-gated categories still stop for me, and NEEDS-DESIGN is never auto-applied.
  - **Always gated, regardless of level:** security/auth changes, secret handling, data migrations or destructive operations, public API/contract changes, and anything irreversible.
- **Check-in level** — normal (per phase) or minimal (only at the consolidated review + always-gated items).
Open the master registers (`FINDINGS_REGISTER.md`, `CONSISTENCY_REGISTER.md`, and `LEAK_REGISTER.md` if privacy is in scope), a running `EXECUTIVE_SUMMARY.md`, a coverage map, and a growing proof set. **Surface any CONFIRMED critical finding immediately.** Always work on a branch; **never auto-merge** — even fully-auto fixes land as commits/PRs for review.

## Phase 1 — Map  *(code-ops-suite)*
`doc-alignment` → `codebase-audit` → `security-privacy-audit`. An accurate map of the codebase and a broad first-pass register.

## Phase 2 — Ground truth & test trust  *(rigor)*
`ground-truth` → `test-suite-audit`. Facts from the real toolchain, plus where "green" is trustworthy and where the coverage blind spots are.

## Phase 3 — Prove  *(rigor)*
`bug-hunt` (deep per subsystem; root cause + sibling sweep) + `quality-scan`, everything tiered and disconfirmed; `regression-hunt` to bisect any regression. Merge into `FINDINGS_REGISTER.md`.

## Phase 4 — Anonymity & leak audits  *(privacy-opsec-suite — if in scope)*
`anonymity-threat-model` → `anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`, `traffic-analysis-resistance`, `supply-chain-trust` → `LEAK_REGISTER.md`.

## Phase 5 — Safety net  *(rigor)*
`safety-net`: characterization tests pinning current behavior on the blind spots and everything queued for change, so the fixes ahead are provably behavior-preserving.

## Phase 6 — Consolidated review  *(checkpoint — the main go/no-go)*
Present one prioritized, **CONFIRMED-led** picture across bugs, quality, leaks, and inconsistencies, with the remediation plan and the automation level in effect.

## Phase 7 — Remediate  *(rigor `fix-verified` + code-ops `remediation` + privacy-opsec `opsec-hardening`)*
Per the chosen automation level: fix CONFIRMED bugs at root cause (failing→passing regression test, regression guard, sibling sweep, enforcement); apply security/privacy fixes with fail-closed where relevant. Each change tested, behavior-preserving, atomic, on the branch.

## Phase 8 — Close inconsistencies  *(rigor `consistency-closure`)*
One canonical form per concept (approved unless the level is `auto-safe`/`auto-all` and the choice is clearly mechanical) → migrate every site → add the enforcement so it can't recur.

## Phase 9 — Improve  *(rigor `improve-measured` + code-ops `performance` + `dependency-upgrade`)*
Only changes with a measured before→after delta ship; behavior-preserving.

## Phase 10 — Normalize & capture state  *(code-ops `normalize` + `doc-alignment` + `onboarding`)*
One consistent style with an enforced config; reconcile docs; write/refresh onboarding + architecture docs so the now-accurate state is captured.

## Phase 11 — Final verification & report
Full suite + the entire proof set green; regression guard clean (no prior proof broken). Produce the master `EXECUTIVE_SUMMARY.md` tying together what was found, proven, fixed, closed, and improved — **CONFIRMED separated from PROBABLE/SPECULATIVE** — with the coverage map and anything still awaiting a decision. Note the PR gates to wire in (`rigor:deep-review`, `privacy-opsec-suite:opsec-pr-gate`).

## Done when
Every in-scope phase is complete; CONFIRMED bugs are fixed at root cause with regression proofs; inconsistencies are closed and enforced; improvements carry measured deltas; privacy leaks (if in scope) are closed and locked; the proof set and suite are green; the master summary is delivered; and nothing in an always-gated category — and, under `gated`, nothing code-changing — happened without your approval.
