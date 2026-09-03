---
name: everything
description: "Use when you want the most exhaustive end-to-end pass across all three plugins. It is token-expensive and checkpointed. It is the cross-plugin superset, and requires code-ops-suite, rigor, and privacy-opsec-suite installed."
---

# EVERYTHING: The Full Pass Across All Three Suites

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:everything`.** This skill orchestrates every workflow across the
three code-ops plugins into one exhaustive pipeline. It does not replace the individual skills.
It runs them in the right order, deduplicated, carrying every register and a growing **proof
set** forward, and checking in at phase boundaries.

**Prerequisites:** `code-ops-suite`, `rigor`, and `privacy-opsec-suite` all installed. First read
this plugin's `<plugin-root>/CONVENTIONS.md`. Then load the `CONVENTIONS.md` from the
**rigor** and **privacy-opsec-suite** plugins, searching the plugin directories for them. Do not
preload skill files, because they load themselves at invocation. Each phase then applies its
governing methodology, and especially rigor's verification-first rules: the evidence tiers, the
disconfirmation pass, and the regression guard.

**Cost and shape.** This is deliberately the most thorough and most token-expensive option. It
is phased with checkpoints rather than a blind fan-out. You can widen or narrow the scope, and
raise or lower the check-in frequency, at Phase 0.

## Phase 0: the scope, the automation level, and the preflight  *(checkpoint)*

Run `node <plugin-root>/scripts/preflight.mjs --artifact-dir <run folder>`, adding
`--need gh` when the run will publish. A FAIL stops the run before fan-out. Prepare one exact
context snapshot and compile a scoped bundle per planned unit. Context drift or an explicit
compiler marker stops dispatch and triggers a replan. Dispatch an explorer with its verified
bundle to detect the stack and size. Confirm that all three plugins are available. Verify
library and framework facts against the **installed versions** through the in-house docs lookup
(`§2`), never from memory.

**The standardization preflight.** Then run `code-ops-suite:conform` in its assess-only mode,
before any register is opened. It reports whether the standards contract, the docs vault, and
the atlas are conformant, and where this run's artifacts therefore belong. Assess-only is the
default here. The repairs it proposes are offered once, at this phase's checkpoint below, and
are never applied without approval. A run that declines them proceeds on the assessment alone.

Confirm the **run scope** with me: the whole repo, or the riskiest subsystems first. Subsystems
first is recommended for large repos, because bug-hunting goes deep per subsystem.

Confirm the **privacy track** with me: include the privacy-opsec phases, or skip them. Include
them when the project has anonymity or opsec requirements.

Confirm the **remediation automation level** with me. It is the canonical ladder from code-ops
`§4`, applied with rigor's tier gate (`rigor §4`, `§H`), and it governs every code-changing
phase:
- `gated` *(default)*: pause for my approval at each fix or closure batch.
- `auto-safe` *(recommended ceiling)*: automatically apply **CONFIRMED and NOW-SAFE** fixes, each on a branch, each carrying a failing-then-passing regression test, and each passing the regression guard. Pause only for NEEDS-REVIEW, NEEDS-DESIGN, and the always-gated categories.
- `auto-all`: *not recommended.* Even here the always-gated categories still stop for me, and NEEDS-DESIGN is never auto-applied.
- **Always gated, regardless of level:** security/auth changes, secret handling, data migrations or destructive/irreversible operations, and public API/contract changes. **Never auto-merge.**

Confirm the **check-in level** with me: normal, meaning one per phase, or minimal, meaning only
at the consolidated review and the always-gated items.

Then set up the run:
- Open the master registers (`FINDINGS_REGISTER.md`, `CONSISTENCY_REGISTER.md`, and `LEAK_REGISTER.md` when privacy is in scope), a running `EXECUTIVE_SUMMARY.md`, a coverage map, and a growing proof set.
- **Keep every register fresh across phases.** Re-validate items against current HEAD before any phase consumes them (`§12`). Mark a finding fixed earlier in the run `OBSOLETE-AT <sha>`, and never re-rank or re-show it.
- **Surface any CONFIRMED critical finding immediately.**
- Always work on a branch, and **never auto-merge.** Even fully automatic fixes land as commits or PRs for review.

## Phase 1: the map  *(code-ops-suite)*

`doc-alignment` → `codebase-audit` → `security-privacy-audit`. The phase produces an accurate map
and a broad first-pass register. Findings are **tiered and disconfirmed** (`§7`) and run through
the **multi-boundary control-coverage** lens (`§10`).

## Phase 2: ground truth and test trust  *(rigor)*

`ground-truth` → `test-suite-audit`. The phase produces facts from the real toolchain, plus a
statement of where "green" is trustworthy and where the coverage blind spots are.

## Phase 3: the proof  *(rigor)*

`bug-hunt`, run deep per subsystem for root cause plus a sibling sweep, alongside `quality-scan`,
with everything tiered and disconfirmed. Run `regression-hunt` to bisect any regression. Merge
the results into `FINDINGS_REGISTER.md`, each entry stamped `Verified-at <sha>`.

## Phase 4: the anonymity and leak audits  *(privacy-opsec-suite, when in scope)*

`anonymity-threat-model` → `anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`,
`fingerprint-resistance`, `traffic-analysis-resistance`, `supply-chain-trust` →
`LEAK_REGISTER.md`, tiered and `Verified-at` stamped.

## Phase 5: the safety net  *(rigor)*

`safety-net` writes characterization tests pinning current behavior on the blind spots and on
everything queued for change, so the fixes ahead are provably behavior-preserving.

## Phase 6: the consolidated review  *(checkpoint, the main go or no-go)*

Re-validate every carried register against current HEAD first (`§12`). Then present one
prioritized, **CONFIRMED-led** picture across bugs, quality, leaks, and inconsistencies, with the
remediation plan and the automation level in effect.

## Phase 7: the remediation  *(rigor `fix-verified`, code-ops `remediation`, privacy-opsec `opsec-hardening`)*

Work at the chosen automation level. Fix CONFIRMED bugs at root cause, each with a
failing-then-passing regression test, the regression guard, a sibling sweep, and an enforcement.
Apply security and privacy fixes with fail-closed behavior where relevant. Each change is tested,
behavior-preserving, atomic, and on the branch.

## Phase 8: the inconsistency closure  *(rigor `consistency-closure`)*

Settle one canonical form per concept. The choice is approved unless the level is `auto-safe` or
`auto-all` and the choice is clearly mechanical. Migrate every site, then add the enforcement so
the divergence cannot recur.

## Phase 9: the improvements  *(rigor `improve-measured`, code-ops `performance` and `dependency-upgrade`)*

Only changes with a measured before-and-after delta ship, and each one is behavior-preserving.

## Phase 10: normalization and documentation  *(code-ops `normalize` plus the doc generators)*

Settle one consistent style with an enforced config (`normalize`). Reconcile the docs
(`doc-alignment`). Then **generate the reference docs** for the now-accurate, now-hardened
system, each per the documentation quality standard (`§13`) and self-scoping: `architecture`
covering C4 plus the critical flows just traced, `data-model`, `api-docs`, `ops-docs`, `adr`
capturing the decisions this run surfaced, and `onboarding`.

## Phase 11: final verification, local review, report, and ship

The full suite and the entire proof set are green, and the regression guard is clean with no
prior proof broken. Produce the master `EXECUTIVE_SUMMARY.md` tying together what was found,
proven, fixed, closed, improved, and documented, with **CONFIRMED separated from PROBABLE and
SPECULATIVE**, plus the coverage map and anything still awaiting a decision.

When shipping, carve the remediation diff into a clean, independently-green stack with
`pr-split`, then commit each final diff. Then run `code-ops-suite:local-review-gate` before its
PR exists. That gate composes the deep and OpSec reviews locally and binds their reports to each
exact SHA. `authorship-hygiene` stays fail-closed, so the commits and PRs carry no AI or tooling
trace. Never auto-merge.

## Done when

- Every in-scope phase is complete.
- CONFIRMED bugs are fixed at root cause with regression proofs.
- Inconsistencies are closed and enforced, and improvements carry measured deltas.
- Privacy leaks, when privacy was in scope, are closed and locked.
- The reference docs are generated where applicable.
- Every register carried across phases is fresh, with no obsolete item re-shown.
- The proof set and the suite are green, and the master summary is delivered.
- Nothing in an always-gated category happened without your approval, and under `gated`, nothing code-changing did either.
