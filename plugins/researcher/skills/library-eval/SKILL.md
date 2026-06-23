---
description: "Use when you must decide whether to adopt a library or approach (A-vs-B-vs-build) and want a code-grounded fit assessment, migration cost, and a tiered recommendation; produces a comparison + recommendation brief and writes no code."
disable-model-invocation: true
---

# LIBRARY EVAL — Should We Adopt X? A-vs-B-vs-Build, Grounded

**Invoked as `/researcher:library-eval`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the research-integrity & egress model, operating model, interaction protocol, safety rails, evidence/citation discipline, hand-off map, and quality lenses this skill references by section.
**Mode:** REVIEW · **Produces:** a comparison + recommendation brief (`LIBRARY_EVAL.md`, the documentation standard of `§13`), plus an `EGRESS_MANIFEST.md` if any web source was used.

Answer an adoption question — *"should we use X, and is it better than Y or than building it ourselves?"* — as a verdict a senior engineer can act on: the real capabilities of each candidate (verified against the version, not memory), how each fits **our** code and constraints, the migration cost, and a tiered recommendation with trade-offs and the smallest adoption slice. Evaluate and recommend only; this skill **never edits code** and hands the decision off (`§11`).

## Phase 0 — Frame the decision, candidates & criteria  *(checkpoint — egress is opt-in)*
Pin down what is actually being decided: the **need** (the capability or problem the candidate would serve), the **candidates** (A vs. B vs. … and, when honest, *build-it-ourselves* and *do-nothing/keep-the-status-quo* as named options), and the **decision criteria** that matter here — not a generic checklist. Derive an initial draft of those criteria from the question and the stack you can already see locally. Establish the local grounding sources first (`§2`): the codebase, version-control history, and installed-dependency docs via `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (or the `code-ops-docs` MCP when `code-ops-suite` is installed) — these need no egress. Identify which candidates are **installed** (evaluable locally) and which would require **web** retrieval.
> **CHECKPOINT:** present the framed decision — need, the full candidate set (including build and status-quo), the weighted criteria, and which candidates can be assessed locally vs. need the web. Confirm scope. **Then, before any network egress (`§A`, `§3`):** name each external host/URL you would fetch and why, and get explicit opt-in. Approved web requests are recorded with `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record ...` (time · tool · host · url · why). Proceed locally while the egress decision is pending.

## Phase 1 — Ground in our code (requirements & constraints)
Before judging any candidate, derive *our* truth from the code, citing `file:line` and tiering each claim (`§7`). What concrete requirements must the candidate meet — the call sites, data shapes, hot paths, and contracts it would touch? What **constraints** bound the choice: the runtime/language/version, existing peer dependencies and their bounds, the build/packaging story, performance budgets, the deployment target, and — critically for this suite — the **privacy/egress posture** (does a candidate phone home, bundle telemetry, or open a new outbound path?). Capture any incumbent the candidate would replace, and how deeply it is wired in (the seam where a migration would land). This grounded requirements set is the rubric every candidate is scored against; an ungrounded criterion is SPECULATIVE (`§A`).

## Phase 2 — Gather each candidate's real capabilities  *(verify against the version, not memory)*
For each candidate, establish what it *actually* does — never assert from training memory (`§10` source-quality):
- **Installed candidates:** read the **installed version's** docs/types/source via `lib-docs` (or `current-docs` when available) — primary, zero-egress, and version-accurate. Cite the installed version, not "latest."
- **Not-yet-installed / web-only candidates:** only after the Phase 0 opt-in, compose the `deep-research` skill (fan-out search → fetch → adversarial verify) to gather the candidate's own primary docs, repository, release notes, and license. **Record every external request** in the manifest as you go (`§A`). Triangulate — prefer the project's own primary docs/spec over secondary write-ups; two independent secondaries beat one (`§7`).
- For **build-it-ourselves**, scope the minimal home-grown implementation against the Phase 1 requirements — what we would own, test, and maintain.

Pin each capability claim to its source (installed-doc reference, or external source + its manifest entry) and tier it. Mark anything you cannot verify against the actual version `UNVERIFIED` rather than guessing (`§4`).

## Phase 3 — Score against the criteria + disconfirm
Score every candidate against the Phase 1 criteria, then run the disconfirmation pass (`§A`) so the recommendation survives scrutiny. Weight by value × reach ÷ effort, adjusted for confidence/grounding (`§8`). Cover the dimensions that sink real adoptions, each cited and tiered:
- **Fit & coverage** — does it meet *our* grounded requirements, or only the generic case? Note the gaps it leaves and the glue we'd still write.
- **Maintenance health** — release cadence, open-issue/PR signal, bus factor, last-release recency (from the candidate's own repository, recorded if external).
- **License** — compatibility with ours and our distribution; flag copyleft/attribution/field-of-use terms as a developer decision.
- **Supply-chain & egress trust** — transitive-dependency weight, install scripts, maintainer/provenance signals, and any telemetry or new outbound path. For anything touching this suite's trust surface, hand the deep check to `privacy-opsec-suite:supply-chain-trust` rather than asserting it here.
- **Migration cost** — the concrete work to wire it into the seam from Phase 1: code churn at the call sites, data/contract migration, test changes, and rollout/rollback. State the smallest adoption slice (one module behind a seam) before any wholesale switch.
- **Lock-in & reversibility** — how hard to back out later; proprietary formats, one-way doors, ecosystem capture.

Drop or re-tier any candidate or claim that doesn't survive: already effectively solved by what we have, incompatible with a hard constraint, or superseded (`§A`).

## Phase 4 — Recommendation with trade-offs + smallest slice
Synthesize the brief (`§13`): lead with the **recommendation in one paragraph** (which option, the decisive trade-off, and the overall tier — CONFIRMED / PROBABLE / SPECULATIVE), then a side-by-side **comparison table** of candidates against the weighted criteria, the **grounded fit** to our code, the **migration cost** and **smallest adoption slice** (the lowest-risk first step that proves the choice), the runner-up and *why not*, the **risks/trade-offs accepted**, and open questions. Every sentence cited and tiered (`§7`); honest about confidence; freshness-stamped with the SHA evaluated against (`§12`, `§13`). The brief is "done" only when its reader could act without re-researching (`§11`).

## Hand-off (researcher proposes; others implement)
Map the verdict to its implementers (`§11`) — never edit code here: capture the decision and its rejected alternatives with `code-ops-suite:adr`; execute the adoption/migration (and any version bump it implies) with `code-ops-suite:dependency-upgrade`; route a flagged trust/egress concern to `privacy-opsec-suite:supply-chain-trust`. State the hand-off target explicitly in the brief.

## Done when
The decision is framed and the full candidate set (including build and status-quo) and weighted criteria are confirmed; requirements and constraints are grounded in our code with `file:line` citations; each candidate's capabilities are verified against the **installed/actual version**, not memory, every claim cited and tiered; the egress checkpoint was honored, every external request recorded via `research-manifest.mjs`, and the brief validated with `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate LIBRARY_EVAL.md` (no un-manifested web citation) before publishing; the disconfirmation pass ran across fit, maintenance, license, supply-chain, migration cost, and lock-in; the brief leads with a tiered recommendation, a comparison, the smallest adoption slice, and explicit hand-off to `code-ops-suite:adr` and `code-ops-suite:dependency-upgrade`; SHA-stamped; no code changed. Present the recommendation paragraph first.
