---
type: decision
status: accepted
updated: 2026-08-19
tags:
  - meta
  - fleet
---

# D-003 consent parsing is a spec

## Decision

The parsing rules in `code-ops-docs/40 Engineering/Techniques/fleet-standard.md` are the normative specification of the fleet consent contract format. `check-fleet.mjs` implements that specification. Where a markdown renderer displays a contract differently, the specification governs enrollment.

An edge case the rules do not cover is closed by amending the page and the checker together, deliberately. It is never closed by adjusting the checker until it matches whatever a renderer happened to do.

Two author-facing rules make the edge cases irrelevant for anyone writing a contract: write consent as a flush undecorated line, and show the phrase in an example only inside a flush fenced block.

## Context

Consent decides whether a fleet run may write to a repo, so the matcher has to be exact in both directions. A false positive edits a repo that refused in writing. A false negative reports a consenting repo as a deliberate decline, which no operator would think to check.

Three review rounds each found the same shape of defect: a container-and-leaf nesting the reader handled in one direction and not its mirror. Blockquoted fences, then quote markers inside open fences, then indented lines inside open lists. Each fix was correct. The pattern was that the finding class had no floor, because CommonMark is large and its container interactions are ambiguous at exactly the depths a contract file reaches.

## Options considered

1. **Declare the documented rules normative.** Chosen. The rule set is small, stated once in `markdownLines`, mirrored on one page, and pinned by the `fleet-standard` eval in both directions. The author-facing guidance is two sentences.
2. **Track CommonMark renderer behavior indefinitely.** Rejected. It is an unwinnable chase against an ambiguous target. No renderer is the reference, renderers disagree with each other at these nestings, and every round would close one mirror pair and open the next.
3. **Adopt a full CommonMark parser.** Rejected. The marketplace runs on `node:` builtins only, and a vendored parser is a dependency and a supply-chain surface bought to decide a four-word phrase.

## Consequences

Renderer divergence is a documentation issue, not a checker bug. A report that a renderer shows a contract differently is answered by describing the difference, or by amending the specification on purpose.

Specification amendments are deliberate and paired. The page and the checker change in one commit, with an eval case in each direction.

The finding class is closed. A future review that finds an undocumented nesting is proposing a specification amendment, which is a design question rather than a defect.

Amended 2026-08-19: the first amendment under this procedure removed the list-context consent-cap lift, because it reopened the indent hole 1.43.3 closed — see "Amended 2026-08-19" in `code-ops-docs/40 Engineering/Techniques/fleet-standard.md`.

## Related

- [[Standard]]
- [[D-002 vault adoption stays voluntary]]
- `code-ops-docs/40 Engineering/Techniques/fleet-standard.md`
