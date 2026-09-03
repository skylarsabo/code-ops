---
name: feature-discovery
description: "Use when you want grounded, high-value feature ideas mined from the codebase rather than a generic wishlist. Discovery only, and it writes no code."
---

# Feature discovery: find and specify high-value improvements

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:feature-discovery`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section.
**Mode:** DISCOVERY · **Produces:** `FEATURE_OPPORTUNITIES.md` as a ranked register, top-feature
specs in `TOP_FEATURES.md` or `specs/`, `FEATURE_ROADMAP.md`, and `EXECUTIVE_SUMMARY.md`.

Mine the codebase for **high-value, grounded** feature opportunities, and specify the best ones.
Produce no generic wishlist. This skill discovers and specifies only, and implements nothing.

## Phase 0: the product read and the direction  *(checkpoint)*

Dispatch an `explorer` operative to detect the stack and the **latent capabilities**, meaning
data already present and services or libraries that could do more cheaply. Map the **current
feature set and the main user flows**. Infer the product intent and the target users from the
docs and the architecture. Harvest **intent signals**: TODOs, disabled flags, stubbed or
commented-out endpoints, dead routes, and recurring issue or PR demand when version-control
history is available.

> **CHECKPOINT:** present your read of what the product is, who it is for, and where it is headed, plus the richest opportunity areas. Confirm the direction, the target users, what is in and out of scope, and the appetite for quick wins against big bets. Proceed within that.

## Phase 1: the adaptive discovery

Fan out across the discovery lenses against the product areas. Ideas use the idea schema
(`CONVENTIONS §7`). The lenses are latent capability, which is often the highest-leverage,
half-built or abandoned work, UX friction and dead-ends walked with the UI tool when available,
workflow completion, power-user automation, onboarding and activation, configurability,
extensibility, performance as a feature, accessibility, trust and transparency and control, and
category parity and differentiation. When the system handles personal or sensitive data,
evaluate each idea's effect on its **privacy and data-handling posture**, and surface any idea
that would weaken it for a developer decision. Deepen the rich veins, and converge the exhausted
ones.

## Phase 2: prioritize, then specify  *(checkpoint)*

Score the ideas by impact times reach divided by effort, weighted by confidence (`§8`). Tag the
quick wins and the big bets. Always define the **smallest valuable slice**.

> **CHECKPOINT:** present the ranked clusters, and the developer picks which ones get deep specs.

Then write a mini-spec per chosen feature, covering the problem, the target users, the solution,
the smallest valuable slice and its follow-ons, the UX fitted to any existing design system, the
technical approach leveraging the existing architecture, the data and privacy implications, the
effort and sequencing, the dependencies and risks, the success signals, and the open questions.

## Deliverables

In a dated discovery folder:
- `FEATURE_OPPORTUNITIES.md`: the full ranked register, with quick wins and big bets tagged.
- The chosen **mini-specs**, ready to hand to the implementation prompt.
- `FEATURE_ROADMAP.md`: Now, Next, and Later.
- `EXECUTIVE_SUMMARY.md`: the top opportunities, the decisions needed, and the highest-value next build.

## Done when

- Every product area and flow was explored.
- The register is deduplicated, scored, and ranked, and each idea is stamped `Verified-at: <sha>` (`CONVENTIONS §7`).
- Both checkpoints are done.
- Mini-specs grounded in the real architecture exist for the chosen set.
- The roadmap and the summary are consistent, and no code changed.
- A final self-audit found no generic filler and no unverified capabilities.
- `EXECUTIVE_SUMMARY.md` is presented first, with the highest-value opportunity at the top.
