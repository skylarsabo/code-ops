---
description: "Use when you want a rigorous pre-merge review of one PR/diff against all quality lenses; prioritized comments + a verdict. For a verification-bar review that blocks only on reproduced defects, use rigor:deep-review; for an anonymity gate, privacy-opsec-suite:opsec-pr-gate."
disable-model-invocation: true
---

# PR REVIEW — Rigorous Pre-Merge Review

**Invoked as `/code-ops-suite:pr-review`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** REVIEW · **Produces:** a prioritized review + verdict (as PR comments if a VCS tool is connected, else `REVIEW.md`).

A senior-level review of a *specific change* before merge, held to the relevant quality lenses (`CONVENTIONS §10`). Review-only by default — don't push changes unless asked (then switch to the implementation loop, `§11`).

## Phase 0 — Understand the change
Pull the PR/branch/diff and its **intent**: description, linked issue/finding/spec, and the surrounding code context (review the diff *against* the code it changes, not in isolation). Trace the change's **reach** before reviewing it: for changed exported symbols, shared types/schemas, and API/DB contracts, locate the dependents and call sites (fan out explorers), and scale reviewer fan-out and depth to that reach (impact × reach, `§8`) — not just to diff size; a small diff in a shared contract is a large review. For large PRs, fan out parallel reviewers per file-group/concern and synthesize one coherent review.

## Phase 1 — Review against the lenses (scoped to the diff + needed context)
Apply the relevant lenses (`§10`): **correctness & intricate bugs** (does it do what it claims? edge/error/null cases, races, contract mismatches); **design & modularity** (fits the architecture; no new coupling/duplication; right-sized, not over/under-engineered); **performance/efficiency** regressions; **security** introduced; **privacy/data handling** (no new collection/leakage/correlation surface or weakened defaults — treat a regression as blocking, scaled to the system's data sensitivity); **UI/theming/a11y** for UI changes (tokens, all states, parity — verify with the UI tool); **tests** (present, meaningful, cover the change's logic and edge/error paths); **docs** (updated where behavior/contracts changed); **conventions** (matches the repo's style and patterns).

## Output — the review
Prioritized, each comment at `file:line` with the issue **and** a concrete suggested change: **Blocking** (bugs, security/privacy regressions, broken contracts, missing critical tests) · **Should-fix** · **Nit** (clearly labeled, low-pressure). Briefly note what's done well. End with an overall **verdict** — *approve / approve-with-nits / request-changes* — and a 2–3 line summary of quality and risk. Surface **blocking** items at the top.

Before any item ships as **Blocking**, put it through **independent refutation** (`CONVENTIONS §7`): hand it to a fresh `reviewer`/`tracer` in refutation mode — one that did *not* raise it — whose only job is to kill it by locating a dominating guard or handler elsewhere (another function, file, or boundary). A refuted item drops or downgrades, citing the guard. Each comment quotes a verbatim **Anchor** of its cited line (`§9`) so the citation is checkable.

## Done when
Every changed file reviewed against the applicable lenses; each issue has a location + concrete fix and a priority; UI changes verified; a clear verdict + summary given; blocking items first. If asked to fix rather than flag, switch to the implementation loop.
