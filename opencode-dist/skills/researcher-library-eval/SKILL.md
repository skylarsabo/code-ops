---
name: researcher-library-eval
description: "Use when you must decide whether to adopt a library or approach, comparing A against B against building it, and want a code-grounded fit assessment, migration cost, and a tiered recommendation. Writes no code."
---

# Library evaluation: adopt it, build it, or keep the status quo

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/researcher/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/researcher-library-eval`, or by the model through the `skill` tool as `researcher-library-eval`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It carries the research-integrity and egress model
(`§A`), the protocol, the rails, the evidence and citation discipline, the hand-off map, and
the lenses, referenced by section.

- **Mode:** REVIEW.
- **Produces:** a comparison and recommendation brief in `LIBRARY_EVAL.md`, on the `§13`
  documentation standard, plus `EGRESS_MANIFEST.md` when any web source was used.
- **Rule:** capabilities are verified against the version, never from memory. The skill
  never edits code. It evaluates, recommends, and hands off (`§11`).

## Phase 0. Frame the decision  *(checkpoint, and egress is opt-in)*

Pin the need, the candidates, and the weighted decision criteria for this repository rather
than a generic checklist. The candidate set includes building it ourselves and keeping the
status quo, as named options, whenever that is honest. Take the local grounding sources
first (`§2`): the codebase, version-control history, and installed-dependency documentation
through `<plugin-root>/scripts/lib-docs.mjs`, or the `code-ops-docs` MCP server when
`code-ops-suite` is installed. None of that egresses. Mark each candidate as installed,
meaning evaluable locally, or as web-only.

> **CHECKPOINT:** present the need, the full candidate set including build and status quo,
> the weighted criteria, and the local-versus-web split, then confirm the scope. Before any
> network egress (`§A`, `§3`), name each external host and URL and the reason, and get
> explicit opt-in. Record an approved web request with
> `node <plugin-root>/scripts/research-manifest.mjs record ...`, storing the time,
> the tool, the host, the URL, and the reason. Proceed locally while the decision is pending.

## Phase 1. Ground in our code: requirements and constraints

Dispatch gatherers, in parallel over disjoint sub-questions, to derive our own truth first,
citing `file:line` and tiering each claim (`§7`). Cover the requirements, meaning the call
sites, data shapes, hot paths, and contracts touched. Cover the constraints, meaning the
runtime, language, and version, the peer-dependency bounds, the build and packaging, the
performance budgets, the deployment target, and the privacy and egress posture, which asks
whether the candidate phones home, bundles telemetry, or opens a new outbound path. Capture
any incumbent it would replace and the migration seam. An ungrounded criterion is
SPECULATIVE (`§A`).

## Phase 2. Gather the real capabilities  *(verify against the version, not memory)*

Never assert from training memory (the `§10` source-quality lens):

- **Installed candidates.** Dispatch a gatherer per candidate, in parallel, to read the
  installed version's documentation, types, and source through `lib-docs`, or through
  `current-docs` when it is available. That is primary and zero-egress. Cite the installed
  version rather than the latest.
- **Web-only candidates.** Only after the Phase 0 opt-in, compose the `deep-research` skill,
  which fans out to search, fetches, and verifies adversarially, for the primary
  documentation, the repository, the release notes, and the license. Record every external
  request in the manifest as you go (`§A`). Triangulate primary over secondary, and two
  independent secondary sources beat one (`§7`).
- **Building it ourselves.** Scope the minimal implementation against Phase 1, naming what
  we would own, test, and maintain.

Pin each capability claim to its source, which is an installed document or an external
source with a manifest entry, and tier it. Anything unverifiable against the actual version
is `UNVERIFIED`, never guessed (`§4`).

## Phase 3. Score and disconfirm

Dispatch a claim-checker per candidate, in parallel, to score it and run the disconfirmation
pass (`§A`). Weight by value multiplied by reach, divided by effort, and adjust for
confidence and grounding (`§8`). Cover each of the following, cited and tiered:

- **Fit and coverage.** Our grounded requirements against the generic case, naming the gaps
  and the glue left to us.
- **Maintenance health.** Release cadence, issue and pull request signal, bus factor, and
  recency, read from the project's own repository and recorded when the source is external.
- **License.** Compatibility with ours and with our distribution. Copyleft, attribution, and
  field-of-use terms are a developer decision.
- **Supply-chain and egress trust.** Transitive weight, install scripts, provenance, and any
  telemetry or new outbound path. A deep check goes to
  `privacy-opsec-suite:supply-chain-trust` rather than being asserted here.
- **Migration cost.** Call-site churn, data and contract migration, test changes, and
  rollout and rollback. Name the smallest adoption slice, meaning one module behind a seam,
  before any wholesale switch.
- **Lock-in and reversibility.** Proprietary formats, one-way doors, and ecosystem capture.

Drop or re-tier what does not survive: already solved here, incompatible with a hard
constraint, or superseded (`§A`).

## Phase 4. Recommendation with trade-offs and the smallest slice

Write the brief on the `§13` standard. Lead with the recommendation in one paragraph, naming
which option, the decisive trade-off, and the overall tier of CONFIRMED, PROBABLE, or
SPECULATIVE. Then give the comparison table against the weighted criteria, the grounded fit,
the migration cost with the smallest adoption slice, the runner-up and why it lost, the
risks and trade-offs accepted, and the open questions. Every sentence is cited and tiered
(`§7`), and the brief is freshness-stamped with the SHA it was evaluated against (`§12`,
`§13`). It is done only when the reader could act without re-researching (`§11`).

## Hand-off: the researcher proposes, others implement

Never edit code here (`§11`). The decision and the rejected alternatives go to
`code-ops-suite:adr`. The adoption, the migration, and any version bump go to
`code-ops-suite:dependency-upgrade`. A flagged trust or egress concern goes to
`privacy-opsec-suite:supply-chain-trust`. State the hand-off target explicitly in the brief.

## Done when

The decision is framed, and the full candidate set, including build and status quo, and the
weighted criteria are confirmed. The requirements and constraints are grounded with
`file:line` citations. Capabilities are verified against the installed or actual version,
and every claim is cited and tiered. The egress checkpoint was honored, every external
request was recorded through `research-manifest.mjs`, and the brief was validated with
`node <plugin-root>/scripts/research-manifest.mjs validate LIBRARY_EVAL.md` before
publishing, with no un-manifested web citation. Disconfirmation ran across fit, maintenance,
license, supply chain, migration cost, and lock-in. The brief leads with a tiered
recommendation, a comparison, and the smallest adoption slice, and it names the explicit
hand-off to `code-ops-suite:adr` and `code-ops-suite:dependency-upgrade`. It is SHA-stamped,
and no code changed. Present the recommendation paragraph first.
