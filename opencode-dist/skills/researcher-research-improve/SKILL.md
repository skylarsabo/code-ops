---
name: researcher-research-improve
description: "Use when you want grounded, external-best-practice improvements proposed for our existing code, not a generic checklist. Writes no code, and proposes and hands off instead."
---

# Research improve: ground the code, gather the outside, propose verified improvements

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/researcher/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/researcher-research-improve`, or by the model through the `skill` tool as `researcher-research-improve`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It carries the research-integrity and egress model
(`§A`), the protocol, the rails, the schemas, the tiers, and the lenses, referenced by
section.

- **Mode:** DISCOVERY.
- **Produces:** `RESEARCH_FINDINGS.md` with `RSCH-NNN` entries, `EGRESS_MANIFEST.md` when
  web research was approved, and `EXECUTIVE_SUMMARY.md`.

Ask the outside world how a slice of our code is done well, covering the capabilities of
libraries we already depend on, established patterns, and known pitfalls. Then propose the
improvements that demonstrably apply here. The run is local-first, and web egress is opt-in
and disclosed (`§A`). Every claim is cited and tiered (`§7`), and a candidate that fails
disconfirmation is dropped. The skill proposes and hands off. It never edits source (`§A`,
`§11`).

## Phase 0. Scope, targets, and egress permission  *(checkpoint)*

Pin the target, meaning the modules, the subsystem, or the concern, which may be
correctness, robustness, idiomatic dependency use, maintainability, or a non-measured
quality gap. Pin the constraints, meaning the runtime and version floors, the stack, the
privacy and egress posture, and the appetite. Inventory the local sources first: the
codebase, version-control history, the installed dependency documentation through
`<plugin-root>/scripts/lib-docs.mjs` (`§2`), and anything the developer hands you.
Decide whether web research is needed at all.

> **CHECKPOINT, the egress gate (`§A`, `§3`):** present the target, the constraints, and the
> local-versus-external plan. Default to local-only. If web research would add value, state
> why, which hosts and queries, and what for, then get explicit opt-in before any request
> leaves the machine. If it is declined, proceed local-only.

## Phase 1. Ground: map the relevant code and its constraints

Dispatch gatherers, in parallel over disjoint sub-questions, to build the local picture
before reaching out. Cover the target's structure, the seams where a change would apply, the
current approach with the library APIs used and how, the idioms, and the workarounds, the
git history for intent and prior attempts, the exact installed dependency versions, because
an improvement must fit the version we run rather than the latest, the existing tests and
what they pin, the blast radius per seam, and the constraints that would veto a change.
Record the commit SHA researched against (`§12`). Anything not grounded in our code stays
`UNVERIFIED` (`§A`).

## Phase 2. Gather  *(local first, web only if opted in)*

Work cheapest and most local first:

- **Installed-dependency capabilities, the default, with zero query egress.** Dispatch
  gatherers, in parallel over disjoint sub-questions, over `lib-docs.mjs`, or over the
  `code-ops-docs` MCP server's `get-docs` tool when `code-ops-suite` is installed. Look for
  what our dependencies already offer that we hand-roll or misuse. The primary source is the
  library's own installed documentation and types (`§2`, `§7`).
- **Patterns and pitfalls in the wild.** Find the established patterns for this concern, and
  the documented failure modes of our approach.
- **Opt-in web, only if it was granted in Phase 0.** Compose the `deep-research` skill,
  which fans out to search, fetches, and verifies adversarially. Record every external
  request with `node <plugin-root>/scripts/research-manifest.mjs record ...`, storing
  the time, the tool, the host, the URL, and the reason, as it happens (`§A`, `§12`).
  Triangulate primary over secondary, and two independent secondary sources beat one (`§7`).
  Redact secrets and personal data to `<REDACTED:reason>` (`§4`). Surface the running
  manifest at the next checkpoint.

## Phase 3. Verify and disconfirm each candidate  *(checkpoint)*

Run the disconfirmation pass on every candidate (`§A`, `§10`), because assertion is not
evidence:

- **Does it apply here?** Map it to a real seam at `file:line` under our constraints and our
  installed versions, or drop it as generic.
- **Is it already done?** Re-check the tree, and cite the satisfying line instead of
  proposing the change.
- **Is it compatible?** Confirm it is not vetoed by the stack, the version floors, or the
  privacy and egress posture. A proposal that adds a new outbound path is itself an egress
  concern, so flag it rather than assume it.
- **Is it worth it?** Weigh the concrete value against the effort and the blast radius. A
  measured performance claim is out of scope, so hand it to `rigor:improve-measured` and
  never assert a speedup.

Dispatch a claim-checker per candidate, in parallel, to gate the survivors adversarially.
Tier each one CONFIRMED, PROBABLE, or SPECULATIVE, and when unsure, take the lower tier. No
external claim survives without a manifest entry. Re-confirm the survivors against the
current SHA (`§12`).

> **CHECKPOINT:** present the surviving candidates with their tiers, and the manifest of
> anything that egressed. The developer confirms which ones graduate to the register. Drop
> the rest with a one-line reason.

## Phase 4. Register the findings (`§6` schema, tiered, cited, handed off)

Write each survivor to `RESEARCH_FINDINGS.md` as an `RSCH-NNN` entry on the finding schema
(`§6`), with all fields and a `Verified-at: <sha>` stamp. Assign the track, which is
NOW-SAFE, NEEDS-REVIEW, or NEEDS-DESIGN (`§6`). Rank by value multiplied by reach, divided by
effort, and weighted by tier and grounding (`§8`). A SPECULATIVE item ranks below any
PROBABLE or CONFIRMED item.

Hand off per `§11`. An improvement goes to `code-ops-suite:remediation` or
`rigor:fix-verified`. A broad behavior-preserving measured win goes to
`rigor:improve-measured`. An architectural rework goes to NEEDS-DESIGN for an `adr`. A
finding is done when its implementer can act without re-researching
(`§11`). The researcher never makes the change itself.

## Validate and publish

Re-validate the register against the current tree with
`node <plugin-root>/scripts/revalidate-register.mjs RESEARCH_FINDINGS.md --root .`,
then triage its FRESH, MOVED, DRIFTED, GONE, AMBIGUOUS, and NO-REF verdicts. Re-tier
anything stale, or mark it `OBSOLETE-AT <sha>` (`§12`). Then run
`node <plugin-root>/scripts/research-manifest.mjs validate RESEARCH_FINDINGS.md`,
which fails closed when any external claim cites a source absent from `EGRESS_MANIFEST.md`
(`§A`). Both must pass before you present. Write the deliverables to a dated folder under
the repository's documentation location (`§12`), and lead `EXECUTIVE_SUMMARY.md` with the
top-ranked improvement.

## Done when

The target and the constraints are scoped, and the egress gate is honored, staying local-only
unless egress was explicitly opted in. The relevant code is mapped and every claim is
grounded at a recorded SHA. External knowledge was gathered local-first, and any web egress
was recorded in `EGRESS_MANIFEST.md` as it happened. Every candidate survived
disconfirmation, is tiered and cited (`§7`), maps to a real seam, and carries a smallest
slice plus a concrete hand-off (`§11`). The register is deduplicated, ranked (`§8`), stamped
`Verified-at: <sha>`, and passing both `revalidate-register.mjs` and
`research-manifest.mjs validate`. No code changed, and a final self-audit removed the generic
filler and the unverified capabilities. Present `EXECUTIVE_SUMMARY.md` first, with the
highest-value grounded improvement at the top, then the register path.
