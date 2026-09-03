---
description: "Use when you want code-grounded research run end-to-end as one developer-in-the-loop pipeline, local-first with opt-in disclosed web. Intra-plugin orchestrator that researches and proposes only, and writes no code."
---

# Research sweep: the whole research pipeline, end to end

**Invoked as `/researcher:research-sweep`.** First read the bundled
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. It carries the research-integrity and egress model
(`§A`), the modes (`§5`), the schema and tiers (`§6`, `§7`), the priority rule (`§8`), the
lenses (`§10`), the hand-off map (`§11`), and the single-source-of-truth rules (`§12`).

This skill orchestrates the researcher's own skills in sequence as one
developer-in-the-loop pipeline. It does not replace them. It carries the shared registers
forward fresh, keeps a master plan, pauses at every phase boundary, and always surfaces
`EGRESS_MANIFEST.md` at each checkpoint.

- **Mode:** orchestrator, running DISCOVERY and REVIEW, and never DOCUMENT alone.
- **Produces:** a consolidated `RESEARCH_FINDINGS.md`, `IDEAS_REGISTER.md`, the per-spike
  design briefs, `EGRESS_MANIFEST.md`, and one `EXECUTIVE_SUMMARY.md`. It never edits code
  (`§A`, `§4`).
- **Requirements:** nothing beyond the researcher plugin. It composes a `code-ops-suite`,
  `rigor`, or `privacy-opsec-suite` skill only when installed, and only for hand-off (`§11`).

## Phase 0: scope the run and set egress permission  *(checkpoint)*

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs --artifact-dir <run folder>` first. A
FAIL stops the run before any fan-out, and an advisory is noted in the register. After
preflight passes, run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/repo-map.mjs --out <run folder>/REPO_MAP.md`. On
failure, note the advisory and proceed.

Dispatch a gatherer to detect the stack, the repository size, and the questions driving the
sweep, and hand its summary plus `REPO_MAP.md` to the next phase. Record the HEAD SHA that
everything is verified against (`§12`). Then confirm with me:

- **Which modes run, and in what order.** Any of **research-improve**, **research-ideate**,
  **library-eval**, **research-spike**, and **ecosystem-watch**. The default order is ground,
  then improve with ideate, then verify, then propose. **research-verify** is not optional,
  because it gates every load-bearing claim before publication (`§7`).
- **Scope**, meaning which areas and questions are in or out, the appetite, meaning quick
  wins against big bets, and the hand-off targets you care about (`§11`).
- **Egress permission and scope.** The default is local-first: the codebase, version-control
  history, installed-dependency documentation through `lib-docs` (`§2`), and the materials
  you hand me. Web and external retrieval is opt-in, and off unless granted here. If it is
  granted, name the allowed scope, meaning which questions and which hosts. Every external
  request is recorded in `EGRESS_MANIFEST.md` and surfaced, and no artifact is published
  citing an un-manifested source (`§A`).

Open a master todo list and a running `EXECUTIVE_SUMMARY.md`, and initialize
`EGRESS_MANIFEST.md` in the dated run folder (`§12`). Surface any critical finding to me
immediately, in any phase, as a hand-off (`§A`, `§4`). A live secret, a known-exploited CVE,
and a broken trust boundary all qualify. Read a large file through its outline first:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs context skim <file>` prints its imports, symbols,
and line counts, so a brief reads one range instead of the whole file.

> **CHECKPOINT, before any network egress:** present the planned phase order, the scope, and
> the egress decision in plain terms, stating what may leave the machine, why, and that every
> request will be disclosed in `EGRESS_MANIFEST.md`. No web request happens before you
> approve. Keep local gathering moving while a decision is pending (`§3`).

## Phase 1: ground in our code  *(local, zero egress)*

Establish the grounding baseline every later phase ties back to (the `§A` grounding rule).
Map the relevant architecture, the constraints, and the in-repository prior art. Verify every
library and framework fact against the installed version, through `lib-docs` or through the
`code-ops-docs` MCP server when `code-ops-suite` is installed, never from memory (`§2`, and
the `§10` source-quality lens). Pull version-control history for why the code is the way it
is.

> **CHECKPOINT:** the grounded picture, and the open questions the next phase must answer.

## Phase 2: gather  *(checkpoint, which surfaces the manifest)*

Run the selected discovery skills against the grounded baseline, fanning out read-only
(`§1`): **research-improve**, **research-ideate**, **library-eval**, **research-spike**, and
**ecosystem-watch**. Each one emits entries on the finding and idea schema, with sources, a
tier, the grounding, and a disconfirmation pass (`§6`, `§7`). Collect them into
`RESEARCH_FINDINGS.md` and `IDEAS_REGISTER.md`, each stamped `Verified-at: <sha>` (`§12`).

If web egress was granted, the gathering skills compose the `deep-research` skill within the
approved scope, and every external request is recorded the moment it happens:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record --tool <tool> --host <host> --url <url> --why "<reason>"`
(`§A`). Prefer installed-version documentation and primary sources, and triangulate (`§7`).

> **CHECKPOINT:** the raw candidate registers, the gaps still open, and the current
> `EGRESS_MANIFEST.md`, showing exactly what left the machine.

## Phase 3: verify  *(checkpoint)*

Run **research-verify** over every load-bearing claim, recommendation, and external fact,
adversarially, against both our code and the cited sources (`§7`, and the `§10` grounding
lens). Re-tier on the evidence per the `§7` tiers of CONFIRMED, PROBABLE, and SPECULATIVE.
Anything unsupported or ungrounded is dropped or marked `UNVERIFIED`, and never presented as
fact (`§A`, `§7`).

Apply the disconfirmation pass once more before carry-forward, asking whether it is already
done here, incompatible with our stack, superseded, or merely assumed (`§A`). Re-validate the
registers mechanically before they cross this boundary with
`node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>`,
dropping or `OBSOLETE-AT <sha>`-stamping anything that no longer holds (`§12`).

> **CHECKPOINT:** the verified, re-tiered registers, with CONFIRMED separated from PROBABLE
> and SPECULATIVE, and any claim that failed, with the manifest still in view.

## Phase 4: propose and hand off  *(checkpoint)*

Rank the survivors by value multiplied by reach, divided by effort, and weighted by tier and
grounding (`§8`). For each one, give the concrete recommendation, the smallest valuable
slice, the trade-offs, and the hand-off target. Never write "consider maybe" (`§9`).

Map each item to an implementer (`§11`). A grounded improvement goes to
`code-ops-suite:remediation` or `rigor:fix-verified`. A feature or idea goes to
`code-ops-suite:feature-discovery`, `code-ops-suite:feature-implementation`, or
`code-ops-suite:ship`. An adopt-or-replace choice, or a load-bearing design decision, goes to
`code-ops-suite:adr`. Measured performance work goes to `rigor:improve-measured`. A
dependency or CVE action goes to `code-ops-suite:dependency-upgrade` or
`privacy-opsec-suite:supply-chain-trust`.

Each design brief meets `§13` and is concrete enough that its implementer can act without
re-researching (`§11`). The researcher never edits code (`§A`, `§4`).

> **CHECKPOINT:** the ranked, hand-off-ready registers and briefs.

## Phase 5: consolidate the executive summary  *(final, validate before publishing)*

Write one `EXECUTIVE_SUMMARY.md` carrying the questions, the grounded answer, and the
unified picture across the findings, the ideas, and the briefs, with CONFIRMED separated
from PROBABLE and SPECULATIVE (`§7`). Lead with the highest-value, best-grounded item, and
give each item its tier, its sources, and its hand-off target (`§8`, `§11`). Run a final
self-audit for generic filler, fabricated sources or capabilities, and ungrounded claims
presented as fact (`§4`, `§10`).

Before publishing any artifact, validate the egress fail-closed with
`node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate <artifact>` for each
register, each brief, and the summary. A published artifact must not cite a web source
absent from `EGRESS_MANIFEST.md`, and the script exits non-zero when one does (`§A`, `§12`).
All artifacts live in the dated run folder (`§12`).

## Done when

Every selected phase is complete, its deliverable is produced, and its checkpoint is passed.
The egress decision was made explicitly at Phase 0, and no web request occurred without it.
Every external request is recorded in `EGRESS_MANIFEST.md` and was surfaced at the
checkpoints. Every load-bearing claim ran through **research-verify** and is cited and tiered
(`§7`), with CONFIRMED separated from PROBABLE and SPECULATIVE. The carried-forward registers
are fresh, with no obsolete item re-shown and each entry stamped `Verified-at: <sha>` (`§12`).
Every actionable item is mapped to a real implementer skill (`§11`).
`research-manifest.mjs validate` passed fail-closed on each published artifact (`§A`), and no
code changed (`§4`). `EXECUTIVE_SUMMARY.md` ties the findings, the ideas, and the briefs into
one consistent picture. Present the summary first, with the highest-value, best-grounded item
at the top, then anything still awaiting your decision.
