---
description: "Use when you have one big branch you want carved into a clean, reviewable stack of small PRs, each independently green and traceless."
---

# PR split: carve a big branch into a clean, traceless stack

**Invoked as `/code-ops-suite:pr-split`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`
bundled with this plugin: the operating model, the interaction protocol, the safety rails
including the automation-level ladder (`§4`), and the implementation loop (`§11`) this skill
follows.
**Mode:** IMPLEMENT. **Consumes:** the current branch, compared against its trunk. **Produces:** a
stack of small, independently-green PRs, opened with trace-free, voice-matched metadata.
**Composes:** `privacy-opsec-suite:authorship-hygiene` and `code-ops-suite:local-review-gate`,
both fail-closed, before any push.

## Phase 0: the scope and the baseline  *(checkpoint)*

Resolve the merge-base against the target trunk, and capture the full diff. Run
`/rigor:ground-truth` for the build, test, and lint baseline. Learn the repo's commit and PR
conventions from `git log`, which feeds the hygiene pass. Confirm the trunk, the maximum PR size,
and the **automation level** (`§4`). The default is `gated`. For full automatic execution, set it
explicitly here.

## Phase 1: the decomposition

Build a change-unit graph over the diff, and group the hunks into PRs by three criteria:
- **Dependency:** define before use, and import edges.
- **Concern or layer:** for example schema, then api, then ui.
- **Atomicity:** one reviewable idea each.

Size each group for a reviewer, at roughly 400 lines or fewer, and make that limit configurable.
Order the groups topologically. Emit the plan, giving each PR a title, a description, its files
and hunks, its parent, and an estimated size. Surface the plan.

## Phase 2: verify as you carve

For each PR in order, create the stacked branch on its parent, apply only its hunks, and get the
**build and tests green at that step**. Green at every step is the invariant that makes the split
usable. When an intermediate step is red, regroup, because the hunk has an unstated dependency.
Keep a growing record, so a later PR cannot silently break an earlier one.

## Phase 3: the trace scrub  *(fail-closed)*

Run `privacy-opsec-suite:authorship-hygiene` over the whole stack, covering L1 metadata, L2 prose
voice, and L3 code-idiom blend-in. It runs `scan-ai-tells.mjs` fail-closed. When
`privacy-opsec-suite` is not installed, run the bundled
`${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs scan ai-tells` directly as the mechanical floor. **Abort
the push when the trace cannot be cleaned.**

## Phase 4: local review and publication

For each final stacked branch, run the deterministic gate chain and read the diff. Run
`code-ops-suite:local-review-gate` against its exact parent and committed HEAD only when the
operator opted in for that branch. A fix then invalidates that branch's receipts, and every
descendant whose base or diff moved.

Push each branch without opening its PR. Publish its SHA-bound local statuses when the gates ran.
Then open the PR through `gh` against its parent. **Never auto-merge.** Never force-push over an
existing remote branch without confirmation. Per the automation level, `gated` pauses before the
push, while `auto-safe` and full automatic execution proceed after one abortable dry-run summary.

Merging the stack once it is up is a developer action, not this skill's. See
`code-ops-docs/40 Engineering/Handbook/10-recovery-and-troubleshooting.md` §6, from the repo
root, for the retarget-before-delete order and the CONFLICTING-tip reconciliation once a parent
PR merges.

## The safety rails, the full-automatic floor

- `scan-ai-tells` passes before push, fail-closed.
- Each PR is green before the next is carved.
- Nothing auto-merges.
- One abortable dry-run precedes the outward-facing push.
- L3 stays behavior-preserving.

## Done when

- Every PR in the stack is atomic, single-concern, and **independently green on build and tests**.
- Each final committed diff was read by the lead, and carries current local deep-review and OpSec receipts where the operator opted in.
- The stack is pushed and opened with trace-free, voice-matched titles and descriptions, and `scan-ai-tells` exits 0 over the whole stack.
- Nothing was auto-merged.
- The summary lists the stack, the receipt identities, the links, and anything left for your decision.
