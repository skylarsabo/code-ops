---
description: "Use when you have one big branch you want carved into a clean, reviewable stack of small PRs, each independently green and traceless."
disable-model-invocation: true
---

# PR-SPLIT — Carve a Big Branch into a Clean, Traceless Stack

**Invoked as `/code-ops-suite:pr-split`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin — operating model, interaction protocol, safety rails (incl. the automation-level ladder `§4`), and the implementation loop (`§11`) this skill follows.
**Mode:** IMPLEMENT. **Consumes:** the current branch (vs its trunk). **Produces:** a stack of small, independently-green PRs, opened with trace-free, voice-matched metadata. **Composes:** `privacy-opsec-suite:authorship-hygiene` (fail-closed) before any push.

## Phase 0 — Scope & baseline  *(checkpoint)*
Resolve the merge-base against the target trunk; capture the full diff. Run `/rigor:ground-truth` for the build/test/lint baseline. Learn the repo's commit/PR conventions from `git log` (feeds the hygiene pass). Confirm: trunk, max PR size, and the **automation level** (`§4`; default `gated` — for full auto-execute, set it explicitly here).

## Phase 1 — Decompose
Build a change-unit graph over the diff and group hunks into PRs by **dependency** (define-before-use, import edges), **concern/layer** (e.g. schema → api → ui), and **atomicity** (one reviewable idea each), reviewer-sized (~≤400 lines, configurable). Order them topologically. Emit the plan — per PR: title, description, files/hunks, parent, est. size. Surface it.

## Phase 2 — Verify-as-you-carve
For each PR in order: create the stacked branch on its parent, apply only its hunks, and **build/test green at that step**. Green-at-every-step is the invariant that makes the split usable — if an intermediate is red, regroup (the hunk has an unstated dependency). Keep a growing record so a later PR can't silently break an earlier one.

## Phase 3 — Trace scrub (fail-closed)
Run `privacy-opsec-suite:authorship-hygiene` over the whole stack — L1 metadata, L2 prose voice, L3 code-idiom blend-in — which runs `scan-ai-tells.mjs` fail-closed. If `privacy-opsec-suite` is not installed, run the bundled `${CLAUDE_PLUGIN_ROOT}/scripts/scan-ai-tells.mjs` directly as the mechanical floor. **Abort the push if the trace can't be cleaned.**

## Phase 4 — Publish
Push the stack and open each PR via `gh`, targeting its parent branch (a true stack), with the voice-matched descriptions. **Never auto-merge**; never force-push over an existing remote branch without confirmation. Per the automation level: `gated` pauses before push; `auto-safe`/full-auto proceed after one abortable dry-run summary.

## Safety rails (full-auto floor)
`scan-ai-tells` passes before push (fail-closed) · each PR green before the next is carved · never auto-merge · one abortable dry-run before the outward-facing push · L3 behavior-preserving.

## Done when
Every PR in the stack is atomic, single-concern, and **independently builds/tests green**; the stack is pushed and opened with trace-free, voice-matched titles/descriptions (`scan-ai-tells` exits 0 over the whole stack); nothing was auto-merged; and the summary lists the stack (with links) and anything left for your decision.
