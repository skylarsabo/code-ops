---
name: code-ops-suite-full-sweep
description: "Use when you want the whole code-ops-suite run end-to-end on one codebase as a guided, checkpointed pipeline. Intra-plugin orchestrator; for the cross-plugin superset use everything."
---

# FULL SWEEP — Run the Whole Suite End-to-End

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-full-sweep`, or by the model through the `skill` tool as `code-ops-suite-full-sweep`.** First read the bundled `<plugin-root>/CONVENTIONS.md` — operating model, interaction protocol, safety rails incl. the **automation-level ladder** (`§4`), schemas + evidence tiers (`§7`), quality lenses (`§10`), the register-freshness rule (`§12`), and the **documentation quality standard** (`§13`). This skill **orchestrates the other skills in sequence** as one developer-in-the-loop pipeline — it doesn't replace them. It runs them in a sensible order, carries the shared registers forward, maintains a master plan, and checks in with you at every phase boundary.

## Phase 0 — Scope the run  *(checkpoint)*
Run `node <plugin-root>/scripts/preflight.mjs --artifact-dir <run folder>` (add `--need gh` if the run will publish) — a FAIL stops the run before any fan-out; advisories are noted in the register. After preflight passes, prepare `<run folder>/CONTEXT_SNAPSHOT.json` with `context-snapshot.mjs`, using the repo's atlas when present and a durable local cache directory. This generates or exactly reuses one content-addressed repo map and import graph for the whole visible repository state. Operatives never regenerate them. Dispatch an explorer operative to detect the stack and size from a compiled context bundle, then confirm with me:
- **Track:** `assess-only` (read + document, no code changes) · `full` (assess → safety net → fix → polish → document) · or a custom subset of phases below.
- Scope (areas to include/skip), risk tolerance, PR preference, and the **automation level** (`§4`: `gated` *(default)* / `auto-safe` / `auto-all`) governing every code-changing phase.
Open a master todo and a running `EXECUTIVE_SUMMARY.md` that spans phases. **Carry the registers forward fresh** — before any phase consumes a finding, re-validate it against current HEAD (`§12`); a finding fixed earlier in the run is marked `OBSOLETE-AT <sha>`, never re-shown. **Surface any critical finding to me immediately, in any phase.**

For a bounded substantive run, compile the agreed scope into a version 2 `<run folder>/RUN_CONTRACT.json` before Phase 1. Bind it to the snapshot ID and declare bundle and Atlas excerpt budgets. Define vector-valued quality criteria, bounded waves, dependency edges, disjoint write scopes, routing, shared context, and dispatch limits. Run `run-contract.mjs check`, then compile and verify one context bundle per unit with `context-bundle.mjs`. `BROAD_CONTEXT_REQUIRED`, `BUDGET_EXCEEDED`, or context drift triggers a contract revision. Never truncate or reuse a stale bundle.

For a multi-phase or resumable substantive run, compile version 3 instead. Declare observed host capabilities in `<run folder>/HOST_CAPABILITIES.json` with `host-capabilities.mjs init`. Do not infer them from the model. Declare runtime policy, `<run folder>/RUN_RUNTIME_RECEIPTS.jsonl`, and a byte-bounded stable prefix. Run `run-contract.mjs check`, then `run-runtime.mjs init`. Emit the stable prefix only when the host can inject it exactly. A cache is an acceleration, never run state. Record only observed cache activity with `run-runtime.mjs observe`.

At each later phase boundary, reconcile the contract against `DISPATCH_LEDGER.md`. For version 3, checkpoint the ledger and completed artifacts with `run-runtime.mjs checkpoint`. Replan after a scope, context, or runtime-binding change. Increment the revision, refresh affected bundles, validate the next contract, then append `run-runtime.mjs replan`. Otherwise, validate the receipt chain and append `run-runtime.mjs resume` before the next phase. At completion, record replayed criteria in `ACCEPTANCE_LEDGER.md` and invoke finalization. A returned report never satisfies a criterion by itself (`CONVENTIONS §1, §12`).

## Phase 1 — Ground truth
Run **doc-alignment** so later phases work from an accurate map (skip if docs are known-current); verify library/framework facts against the **installed versions** via the in-house docs lookup (`§2`), not memory. → *Checkpoint:* drift summary, go/no-go.

## Phase 2 — Assess (read-only)
Run **codebase-audit** (broad lenses), then **security-privacy-audit** (adversarial). Findings carry an **evidence tier** (CONFIRMED/PROBABLE/SPECULATIVE) + a disconfirmation pass (`§7`) and apply the **multi-boundary control-coverage** lens (`§10`) — a control verified at one entry point but not at every reachable one is itself a finding. Merge into `FINDINGS_REGISTER.md`, each entry stamped `Verified-at <sha>`. → *Checkpoint:* review the ranked, CONFIRMED-led findings + biggest risks; decide what to fix.

Before merging, gate each explorer or reviewer subagent's report on shape: an explorer owes an evidence-cited map, a reviewer owes tiered findings with `file:line` — anything null, empty, or short of that shape counts as a failed dispatch (`§1`), marked accordingly in `DISPATCH_LEDGER.md` (`§12`) and redispatched or deferred, never merged as if it were silence.

## Phase 3 — Safety net
Run **test-hardening** on the critical/risky paths the audits flagged, and write characterization tests for anything queued for change — so the next phase is provably behavior-preserving. → *Checkpoint:* coverage on target areas, go/no-go.

## Phase 4 — Fix (writes code — requires approval)
Run **remediation** against `FINDINGS_REGISTER.md`: it **re-validates the register first** (`§12`) — dropping anything already fixed — then fixes per the chosen automation level (`§4`), conflict-aware, each fix tested and committed. → *Checkpoint per fix batch* (`CONVENTIONS §4`).

## Phase 5 — Deep-dives (optional, as scoped)
Run any of **performance** and **dependency-upgrade** you selected; each ships its own verified improvements (measured before→after) and feeds residual items back to the register.

## Phase 6 — Consistency
Run **normalize** (behavior-preserving) to leave one consistent style and an enforced linter/formatter config. → *Checkpoint:* normalization log.

## Phase 7 — Document the now-accurate system
Run **repo-docs** to refresh only manifest domains affected by the source delta. Use **doc-alignment** when the manifest or code exposes an ambiguous contradiction. Then generate missing reference domains per the documentation quality standard (`§13`) and self-scoping rules:
**architecture** (C4 + the critical flows) · **data-model** · **api-docs** · **ops-docs** · **adr** (backfill the load-bearing decisions) · and **onboarding** for newcomers.

## Phase 8 — Ship (optional)
If the fix/deep-dive phases produced a large diff, carve it into a clean, independently-green stack with **pr-split** (which scrubs AI/tooling trace before pushing); open PRs — **never auto-merge**.

## Feature track (separate pipeline)
Building features is its own flow: **feature-discovery** → **feature-implementation** → **pr-review** (ship the result with **pr-split**). Run `/code-ops-suite-full-sweep feature` to drive that track instead of the hardening track above.

## Done when
Every selected phase is complete, its deliverable produced, and its checkpoint passed; the reference docs are generated where applicable; the registers carried forward are fresh (no obsolete item re-shown); every blocking run-contract criterion is accepted with replayable proof; `RUN_CONTRACT_RESULT.json` records PASS; the master `EXECUTIVE_SUMMARY.md` ties together findings, fixes applied, docs produced, and what remains; and nothing code-changing happened without your approval. Present the summary and list anything still awaiting a decision.
