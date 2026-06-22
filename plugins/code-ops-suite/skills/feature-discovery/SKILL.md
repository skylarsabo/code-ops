---
description: "Use when you want grounded, high-value feature ideas mined from the codebase (not a generic wishlist); produces a ranked register, specs, and a roadmap. Discovery only — writes no code."
disable-model-invocation: true
---

# FEATURE DISCOVERY — Find & Specify High-Value Improvements

**Invoked as `/code-ops-suite:feature-discovery`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** DISCOVERY · **Produces:** `FEATURE_OPPORTUNITIES.md` (ranked register), top-feature specs (`TOP_FEATURES.md` or `specs/`), `FEATURE_ROADMAP.md`, `EXECUTIVE_SUMMARY.md`.

Mine the codebase for **high-value, grounded** feature opportunities and specify the best ones — no generic wishlist. Discovery and specification only; no implementation.

## Phase 0 — Understand the product & set direction  *(checkpoint)*
Detect the stack and **latent capabilities** (data already present, services/libs that could do more cheaply). Map the **current feature set and main user flows**. Infer product intent and target users from docs and architecture. Harvest **intent signals** — TODOs, disabled flags, stubbed/commented-out endpoints, dead routes, and (if VCS history is available) recurring issue/PR demand.
> **CHECKPOINT:** present your read of *what the product is, who it's for, where it's headed*, and the richest opportunity areas. Confirm direction, target users, in/out-of-scope, and appetite (quick wins vs. big bets). Proceed within that.

## Phase 1 — Adaptive discovery
Fan out across discovery lenses × product areas; ideas use the idea schema (`CONVENTIONS §7`). Lenses: **latent capability** (often highest-leverage), **half-built/abandoned**, **UX friction/dead-ends** (walk flows with the UI tool if available), **workflow completion**, **power-user/automation**, **onboarding/activation**, **configurability**, **extensibility**, **performance-as-feature**, **accessibility**, **trust/transparency/control**, **category parity & differentiation**. If the system handles personal/sensitive data, evaluate each idea's effect on its **privacy/data-handling posture** and surface any that would weaken it for a developer decision. Deepen rich veins; converge exhausted ones.

## Phase 2 — Prioritize → spec  *(checkpoint)*
Score ideas (impact × reach ÷ effort, weighted by confidence; `§8`); tag quick wins and big bets; always define the **smallest valuable slice**.
> **CHECKPOINT:** present the ranked clusters; the developer picks which get deep specs. Then write a mini-spec per chosen feature: *problem, target users, solution, smallest valuable slice → follow-ons, UX (fits any existing design system), technical approach (leveraging existing architecture), data/privacy implications, effort & sequencing, dependencies/risks, success signals, open questions.*

## Deliverables (dated discovery folder)
`FEATURE_OPPORTUNITIES.md` (full ranked register, quick wins/big bets tagged), the chosen **mini-specs** (ready to hand to the implementation prompt), `FEATURE_ROADMAP.md` (Now/Next/Later), `EXECUTIVE_SUMMARY.md` (top opportunities, decisions needed, highest-value next build).

## Done when
Every product area/flow explored; register deduped, scored, ranked, each idea stamped `Verified-at: <sha>` (`CONVENTIONS §7`); both checkpoints done; mini-specs grounded in the real architecture exist for the chosen set; roadmap + summary consistent; no code changed; a final self-audit for generic filler and unverified capabilities. Present `EXECUTIVE_SUMMARY.md` first, highest-value opportunity at the top.
