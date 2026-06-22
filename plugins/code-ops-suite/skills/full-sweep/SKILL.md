---
description: "Use when you want the whole code-ops-suite run end-to-end on one codebase as a guided, checkpointed pipeline (assess to safety-net to fix to polish). Intra-plugin orchestrator; for the cross-plugin superset use everything."
disable-model-invocation: true
---

# FULL SWEEP — Run the Whole Suite End-to-End

**Invoked as `/code-ops-suite:full-sweep`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` (operating model, interaction protocol, safety rails, schemas, lenses). This skill **orchestrates the other skills in sequence** as one developer-in-the-loop pipeline — it doesn't replace them. It runs them in a sensible order, carries the shared registers forward, maintains a master plan, and checks in with you at every phase boundary.

## Phase 0 — Scope the run  *(checkpoint)*
Detect the stack and the size of the repo, then confirm with me:
- **Track:** `assess-only` (read + document, no code changes) · `full` (assess → safety net → fix → polish) · or a custom subset of phases below.
- Scope (areas to include/skip), risk tolerance, PR preference, and whether code-changing phases are pre-approved or gated each time.
Open a master todo and a running `EXECUTIVE_SUMMARY.md` that spans phases. **Surface any critical finding to me immediately, in any phase.**

## Phase 1 — Ground truth
Run **doc-alignment** so later phases work from an accurate map (skip if docs are known-current). → *Checkpoint:* drift summary, go/no-go.

## Phase 2 — Assess (read-only)
Run **codebase-audit** (broad lenses), then **security-privacy-audit** (adversarial). Merge their output into `FINDINGS_REGISTER.md`. → *Checkpoint:* review ranked findings + biggest risks; decide what to fix.

## Phase 3 — Safety net
Run **test-hardening** on the critical/risky paths the audits flagged, and write characterization tests for anything queued for change — so the next phase is provably safe. → *Checkpoint:* coverage on target areas, go/no-go.

## Phase 4 — Fix (writes code — requires approval)
Run **remediation** against `FINDINGS_REGISTER.md`: conflict-aware, behavior-confirmed, each fix tested and committed. → *Checkpoint per fix batch* (`CONVENTIONS §6`).

## Phase 5 — Deep-dives (optional, as scoped)
Run any of **performance** and **dependency-upgrade** you selected; each ships its own verified improvements and feeds residual items back to the register.

## Phase 6 — Consistency
Run **normalize** (behavior-preserving) to leave one consistent style and an enforced linter/formatter config. → *Checkpoint:* normalization log.

## Phase 7 — Capture state
Refresh **doc-alignment** and run **onboarding** so the now-accurate architecture and conventions are documented for the future.

## Feature track (separate pipeline)
Building features is its own flow: **feature-discovery** → **feature-implementation** → **pr-review**. Run `/code-ops-suite:full-sweep feature` to drive that track instead of the hardening track above.

## Done when
Every selected phase is complete, its deliverable produced, and its checkpoint passed; the master `EXECUTIVE_SUMMARY.md` ties together findings, fixes applied, and what remains; and nothing code-changing happened without your approval. Present the summary and list anything still awaiting a decision.
