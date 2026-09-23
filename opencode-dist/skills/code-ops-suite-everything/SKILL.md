---
name: code-ops-suite-everything
description: "Use when you want a whole-suite, checkpointed pass over one or more installed plugins, from one plugin pipeline up to the exhaustive cross-plugin superset. Select them with plugins: suite, rigor, or privacy (default: every installed one). Phases of an absent plugin are skipped and named. Tracks: assess-only, full, feature."
---

# Everything: the full pass across the selected suites

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-everything`, or by the model through the `skill` tool as `code-ops-suite-everything`.**

**OpenCode runtime note:** Traceless publishing, model-floor enforcement, digest rewrite, index refresh, routing guidance, compaction preservation, the lifecycle plugin, and local documentation MCP registration run automatically. The lifecycle plugin keeps a stable system prefix and writes the cost ledger. Handoff and dispatch notes ride on the next tool result or user turn. This skill orchestrates every workflow of the
selected code-ops plugins into one checkpointed pipeline. It does not replace the individual skills.
It runs them in the right order, deduplicated, carrying every register and a growing **proof
set** forward, and checking in at phase boundaries.

**Plugin selector:** `plugins: suite,rigor,privacy`, any non-empty subset, where `suite` is
code-ops-suite, `rigor` is rigor, and `privacy` is privacy-opsec-suite. The default is every
installed plugin among the three. A selected plugin that is not installed does not stop the
run. Its phases are skipped, and the run names each skipped phase and its plugin at Phase 0 and
in `EXECUTIVE_SUMMARY.md`. Each phase heading names the plugin that owns it. A phase owned by
two plugins runs the legs of the selected, installed ones.

**Tracks:** `assess-only` reads, proves, and documents and changes no code. `full` *(default)*
runs every selected phase, including the code-changing ones. `feature` runs the feature track
below instead of the hardening phases. A custom subset of the phases is also allowed.

First read §1, §2, §3, §4, §7, §10, §12, §13, and §14 of
this plugin's `<plugin-root>/CONVENTIONS.md`. Leave the rest of that file unread. Then load the `CONVENTIONS.md` of each
selected, installed **rigor** or **privacy-opsec-suite** plugin, searching the plugin directories for them. Do not
preload skill files, because they load themselves at invocation. Each phase then applies its
governing methodology. When rigor is selected, its verification-first rules govern: the
evidence tiers, the disconfirmation pass, and the regression guard.

**Cost and shape.** With every plugin selected, this is deliberately the most thorough and most
token-expensive option. One selected plugin costs about one plugin's whole suite. The run is
phased with checkpoints rather than a blind fan-out. You can widen or narrow the scope, and
raise or lower the check-in frequency, at Phase 0.

## Phase 0: the scope, the automation level, and the preflight  *(checkpoint)*

Run `node <plugin-root>/scripts/preflight.mjs --artifact-dir <run folder>`, adding
`--need gh` when the run will publish. A FAIL stops the run before fan-out. Prepare one exact
context snapshot and compile a scoped bundle per planned unit. Context drift or an explicit
compiler marker stops dispatch and triggers a replan. Dispatch an explorer with its verified
bundle to detect the stack and size. Resolve the plugin selector against the installed plugins,
and name every phase the run skips because its plugin is absent or unselected. Verify
library and framework facts against the **installed versions** through the in-house docs lookup
(`§2`), never from memory.

**The standardization preflight.** Then run `/code-ops-suite-conform` in its assess-only mode,
before any register is opened. It reports whether the standards contract, the docs vault, and
the atlas are conformant, and where this run's artifacts therefore belong. Assess-only is the
default here. The repairs it proposes are offered once, at this phase's checkpoint below, and
are never applied without approval. A run that declines them proceeds on the assessment alone.

Confirm the **run scope** with me: the whole repo, or the riskiest subsystems first. Subsystems
first is recommended for large repos, because bug-hunting goes deep per subsystem.

Confirm the **plugins and the track** with me. Select `privacy` when the project has anonymity
or opsec requirements.

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
- Open the master registers of the selected plugins (`FINDINGS_REGISTER.md`, `CONSISTENCY_REGISTER.md`, and `LEAK_REGISTER.md` when privacy is selected), a running `EXECUTIVE_SUMMARY.md`, a coverage map, and a growing proof set.
- **Keep every register fresh across phases.** Re-validate items against current HEAD before any phase consumes them (`§12`). Mark a finding fixed earlier in the run `OBSOLETE-AT <sha>`, and never re-rank or re-show it.
- **Surface any CONFIRMED critical finding immediately.**
- Always work on a branch, and **never auto-merge.** Even fully automatic fixes land as commits or PRs for review.

## Runtime continuity across phases

For this multi-phase substantive run, use a version 4 `RUN_CONTRACT.json` with an exact context
snapshot, verified unit bundles, a frontier lead, lower-tier parallel work operatives,
independent validation for each work unit, an observed host-capability descriptor, and bounded runtime policy.
Start it with `node <plugin-root>/scripts/run-contract.mjs init --root . --run <ignored run folder> --lead-model <session model>`,
which captures the snapshot, host capabilities, and runtime block. Fill the objective, non-goals,
quality criteria, and units it leaves empty.
Run `node <plugin-root>/scripts/run-contract.mjs check --root . --contract <contract>`,
then `node <plugin-root>/scripts/run-runtime.mjs init --root . --contract <contract>`
once. An existing version 1, 2, or 3 contract remains replayable but cannot start new substantive work without an explicit version 4 replan.

At each phase boundary, reconcile the dispatch ledger and checkpoint with
`node <plugin-root>/scripts/run-runtime.mjs checkpoint --root . --contract <contract> --ledger <ledger>`.
Include `--acceptance <ledger>` when acceptance exists, `--handoff <file>` when written,
and repeated `--artifact <file>` and `--bundle <file>` for retained evidence. Partial acceptance
is valid state; every blocking criterion still requires PASS at finalization.

On resumption, read `run-runtime.mjs status --root . --contract <contract>` first, then run
`run-runtime.mjs resume --root . --contract <contract>` before continuing. Any scope, context,
or runtime drift requires the next contract revision, refreshed affected bundles, and
`run-runtime.mjs replan` with the same reference flags. A cache never substitutes for receipts.

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

## Phase 4: the anonymity and leak audits  *(privacy-opsec-suite)*

`anonymity-threat-model` → `anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`,
`fingerprint-resistance`, `traffic-analysis-resistance`, `supply-chain-trust` →
`LEAK_REGISTER.md`, tiered and `Verified-at` stamped. Parallelize the independent audits.
Checkpoint on the worst deanonymization paths after the threat model, then on the ranked leaks,
led by any clearnet, DNS, or identifier exposure.

## Phase 5: the safety net  *(rigor)*

`safety-net` writes characterization tests pinning current behavior on the blind spots and on
everything queued for change, so the fixes ahead are provably behavior-preserving.

## Phase 6: the consolidated review  *(checkpoint, the main go or no-go)*

Re-validate every carried register against current HEAD first (`§12`). Then present one
prioritized, **CONFIRMED-led** picture across bugs, quality, leaks, and inconsistencies, with the
remediation plan and the automation level in effect.

## Phase 7: the remediation  *(rigor `fix-verified`, code-ops `remediation`, privacy-opsec `opsec-hardening`; skipped under `assess-only`)*

Work at the chosen automation level. Fix CONFIRMED bugs at root cause, each with a
failing-then-passing regression test, the regression guard, a sibling sweep, and an enforcement.
Apply security and privacy fixes with fail-closed behavior where relevant. Each change is tested,
behavior-preserving, atomic, and on the branch.

## Phase 8: the inconsistency closure  *(code-ops `normalize concept`; skipped under `assess-only`)*

Settle one canonical form per concept. The choice is approved unless the level is `auto-safe` or
`auto-all` and the choice is clearly mechanical. Migrate every site, then add the enforcement so
the divergence cannot recur.

## Phase 9: the improvements  *(rigor `improve-measured`, code-ops `performance` and `dependency-upgrade`; optional, skipped under `assess-only`)*

Only changes with a measured before-and-after delta ship, and each one is behavior-preserving.

## Phase 10: normalization and documentation  *(code-ops `normalize` and the doc generators, privacy-opsec `privacy-doc-alignment` and `opsec-pr-gate`)*

Settle one consistent style with an enforced config (`normalize`). Reconcile the docs
(`doc-alignment`). Then **generate the reference docs** for the now-accurate, now-hardened
system, each per the documentation quality standard (`§13`) and self-scoping: `architecture`
covering C4 plus the critical flows just traced, `data-model`, `api-docs`, `ops-docs`, `adr`
capturing the decisions this run surfaced, and `onboarding`. When privacy is selected, run
`privacy-doc-alignment` to reconcile the privacy promises and the threat model with the code,
and wire `opsec-pr-gate` into review. Under `assess-only`, skip `normalize` and keep the
read-only doc work.

## Phase 11: final verification, local review, report, and ship

The full suite and the entire proof set are green, and the regression guard is clean with no
prior proof broken. Produce the master `EXECUTIVE_SUMMARY.md` tying together what was found,
proven, fixed, closed, improved, and documented, with **CONFIRMED separated from PROBABLE and
SPECULATIVE**, plus the coverage map and anything still awaiting a decision.

When shipping, carve the remediation diff into a clean, independently-green stack with
`pr-split`, then commit each final diff. Then run `/code-ops-suite-local-review-gate` before its
PR exists. That gate composes the deep and OpSec reviews locally and binds their reports to each
exact SHA. When rigor or privacy-opsec-suite is absent, name the review leg the gate cannot
run. `authorship-hygiene` stays fail-closed, so the commits and PRs carry no AI or tooling
trace. Never auto-merge.

## The incident path

If a leak is suspected rather than sought, start with `leak-incident-response`, which triages,
contains, scopes, and plans. It needs privacy-opsec-suite. Feed its output into the same
`LEAK_REGISTER.md`, then resume at Phase 4 or Phase 6.

## The feature track

Building features is its own flow: `feature-discovery`, then `feature-implementation`, then
rigor's `deep-review` at its standard bar when rigor is installed, shipping the result with
`pr-split`. Run `/code-ops-suite-everything feature` to drive it instead of the hardening phases.

## Done when

- Every selected, installed phase is complete, and every skipped phase is named with its plugin.
- CONFIRMED bugs are fixed at root cause with regression proofs.
- Inconsistencies are closed and enforced, and improvements carry measured deltas.
- Privacy leaks, when privacy was selected, are closed and locked.
- The reference docs are generated where applicable.
- Every register carried across phases is fresh, with no obsolete item re-shown.
- The proof set and the suite are green, and the master summary is delivered.
- Nothing in an always-gated category happened without your approval, and under `gated`, nothing code-changing did either.
