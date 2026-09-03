---
name: pr-review
description: "Use when you want a rigorous pre-merge review of one PR or diff against all quality lenses. For a verification-bar review that blocks only on reproduced defects, use rigor:deep-review. For an anonymity gate, use privacy-opsec-suite:opsec-pr-gate."
---

# PR review: rigorous pre-merge review

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:pr-review`.** First read the `<plugin-root>/CONVENTIONS.md`
bundled with this plugin. Search the plugin directory for it if needed. It defines the operating
model, interaction protocol, safety rails, schemas, and quality lenses this skill references by
section.
**Mode:** REVIEW · **Produces:** a prioritized review and a verdict, as PR comments when a
version-control tool is connected, and otherwise as `REVIEW.md`.

Give a senior-level review of one *specific change* before merge, held to the relevant quality
lenses (`CONVENTIONS §10`). This skill reviews only by default. Do not push changes unless asked,
and when asked, switch to the implementation loop (`§11`).

## Phase 0: the change and its reach

Pull the PR, branch, or diff and its **intent**: the description, the linked issue or finding or
spec, and the surrounding code context. Review the diff *against* the code it changes, never in
isolation.

Trace the change's **reach** before reviewing it. For changed exported symbols, shared types or
schemas, and API or database contracts, locate the dependents and call sites by fanning out
explorers. Scale the reviewer fan-out and depth to that reach (impact times reach, `§8`), not to
the diff size. A small diff in a shared contract is a large review. For a large PR, fan out
parallel reviewers per file-group or concern, then synthesize one coherent review.

## Phase 1: the lenses, scoped to the diff plus the needed context

Apply the relevant lenses (`§10`):
- **Correctness and intricate bugs:** does the change do what it claims, across edge, error, and null cases, races, and contract mismatches?
- **Design and modularity:** does it fit the architecture, without new coupling or duplication, right-sized rather than over- or under-engineered?
- **Size and boundary:** is it the smallest change that satisfies the ordered objective, with no new file, interface, wrapper, or dependency added without the ladder's evidence (`§11`)?
- **Performance and efficiency:** does it regress anything?
- **Security:** does it introduce a weakness?
- **Privacy and data handling:** does it add collection, leakage, or correlation surface, or weaken a default? Treat a regression as blocking, scaled to the system's data sensitivity.
- **UI, theming, and accessibility** for UI changes: tokens, all states, and parity, verified with the UI tool.
- **Tests:** are they present, meaningful, and covering the change's logic and its edge and error paths?
- **Docs:** are they updated where behavior or contracts changed?
- **Conventions:** does the change match the repo's style and patterns?

The mechanical floor under the size-and-boundary lens is
`node <plugin-root>/scripts/co.mjs scan overbuild --git <range>` over the reviewed range.
It blocks only on an unrecorded dependency, and its other tells are leads for the lens rather
than review comments on their own.

## The output: the review

Give a prioritized review. Put each comment at a `file:line` with the issue **and** a concrete
suggested change, under one of three headings:
- **Blocking:** bugs, security or privacy regressions, broken contracts, and missing critical tests.
- **Should-fix.**
- **Nit:** clearly labeled and low-pressure.

Note briefly what is done well. End with an overall **verdict** of approve, approve-with-nits, or
request-changes, plus a summary of quality and risk in two or three lines. Surface the blocking
items at the top.

Before any item ships as **Blocking**, put it through **independent refutation**
(`CONVENTIONS §7`). Hand it to a fresh `reviewer` or `tracer` operative in refutation mode, one
that did *not* raise it, whose only job is to kill it by locating a dominating guard or handler
elsewhere, in another function, file, or boundary. A refuted item drops or downgrades, citing the
guard. Each comment quotes a verbatim **Anchor** of its cited line (`§9`), so the citation is
checkable.

## Done when

- Every changed file was reviewed against the applicable lenses.
- Each issue carries a location, a concrete fix, and a priority.
- UI changes were verified.
- A clear verdict and summary were given, with the blocking items first.
- When asked to fix rather than flag, the run switched to the implementation loop.
