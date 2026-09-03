---
description: "Use when feature specs already exist and you want them built incrementally. It requires specs as input."
---

# FEATURE IMPLEMENTATION: Build the Specified Features

**Invoked as `/code-ops-suite:feature-implementation`.** First read the
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section.
**Mode:** IMPLEMENT · **Consumes:** the feature specs, `FEATURE_OPPORTUNITIES.md`, and
`FEATURE_ROADMAP.md` · **Produces:** shipped features as flagged branches or PRs, `BUILD_LOG.md`,
and an updated register.

Build the specified features efficiently and at high quality, through conflict-aware parallel
orchestration (`CONVENTIONS §1`), the implementation loop (`§11`), and **incremental delivery**
that ships the smallest valuable slice first.

## Phase 0: the build set, the sequence, and the specs  *(checkpoint)*

Read the specs, the register, and the roadmap. **Re-ground** each chosen feature against current
code: the capabilities it builds on exist, the technical approach is viable, and nothing already
shipped it. Draft a build plan honoring the dependencies.

> **CHECKPOINT:** confirm which features to build and in what order. The roadmap recommends and the developer decides. Confirm the slice boundaries, the flag strategy, and the PR preference. Batch-answer each spec's **open questions** before building the affected part.

## Phase 1: the build, parallel where disjoint and serial where shared

Dispatch an ephemeral implementation operative per feature or slice, with conflict-aware fan-out
(`§1`). Per feature, deliver the **smallest valuable slice first**, then iterate. Run the
implementation loop (`§11`). Land new features **behind a flag** where that reduces risk. Build
**real states** rather than stubs, covering loading, empty, error, and success, plus the edge and
unhappy paths. Reuse the existing services, data, and components per the spec's build-on list,
and match the repo's conventions. Hold new code to the relevant quality lenses (`§10`). For a UI,
use the existing design tokens and components with full state coverage, theme parity, and
accessibility, verified with the UI tool. Assert the spec's **acceptance criteria and success
signals**. When the system handles sensitive data, re-check the **privacy and data-handling**
posture on the *actual implementation*, keeping the defaults private. Anything that would weaken
that posture stops for a developer decision. Integrate continuously, and re-run the suite after
each slice.

## Deliverables

- Shipped features as PRs, flagged, with tests green and acceptance criteria met.
- **An updated `FEATURE_OPPORTUNITIES.md`** with the built items marked.
- **`BUILD_LOG.md`**, per feature or slice: what was built, the files, the commit or PR, the flag, the verification including UI checks, the decisions, and any divergence from the spec.
- Updated docs and feature docs for everything shipped.

## Done when

- Every feature in the agreed set is shipped as a slice or in full as agreed, deferred and logged, or blocked on a decision.
- Changes are committed or opened as PRs with green build and tests.
- Each shipped feature meets its acceptance criteria and clears the relevant lenses.
- The register and the docs are updated.
- A **final integration pass** ran the full suite with the flags in their intended default state, and found no cross-feature regressions.
- The updated `FINDINGS_REGISTER.md` passes `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root . --consumed <pre-run copy>`, so no consumed item vanishes or closes without a pinned terminal form.
- A short summary is presented, naming what shipped and behind which flags, what was deferred, and what is blocked, followed by the PR list and the updated register path.
