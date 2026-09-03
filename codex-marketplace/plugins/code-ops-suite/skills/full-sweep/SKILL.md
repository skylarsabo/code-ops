---
name: full-sweep
description: "Use when you want the whole code-ops-suite run end-to-end on one codebase as a guided, checkpointed pipeline. It is the intra-plugin orchestrator. For the cross-plugin superset use everything."
---

# FULL SWEEP: Run the Whole Suite End-to-End

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:full-sweep`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`: the operating model, the interaction protocol, the safety
rails including the **automation-level ladder** (`§4`), the schemas and evidence tiers (`§7`),
the quality lenses (`§10`), the register-freshness rule (`§12`), and the **documentation quality
standard** (`§13`).

This skill **orchestrates the other skills in sequence** as one developer-in-the-loop pipeline.
It does not replace them. It runs them in a sensible order, carries the shared registers forward,
maintains a master plan, and checks in with you at every phase boundary.

## Phase 0: the scope of the run  *(checkpoint)*

Run `node <plugin-root>/scripts/preflight.mjs --artifact-dir <run folder>`, adding
`--need gh` when the run will publish. A FAIL stops the run before any fan-out, and advisories
are noted in the register.

After preflight passes, prepare `<run folder>/CONTEXT_SNAPSHOT.json` with
`context-snapshot.mjs`, using the repo's atlas when present and a durable local cache directory.
That call generates or exactly reuses one content-addressed repo map and import graph for the
whole visible repository state. Operatives never regenerate them.

Two read-side mechanisms serve the same budget and are on by default. `skim.mjs` prints a file's
outline so the next read is a line range rather than a whole file.
`node <plugin-root>/scripts/context-query.mjs find|callers|callees|blast|explore`
answers a structural question with `file:line` anchors, over a home-directory index that a
`PostToolUse` hook refreshes on each edit. Turn the index off with `CODE_OPS_INDEX=off` in the
environment block of a `.claude/settings.json`.
`code-ops-docs/50 Platform/INFRASTRUCTURE.md` owns the
switch list, and `code-ops-docs/55 Operations/MEASUREMENTS.md` owns what these mechanisms save.

Dispatch an explorer operative to detect the stack and size from a compiled context bundle, then
confirm with me:
- The **track**: `assess-only` for read and document with no code changes, `full` for assess then safety net then fix then polish then document, or a custom subset of the phases below.
- The **run scope**: which areas to include or skip.
- The risk tolerance and the PR preference.
- The **automation level** governing every code-changing phase (`§4`: `gated` *(default)*, `auto-safe`, or `auto-all`).

Open a master todo and a running `EXECUTIVE_SUMMARY.md` that spans the phases. **Carry the
registers forward fresh.** Before any phase consumes a finding, re-validate it against current
HEAD (`§12`). Mark a finding fixed earlier in the run `OBSOLETE-AT <sha>`, and never re-show it.
**Surface any critical finding to me immediately, in any phase.**

For a bounded substantive run, compile the agreed scope into a version 2
`<run folder>/RUN_CONTRACT.json` before Phase 1. Bind it to the snapshot ID, and declare the
bundle and Atlas excerpt budgets. Define the vector-valued quality criteria, the bounded waves,
the dependency edges, the disjoint write scopes, the routing, the shared context, and the
dispatch limits. Run `run-contract.mjs check`. Then compile and verify one context bundle per
unit with `context-bundle.mjs`. A `BROAD_CONTEXT_REQUIRED` or `BUDGET_EXCEEDED` marker, or
context drift, triggers a contract revision. Never truncate a bundle, and never reuse a stale
one.

For a multi-phase or resumable substantive run, compile version 3 instead. Declare the observed
host capabilities in `<run folder>/HOST_CAPABILITIES.json` with `host-capabilities.mjs init`. Do
not infer them from the model. Declare the runtime policy,
`<run folder>/RUN_RUNTIME_RECEIPTS.jsonl`, and a byte-bounded stable prefix. Run
`run-contract.mjs check`, then `run-runtime.mjs init`. Emit the stable prefix only when the host
can inject it exactly. A cache is an acceleration, never run state. Record only observed cache
activity with `run-runtime.mjs observe`.

At each later phase boundary, reconcile the contract against `DISPATCH_LEDGER.md`. For version 3,
checkpoint the ledger and the completed artifacts with `run-runtime.mjs checkpoint`. Replan after
a scope, context, or runtime-binding change: increment the revision, refresh the affected
bundles, validate the next contract, then append `run-runtime.mjs replan`. Otherwise validate the
receipt chain and append `run-runtime.mjs resume` before the next phase. At completion, record
the replayed criteria in `ACCEPTANCE_LEDGER.md` and invoke finalization. A returned report never
satisfies a criterion by itself (`CONVENTIONS §1, §12`).

## Phase 1: the ground truth

Run `doc-alignment` so later phases work from an accurate map, and skip it when the docs are
known-current. Verify library and framework facts against the **installed versions** through the
in-house docs lookup (`§2`), not from memory. *Checkpoint:* the drift summary, then a go or
no-go.

## Phase 2: the assessment, read-only

Run `codebase-audit` for the broad lenses, then `security-privacy-audit` for the adversarial
pass. Findings carry an **evidence tier** (CONFIRMED, PROBABLE, or SPECULATIVE) plus a
disconfirmation pass (`§7`), and apply the **multi-boundary control-coverage** lens (`§10`). A
control verified at one entry point but not at every reachable one is itself a finding. Merge the
results into `FINDINGS_REGISTER.md`, each entry stamped `Verified-at <sha>`. *Checkpoint:* review
the ranked, CONFIRMED-led findings and the biggest risks, then decide what to fix.

Before merging, gate each explorer or reviewer subagent's report on shape. An explorer owes an
evidence-cited map, and a reviewer owes tiered findings with `file:line`. Anything null, empty,
or short of that shape counts as a failed dispatch (`§1`). Mark it accordingly in
`DISPATCH_LEDGER.md` (`§12`) and redispatch or defer it. Never merge it as if it were silence.

## Phase 3: the safety net

Run `test-hardening` on the critical and risky paths the audits flagged, and write
characterization tests for anything queued for change, so the next phase is provably
behavior-preserving. *Checkpoint:* the coverage on the target areas, then a go or no-go.

## Phase 4: the fixes  *(writes code, requires approval)*

Run `remediation` against `FINDINGS_REGISTER.md`. It **re-validates the register first** (`§12`),
dropping anything already fixed, then fixes at the chosen automation level (`§4`), conflict-aware,
with each fix tested and committed. *Checkpoint per fix batch* (`CONVENTIONS §4`).

## Phase 5: the deep-dives  *(optional, as scoped)*

Run whichever of `performance` and `dependency-upgrade` you selected. Each one ships its own
verified improvements with measured before-and-after numbers, and feeds the residual items back
to the register.

## Phase 6: the consistency pass

Run `normalize`, which is behavior-preserving, to leave one consistent style and an enforced
linter and formatter config. *Checkpoint:* the normalization log.

## Phase 7: the documentation of the now-accurate system

Run `repo-docs` to refresh only the manifest domains affected by the source delta. Use
`doc-alignment` when the manifest or the code exposes an ambiguous contradiction. Then generate
the missing reference domains per the documentation quality standard (`§13`) and the self-scoping
rules: `architecture` covering C4 plus the critical flows, `data-model`, `api-docs`, `ops-docs`,
`adr` backfilling the load-bearing decisions, and `onboarding` for newcomers.

## Phase 8: the ship  *(optional)*

When the fix and deep-dive phases produced a large diff, carve it into a clean,
independently-green stack with `pr-split`, which scrubs AI and tooling trace before pushing.
Open the PRs, and **never auto-merge.**

## The feature track, a separate pipeline

Building features is its own flow: `feature-discovery` → `feature-implementation` → `pr-review`,
shipping the result with `pr-split`. Run `code-ops-suite:full-sweep feature` to drive that track
instead of the hardening track above.

## Done when

- Every selected phase is complete, its deliverable produced, and its checkpoint passed.
- The reference docs are generated where applicable.
- The registers carried forward are fresh, with no obsolete item re-shown.
- Every blocking run-contract criterion is accepted with replayable proof, and `RUN_CONTRACT_RESULT.json` records PASS.
- The master `EXECUTIVE_SUMMARY.md` ties together the findings, the fixes applied, the docs produced, and what remains.
- Nothing code-changing happened without your approval.
- The summary is presented, listing anything still awaiting a decision.
