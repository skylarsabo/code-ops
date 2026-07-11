---
name: everything
description: "Use when you want the most exhaustive end-to-end pass across all three plugins; token-expensive and checkpointed. Cross-plugin superset — requires code-ops-suite, rigor, and privacy-opsec-suite installed."
---

# EVERYTHING — The Full Pass Across All Three Suites

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:everything`.** This orchestrates every workflow across the three code-ops plugins into one exhaustive pipeline. It does not replace the individual skills — it runs them in the right order, deduplicated, carrying every register and a growing **proof set** forward, and checking in at phase boundaries.

**Prerequisites:** `code-ops-suite`, `rigor`, and `privacy-opsec-suite` all installed. First read this plugin's `<plugin-root>/CONVENTIONS.md`, then also load the `CONVENTIONS.md` from the **rigor** and **privacy-opsec-suite** plugins (search the plugin directories; skill files load themselves at invocation — do not preload them) so each phase applies its governing methodology — especially rigor's verification-first rules (evidence tiers, the disconfirmation pass, the regression guard).

**Cost & shape:** this is deliberately the most thorough and most token-expensive option. It is **phased with checkpoints, not a blind firehose** — you can widen or narrow scope and dial check-ins up or down at Phase 0.

## Phase 0 — Scope, automation level & preflight  *(checkpoint)*
Detect the stack/size; confirm all three plugins are available. Verify library/framework facts against the **installed versions** via the in-house docs lookup (`§2`), never memory. Confirm with me:
- **Scope** — the whole repo, or the riskiest subsystems first (recommended for large repos; bug-hunting goes deep per subsystem).
- **Privacy track** — include the privacy-opsec phases? (yes if the project has anonymity/opsec requirements; otherwise skip them).
- **Remediation automation level** (the canonical ladder — code-ops `§4`, applied with rigor's tier gate `rigor §4`/`§H`) — governs every code-changing phase:
  - `gated` *(default)* — pause for my approval at each fix/closure batch.
  - `auto-safe` *(recommended ceiling)* — automatically apply **CONFIRMED + NOW-SAFE** fixes (each on a branch, each carrying a failing→passing regression test, each passing the regression guard); pause only for NEEDS-REVIEW, NEEDS-DESIGN, and the always-gated categories.
  - `auto-all` — *not recommended*; even here the always-gated categories still stop for me, and NEEDS-DESIGN is never auto-applied.
  - **Always gated, regardless of level:** security/auth changes, secret handling, data migrations or destructive/irreversible operations, and public API/contract changes. **Never auto-merge.**
- **Check-in level** — normal (per phase) or minimal (only at the consolidated review + always-gated items).
Then set up the run:
- Open the master registers (`FINDINGS_REGISTER.md`, `CONSISTENCY_REGISTER.md`, and `LEAK_REGISTER.md` if privacy is in scope), a running `EXECUTIVE_SUMMARY.md`, a coverage map, and a growing proof set.
- **Keep every register fresh across phases** — re-validate items against current HEAD before any phase consumes them (`§12`); a finding fixed earlier in the run is marked `OBSOLETE-AT <sha>`, never re-ranked or re-shown.
- **Surface any CONFIRMED critical finding immediately.**
- Always work on a branch; **never auto-merge** — even fully-auto fixes land as commits/PRs for review.

## Phase 1 — Map  *(code-ops-suite)*
`doc-alignment` → `codebase-audit` → `security-privacy-audit`. An accurate map + a broad first-pass register, findings **tiered + disconfirmed** (`§7`) and run through the **multi-boundary control-coverage** lens (`§10`).

## Phase 2 — Ground truth & test trust  *(rigor)*
`ground-truth` → `test-suite-audit`. Facts from the real toolchain, plus where "green" is trustworthy and where the coverage blind spots are.

## Phase 3 — Prove  *(rigor)*
`bug-hunt` (deep per subsystem; root cause + sibling sweep) + `quality-scan`, everything tiered and disconfirmed; `regression-hunt` to bisect any regression. Merge into `FINDINGS_REGISTER.md` (each entry `Verified-at <sha>`).

## Phase 4 — Anonymity & leak audits  *(privacy-opsec-suite — if in scope)*
`anonymity-threat-model` → `anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`, `traffic-analysis-resistance`, `supply-chain-trust` → `LEAK_REGISTER.md` (tiered, `Verified-at`).

## Phase 5 — Safety net  *(rigor)*
`safety-net`: characterization tests pinning current behavior on the blind spots and everything queued for change, so the fixes ahead are provably behavior-preserving.

## Phase 6 — Consolidated review  *(checkpoint — the main go/no-go)*
Re-validate every carried register against current HEAD first (`§12`), then present one prioritized, **CONFIRMED-led** picture across bugs, quality, leaks, and inconsistencies, with the remediation plan and the automation level in effect.

## Phase 7 — Remediate  *(rigor `fix-verified` + code-ops `remediation` + privacy-opsec `opsec-hardening`)*
Per the chosen automation level: fix CONFIRMED bugs at root cause (failing→passing regression test, regression guard, sibling sweep, enforcement); apply security/privacy fixes with fail-closed where relevant. Each change tested, behavior-preserving, atomic, on the branch.

## Phase 8 — Close inconsistencies  *(rigor `consistency-closure`)*
One canonical form per concept (approved unless the level is `auto-safe`/`auto-all` and the choice is clearly mechanical) → migrate every site → add the enforcement so it can't recur.

## Phase 9 — Improve  *(rigor `improve-measured` + code-ops `performance` + `dependency-upgrade`)*
Only changes with a measured before→after delta ship; behavior-preserving.

## Phase 10 — Normalize & document  *(code-ops `normalize` + the doc generators)*
One consistent style with an enforced config (`normalize`); reconcile docs (`doc-alignment`); then **generate the reference docs** for the now-accurate, now-hardened system — each per the documentation quality standard (`§13`) and self-scoping: **architecture** (C4 + the critical flows just traced) · **data-model** · **api-docs** · **ops-docs** · **adr** (capture the decisions this run surfaced) · **onboarding**.

## Phase 11 — Final verification, report & ship
Full suite + the entire proof set green; regression guard clean (no prior proof broken). Produce the master `EXECUTIVE_SUMMARY.md` tying together what was found, proven, fixed, closed, improved, and documented — **CONFIRMED separated from PROBABLE/SPECULATIVE** — with the coverage map and anything still awaiting a decision. Note the PR gates to wire in (`rigor:deep-review`, `privacy-opsec-suite:opsec-pr-gate`). If shipping, carve the remediation diff into a clean, independently-green stack with **pr-split** (which runs **authorship-hygiene** fail-closed so the commits/PRs carry no AI/tooling trace) — never auto-merge.

## Done when
Every in-scope phase is complete; CONFIRMED bugs are fixed at root cause with regression proofs; inconsistencies are closed and enforced; improvements carry measured deltas; privacy leaks (if in scope) are closed and locked; the reference docs are generated where applicable; every register carried across phases is fresh (no obsolete item re-shown); the proof set and suite are green; the master summary is delivered; and nothing in an always-gated category — and, under `gated`, nothing code-changing — happened without your approval.
