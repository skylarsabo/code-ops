---
name: code-ops-suite-remediation
description: "Use when a FINDINGS_REGISTER.md already exists and you want its NEEDS-REVIEW and NEEDS-DESIGN items implemented safely with tests. It requires a register as input."
---

# Remediation implementation: execute the findings backlog

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-remediation`, or by the model through the `skill` tool as `code-ops-suite-remediation`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section.
**Mode:** IMPLEMENT · **Consumes:** `FINDINGS_REGISTER.md`, specifically its NEEDS-REVIEW and
NEEDS-DESIGN items · **Produces:** verified fixes as branches or PRs, `IMPLEMENTATION_LOG.md`,
and an updated register.

Implement the findings backlog efficiently and at high quality, through conflict-aware parallel
orchestration (`CONVENTIONS §1`) and the implementation loop (`§11`), without re-introducing the
problems the audit found.

## Phase 0: the plan from the backlog  *(checkpoint)*

Read the register (schema `§7`, tracks `§6`). When `FINDINGS_REGISTER.md` is absent, stop. There
is nothing validated to implement. Route to `/code-ops-suite-codebase-audit`, or to
`/rigor-bug-hunt`, to produce one. **Never synthesize a register from memory.**

**Re-validate first** (`CONVENTIONS §12`). Run
`node <plugin-root>/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .` and
triage its FRESH, MOVED, DRIFTED, GONE, AMBIGUOUS, and NO-REF report. Then confirm that each
surviving item's problem still exists and that its cited location is accurate. Drop anything
already fixed, obsolete, or mis-diagnosed, marking it `OBSOLETE-AT <sha>`.

Build a **dependency and conflict graph**. Order the dependencies topologically. Batch by file
and area affinity: disjoint batches run in parallel, and overlapping or dependent ones run
serially. Sequence by value against risk, doing the register's top-N and the foundational or
blocking items first.

> **CHECKPOINT:** present the re-validation results, the proposed order and batching, and your PR preference question. Confirm, then proceed. For **NEEDS-DESIGN** items, present the options and trade-offs and get a direction chosen before building.

## Phase 1: the implementation, parallel where disjoint and serial where coupled

Dispatch an ephemeral implementation operative per item or batch, with conflict-aware fan-out
(`§1`), and run each through the implementation loop (`§11`).

**NEEDS-REVIEW** items change behavior or contracts by definition. Confirm the intended new
behavior with the developer before implementing, and pin it with tests.

Hold all new code to the relevant quality lenses (`§10`). A fix that introduces coupling, a
performance regression, a security or privacy leak, or a hardcoded style in a UI is a failure,
not a fix.

**Integrate continuously,** and re-run the full suite after each batch to catch cross-item
regressions. When implementing surfaces a *new* issue, log it to the register and flag it rather
than expanding scope. When three or more items in the run fail verification or spawn new
confirmed findings, the **cascade circuit-breaker** (`§11`) applies. Stop and escalate the
cluster rather than continuing to patch.

## Deliverables

- The fixes, as atomic, reviewable branches or PRs, with tests green.
- **An updated `FINDINGS_REGISTER.md`**, with each item marked done and carrying its commit or PR reference, or deferred or obsolete with a reason.
- **`IMPLEMENTATION_LOG.md`**, per item: what was wrong, what changed, the files, the commit or PR, the verification, any behavior change and the decision behind it, and any new findings spawned.
- Updated docs wherever behavior changed (`§11.9`).

## Done when

- Every backlog item is implemented, deferred and logged, or confirmed obsolete.
- Changes are committed or opened as PRs, with build and tests green and no worse than baseline.
- Behavior changes are confirmed, tested, and documented.
- The register and the affected docs are updated.
- A **final integration pass** re-ran the full suite across all merged work, with no cross-item regressions.
- The updated `FINDINGS_REGISTER.md` passes `node <plugin-root>/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root . --consumed <pre-run copy>`, so no consumed item vanishes or closes without a pinned terminal form.
- A short summary is presented, naming what shipped, what was deferred, and what is blocked on you, followed by the PR list and the updated register path.
