---
name: researcher-research-ideate
description: "Use when you want net-new, honestly novel feature or direction ideas grounded in our code plus its domain and opt-in external trends. Writes no code. For ideas mined from the codebase alone, use code-ops-suite:feature-discovery."
---

# Research ideate: net-new directions, grounded and feasibility-checked

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/researcher/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/researcher-research-ideate`, or by the model through the `skill` tool as `researcher-research-ideate`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It carries the research-integrity and egress model
(`§A`), the protocol, the rails, the schemas, the tiers, and the lenses, referenced by
section.

- **Mode:** DISCOVERY.
- **Produces:** `IDEAS_REGISTER.md` with `IDEA-NNN` entries, `EGRESS_MANIFEST.md` when any
  web egress happened, and `EXECUTIVE_SUMMARY.md`.

The outside view, meaning prior art, adjacent products, ecosystem trends, and capabilities
our dependencies already ship, becomes net-new ideas that fit our code.
`code-ops-suite:feature-discovery` mines the codebase alone, and this skill looks beyond the
repository. Every idea is cited and tiered (`§7`), grounded (`§A`), feasibility-checked, and
cut to its smallest slice. The skill proposes and hands off (`§11`), and writes no code
(`§4`).

## Phase 0: product read, direction, and egress permission  *(checkpoint)*

Work locally only. Detect the stack and read the product: the current feature set, the main
flows, the target users, and the intent signals in the documentation, the README, the
architecture, the TODOs, flags, and stubs, and the version-control history. Frame the
ideation by naming the domain, the user, the appetite, meaning quick wins against big bets,
and what net-new means for this product.

> **CHECKPOINT, on direction and egress.** Present the product read, the candidate idea
> spaces, and the appetite. State the egress decision explicitly. Phase 2 stays fully local,
> using `lib-docs` and the provided materials, unless web reach for adjacent products and
> trends is opted in and bounded, naming which questions and which hosts. No network call
> happens before that approval (`§3`).

## Phase 1: ground the capabilities, the latent assets, and the constraints

Work locally only. Dispatch gatherers, in parallel over disjoint sub-questions, to cite
everything at `file:line`. Establish the floor an idea must clear:

- **Current capabilities**, so that an idea is genuinely new rather than a re-skin.
- **Latent assets**, meaning the data collected, the services and libraries present, and the
  infrastructure already paid for. The highest-leverage ideas exploit an asset we own, so
  surface these first.
- **Constraints**, meaning the stack, the grain of the architecture, performance and scale,
  and the privacy and egress posture. An idea that weakens data handling or adds an outbound
  path is flagged, never silently proposed.

Note the directions that version-control history shows were tried and abandoned.

## Phase 2: gather inspiration  *(local first, web only if opted in at Phase 0)*

- **Dependency capabilities.** Dispatch gatherers, in parallel over disjoint dependencies,
  for what installed libraries already offer that we do not use. Use
  `<plugin-root>/scripts/lib-docs.mjs`, or the `code-ops-docs` MCP server when
  `code-ops-suite` is installed. It reads the installed version with zero query egress
  (`§2`).
- **Prior art in the provided materials.** Use the pasted text, file paths, and URLs the
  developer explicitly handed you. These are local inputs, not egress.
- **Adjacent products and trends, on the web, opt-in.** Only if it was approved at Phase 0,
  compose the `deep-research` skill, which fans out to search, fetches, and verifies
  adversarially. Each external request is a checkpoint (`§3`). Record every request as it
  happens with
  `node <plugin-root>/scripts/research-manifest.mjs record --tool <tool> --host <host> --url <url> --why "<reason>"`.

> **CHECKPOINT, surface the manifest** before leaving this phase (`§A`). Confirm that the
> scope was honored and that nothing left the machine unrecorded. If no web was used, state
> that the run stayed fully local.

Mine these lenses, aiming for net-new rather than parity:

- latent-asset exploitation
- workflow completion, or a new flow
- automation and power-user capability
- a new surface or integration
- category differentiation
- trust, transparency, and control as a feature
- accessibility as reach
- a monetizable or platform direction

Apply the honest-novelty lens (`§10`) throughout, and tag what is genuinely new against what
merely follows a trend.

## Phase 3: feasibility and disconfirmation  *(compose `research-verify`)*

Run the disconfirmation pass (`§A`) on every candidate before it earns an ID, and drop what
does not survive:

- **New here?** Cross-check Phase 1. Is it already shipped, or a near-duplicate?
- **Feasible here?** Does it fit our stack and its grain, or does it assume infrastructure
  we lack? Consider the blast radius and the migration cost.
- **Worth it?** Weigh value multiplied by reach against effort. Is it a shiny trend with
  thin grounding?
- **Egress-safe and privacy-safe?** An idea that adds an outbound path or new data
  collection is flagged for a developer decision, never assumed acceptable.

For each survivor, dispatch a claim-checker, one per idea in parallel, to confirm the
external claims behind it adversarially and to set the honest tier. A single weak secondary
lead is SPECULATIVE (`§7`). An ungrounded claim is `UNVERIFIED` and ranks below anything
PROBABLE or CONFIRMED (`§8`).

## Phase 4: register the ideas  *(checkpoint)*

Write each survivor to `IDEAS_REGISTER.md` on the finding and idea schema (`§6`), with a
stable `IDEA-NNN`, all fields, and a `Verified-at: <sha>` stamp. The disconfirmation field
includes the near-duplicates ruled out. The smallest-slice field names the cheapest version
that proves the idea. Rank by value multiplied by reach, divided by effort, and weighted by
tier and grounding (`§8`). Tag the quick wins against the big bets, and lead with a ranked
top-N.

Hand off per `§11`. An actionable idea goes to `code-ops-suite:feature-discovery` to be
specified into the backlog, or to `code-ops-suite:feature-implementation` to build a
well-scoped slice. A direction with real architectural trade-offs goes to
`code-ops-suite:adr`.

> **CHECKPOINT.** Present the ranked register top first. Confirm which ideas are handed off,
> and to which skill. Surface the final egress manifest one last time.

## Deliverables

A dated discovery folder holding `IDEAS_REGISTER.md`, `EGRESS_MANIFEST.md` when any web
egress happened, and `EXECUTIVE_SUMMARY.md`, which carries the top directions, the single
highest-value idea, the decisions needed, and the run's local-versus-web egress posture.

## Done when

The Phase 0 direction and egress decisions are confirmed. The grounding is established and
every idea is tested against it. There was no un-opted-in or unrecorded egress: every
external request is manifested and no web citation is absent from the manifest, verified by
`node <plugin-root>/scripts/research-manifest.mjs validate IDEAS_REGISTER.md`
(`§A`). Every idea is disconfirmed for being new here, feasible here, and worth it,
claim-checked through research-verify, and cited and honestly tiered (`§7`), with a smallest
slice and a hand-off target (`§11`). The register is deduplicated, scored, and ranked, and
each entry is re-confirmed against the current tree and stamped `Verified-at: <sha>`,
pre-filtered with
`node <plugin-root>/scripts/revalidate-register.mjs IDEAS_REGISTER.md --root <repo>`
(`§12`). Both checkpoints are done, no code changed, and a final self-audit checked for
cargo-cult filler and unverified capabilities. Present `EXECUTIVE_SUMMARY.md` first, with
the highest-value idea at the top.
