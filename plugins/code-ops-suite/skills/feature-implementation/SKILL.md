---
description: "Use when feature specs already exist and you want them built incrementally. Requires specs as input."
disable-model-invocation: true
---

# FEATURE IMPLEMENTATION — Build the Specified Features

**Invoked as `/code-ops-suite:feature-implementation`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** IMPLEMENT · **Consumes:** the feature specs + `FEATURE_OPPORTUNITIES.md` + `FEATURE_ROADMAP.md`. · **Produces:** shipped features (branches/PRs, flagged), `BUILD_LOG.md`, an updated register.

Build the specified features efficiently and at high quality — conflict-aware parallel orchestration (`CONVENTIONS §1`), the implementation loop (`§11`), and **incremental delivery** (smallest valuable slice first).

## Phase 0 — Confirm build set, sequence & specs  *(checkpoint)*
Read the specs, register, and roadmap. **Re-ground** each chosen feature against current code (the "builds-on" capabilities exist, the technical approach is viable, nothing already shipped it). Draft a build plan honoring dependencies.
> **CHECKPOINT:** confirm *which* features and in *what order* (roadmap recommends; developer decides), slice boundaries, flag strategy, and PR preference; batch-answer each spec's **open questions** before building the affected part.

## Phase 1 — Build (parallel where disjoint, serial where shared)
Per feature, deliver the **smallest valuable slice first**, then iterate. Run the implementation loop (`§11`); land new features **behind a flag** where it reduces risk. Build **real states**, not stubs (loading/empty/error/success, edge and unhappy paths). Reuse existing services/data/components per the spec's "builds-on" and match conventions. Hold new code to the relevant quality lenses (`§10`), and for UIs use the existing design tokens/components with full state coverage, theme parity, and accessibility (verify with the UI tool). Assert the spec's **acceptance criteria / success signals**. If the system handles sensitive data, re-check the **privacy/data-handling** posture on the *actual implementation*, keeping defaults private; anything that would weaken it stops for a developer decision. Integrate continuously; re-run the suite after each slice.

## Deliverables
Shipped features (PRs, flagged, tests green, acceptance criteria met); **updated `FEATURE_OPPORTUNITIES.md`** (built items marked); **`BUILD_LOG.md`** (per feature/slice: what was built, files, commit/PR, flag, verification incl. UI checks, decisions, spec divergences); updated docs/feature docs for everything shipped.

## Done when
Every feature in the agreed set is shipped (slice or full, as agreed), deferred (logged), or blocked on a decision; changes committed/PR'd with green build/tests; each shipped feature meets its acceptance criteria and clears the relevant lenses; register and docs updated; and a **final integration pass** runs the full suite with flags in their intended default state and no cross-feature regressions. The updated FINDINGS_REGISTER.md passes `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root . --consumed <pre-run copy>` — no consumed item vanishes or closes without a pinned terminal form. Present a short summary — shipped (and behind which flags) / deferred / blocked — then the PR list and updated register path.
