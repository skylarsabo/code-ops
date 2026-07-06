---
description: "Use when you want the whole code-ops-suite run end-to-end on one codebase as a guided, checkpointed pipeline. Intra-plugin orchestrator; for the cross-plugin superset use everything."
disable-model-invocation: true
---

# FULL SWEEP — Run the Whole Suite End-to-End

**Invoked as `/code-ops-suite:full-sweep`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — operating model, interaction protocol, safety rails incl. the **automation-level ladder** (`§4`), schemas + evidence tiers (`§7`), quality lenses (`§10`), the register-freshness rule (`§12`), and the **documentation quality standard** (`§13`). This skill **orchestrates the other skills in sequence** as one developer-in-the-loop pipeline — it doesn't replace them. It runs them in a sensible order, carries the shared registers forward, maintains a master plan, and checks in with you at every phase boundary.

## Phase 0 — Scope the run  *(checkpoint)*
Detect the stack and the size of the repo, then confirm with me:
- **Track:** `assess-only` (read + document, no code changes) · `full` (assess → safety net → fix → polish → document) · or a custom subset of phases below.
- Scope (areas to include/skip), risk tolerance, PR preference, and the **automation level** (`§4`: `gated` *(default)* / `auto-safe` / `auto-all`) governing every code-changing phase.
Open a master todo and a running `EXECUTIVE_SUMMARY.md` that spans phases. **Carry the registers forward fresh** — before any phase consumes a finding, re-validate it against current HEAD (`§12`); a finding fixed earlier in the run is marked `OBSOLETE-AT <sha>`, never re-shown. **Surface any critical finding to me immediately, in any phase.**

## Phase 1 — Ground truth
Run **doc-alignment** so later phases work from an accurate map (skip if docs are known-current); verify library/framework facts against the **installed versions** via the in-house docs lookup (`§2`), not memory. → *Checkpoint:* drift summary, go/no-go.

## Phase 2 — Assess (read-only)
Run **codebase-audit** (broad lenses), then **security-privacy-audit** (adversarial). Findings carry an **evidence tier** (CONFIRMED/PROBABLE/SPECULATIVE) + a disconfirmation pass (`§7`) and apply the **multi-boundary control-coverage** lens (`§10`) — a control verified at one entry point but not at every reachable one is itself a finding. Merge into `FINDINGS_REGISTER.md`, each entry stamped `Verified-at <sha>`. → *Checkpoint:* review the ranked, CONFIRMED-led findings + biggest risks; decide what to fix.

## Phase 3 — Safety net
Run **test-hardening** on the critical/risky paths the audits flagged, and write characterization tests for anything queued for change — so the next phase is provably behavior-preserving. → *Checkpoint:* coverage on target areas, go/no-go.

## Phase 4 — Fix (writes code — requires approval)
Run **remediation** against `FINDINGS_REGISTER.md`: it **re-validates the register first** (`§12`) — dropping anything already fixed — then fixes per the chosen automation level (`§4`), conflict-aware, each fix tested and committed. → *Checkpoint per fix batch* (`CONVENTIONS §4`).

## Phase 5 — Deep-dives (optional, as scoped)
Run any of **performance** and **dependency-upgrade** you selected; each ships its own verified improvements (measured before→after) and feeds residual items back to the register.

## Phase 6 — Consistency
Run **normalize** (behavior-preserving) to leave one consistent style and an enforced linter/formatter config. → *Checkpoint:* normalization log.

## Phase 7 — Document the now-accurate system
Reconcile docs with **doc-alignment**, then **generate the reference docs** for the system the sweep just mapped — each per the documentation quality standard (`§13`) and self-scoping (it runs only where it applies):
**architecture** (C4 + the critical flows) · **data-model** · **api-docs** · **ops-docs** · **adr** (backfill the load-bearing decisions) · and **onboarding** for newcomers.

## Phase 8 — Ship (optional)
If the fix/deep-dive phases produced a large diff, carve it into a clean, independently-green stack with **pr-split** (which scrubs AI/tooling trace before pushing); open PRs — **never auto-merge**.

## Feature track (separate pipeline)
Building features is its own flow: **feature-discovery** → **feature-implementation** → **pr-review** (ship the result with **pr-split**). Run `/code-ops-suite:full-sweep feature` to drive that track instead of the hardening track above.

## Done when
Every selected phase is complete, its deliverable produced, and its checkpoint passed; the reference docs are generated where applicable; the registers carried forward are fresh (no obsolete item re-shown); the master `EXECUTIVE_SUMMARY.md` ties together findings, fixes applied, docs produced, and what remains; and nothing code-changing happened without your approval. Present the summary and list anything still awaiting a decision.
