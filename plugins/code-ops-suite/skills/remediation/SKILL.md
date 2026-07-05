---
description: "Use when a FINDINGS_REGISTER.md already exists and you want its NEEDS-REVIEW/NEEDS-DESIGN items implemented safely with tests (re-validates the register first). Requires a register as input."
disable-model-invocation: true
---

# REMEDIATION IMPLEMENTATION — Execute the Findings Backlog

**Invoked as `/code-ops-suite:remediation`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** IMPLEMENT · **Consumes:** `FINDINGS_REGISTER.md` (the NEEDS-REVIEW + NEEDS-DESIGN items). · **Produces:** verified fixes (branches/PRs), `IMPLEMENTATION_LOG.md`, an updated register.

Implement the findings backlog efficiently and at high quality — using conflict-aware parallel orchestration (`CONVENTIONS §1`) and the implementation loop (`§11`) — without re-introducing the problems the audit found.

## Phase 0 — Plan from the backlog  *(checkpoint)*
Read the register (schema `§7`, tracks `§6`). If `FINDINGS_REGISTER.md` is absent, stop — there is nothing validated to implement; route to `/code-ops-suite:codebase-audit` (or `/rigor:bug-hunt`) to produce one. **Never synthesize a register from memory.** **Re-validate first (`CONVENTIONS §12`):** run `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .` and triage its FRESH / MOVED / DRIFTED / GONE / AMBIGUOUS / NO-REF report, then confirm each surviving item's problem still exists and its cited location is accurate — drop anything already-fixed/obsolete/mis-diagnosed (mark `OBSOLETE-AT <sha>`). Build a **dependency + conflict graph**: order dependencies topologically; batch by **file/area affinity** (disjoint → parallel; overlapping/dependent → serial). Sequence by value × risk, doing the register's "top N" and foundational/blocking items first.
> **CHECKPOINT:** present the re-validation results, the proposed order/batching, and your PR preference question; confirm, then proceed. For **NEEDS-DESIGN** items, present the options/trade-offs and get a direction chosen before building.

## Phase 1 — Implement (parallel where disjoint, serial where coupled)
Run each item through the implementation loop (`§11`). **NEEDS-REVIEW** items change behavior/contracts by definition — confirm the intended new behavior with the developer before implementing, and pin it with tests. Hold all new code to the relevant quality lenses (`§10`): a fix that introduces coupling, a perf regression, a security/privacy leak, or (for UIs) a hardcoded style is a failure, not a fix. **Integrate continuously** and re-run the full suite after each batch to catch cross-item regressions. If implementing surfaces a *new* issue, log it to the register and flag it — don't expand scope. If three or more items in the run fail verification or spawn new confirmed findings, the **cascade circuit-breaker** (`§11`) applies — stop and escalate the cluster rather than continuing to patch.

## Deliverables
- The fixes — atomic, reviewable branches/PRs, tests green.
- **Updated `FINDINGS_REGISTER.md`** — each item marked done (+commit/PR ref) or deferred/obsolete (with reason).
- **`IMPLEMENTATION_LOG.md`** — per item: what was wrong, what changed, files, commit/PR, verification, any behavior change + the decision behind it, new findings spawned.
- Updated docs wherever behavior changed (`§11.9`).

## Done when
Every backlog item is implemented, deferred (logged), or confirmed obsolete; changes committed/PR'd with green build/tests (no worse than baseline); behavior changes are confirmed, tested, and documented; the register and affected docs are updated; and a **final integration pass** re-runs the full suite across all merged work with no cross-item regressions. Present a short summary — shipped / deferred / blocked-on-you — then the PR list and updated register path.
