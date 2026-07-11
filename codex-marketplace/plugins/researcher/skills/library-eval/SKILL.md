---
name: library-eval
description: "Use when you must decide whether to adopt a library or approach (A-vs-B-vs-build) and want a code-grounded fit assessment, migration cost, and a tiered recommendation; writes no code."
---

# LIBRARY EVAL — Should We Adopt X? A-vs-B-vs-Build, Grounded

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `researcher:library-eval`.** First read the bundled `<plugin-root>/CONVENTIONS.md` — the research-integrity & egress model (`§A`), protocol, rails, evidence/citation discipline, hand-off map, and lenses, referenced by section.
**Mode:** REVIEW · **Produces:** a comparison + recommendation brief (`LIBRARY_EVAL.md`, per the `§13` documentation standard) plus `EGRESS_MANIFEST.md` if any web source was used. Capabilities are verified against the version, not memory; **never edits code** — evaluates, recommends, hands off (`§11`).

## Phase 0 — Frame the decision  *(checkpoint — egress is opt-in)*
Pin the **need**, the **candidates** (A vs. B vs. …, plus *build-it-ourselves* and *do-nothing/status-quo* as named options when honest), and the weighted **decision criteria** for this repo — not a generic checklist. Local grounding sources first (`§2`): codebase, VCS history, installed-dependency docs via `<plugin-root>/scripts/lib-docs.mjs` (or the `code-ops-docs` MCP when `code-ops-suite` is installed) — no egress. Mark candidates **installed** (evaluable locally) vs. **web-only**.
> **CHECKPOINT:** present need, full candidate set (including build and status-quo), weighted criteria, local-vs-web split; confirm scope. **Before any network egress (`§A`, `§3`):** name each external host/URL and why; get explicit opt-in. Approved web requests are recorded with `node <plugin-root>/scripts/research-manifest.mjs record ...` (time · tool · host · url · why). Proceed locally while the decision is pending.

## Phase 1 — Ground in our code (requirements & constraints)
Derive *our* truth first, citing `file:line`, tiering each claim (`§7`): **requirements** (call sites, data shapes, hot paths, contracts touched) and **constraints** — runtime/language/version, peer-dependency bounds, build/packaging, performance budgets, deployment target, and the **privacy/egress posture** (phones home? bundles telemetry? opens a new outbound path?). Capture any incumbent it would replace and the migration seam. An ungrounded criterion is SPECULATIVE (`§A`).

## Phase 2 — Gather real capabilities  *(verify against the version, not memory)*
Never assert from training memory (`§10` source-quality):
- **Installed candidates:** read the **installed version's** docs/types/source via `lib-docs` (or `current-docs` when available) — primary, zero-egress; cite the installed version, not "latest."
- **Web-only candidates:** only after the Phase 0 opt-in, compose the `deep-research` skill (fan-out search → fetch → adversarial verify) for primary docs, repository, release notes, license. **Record every external request** in the manifest as you go (`§A`). Triangulate — primary over secondary; two independent secondaries beat one (`§7`).
- **Build-it-ourselves:** scope the minimal implementation against Phase 1 — what we would own, test, maintain.

Pin each capability claim to its source (installed-doc, or external + manifest entry) and tier it; anything unverifiable against the actual version is `UNVERIFIED`, never guessed (`§4`).

## Phase 3 — Score + disconfirm
Score every candidate, then the disconfirmation pass (`§A`); weight by value × reach ÷ effort, adjusted for confidence/grounding (`§8`). Cover, cited and tiered: **fit & coverage** (our grounded requirements vs. the generic case; gaps and glue left to us) · **maintenance health** (release cadence, issue/PR signal, bus factor, recency — from its own repository, recorded if external) · **license** (compatibility with ours and our distribution; copyleft/attribution/field-of-use terms are a developer decision) · **supply-chain & egress trust** (transitive weight, install scripts, provenance, telemetry or new outbound paths; deep checks → `privacy-opsec-suite:supply-chain-trust`, not asserted here) · **migration cost** (call-site churn, data/contract migration, test changes, rollout/rollback; smallest adoption slice — one module behind a seam — before any wholesale switch) · **lock-in & reversibility** (proprietary formats, one-way doors, ecosystem capture). Drop or re-tier what doesn't survive: already solved here, incompatible with a hard constraint, or superseded (`§A`).

## Phase 4 — Recommendation with trade-offs + smallest slice
Write the brief (`§13`): lead with the **recommendation in one paragraph** (which option, the decisive trade-off, overall tier CONFIRMED / PROBABLE / SPECULATIVE); then the **comparison table** against the weighted criteria, **grounded fit**, **migration cost** + **smallest adoption slice**, the runner-up and *why not*, **risks/trade-offs accepted**, open questions. Every sentence cited and tiered (`§7`); freshness-stamped with the SHA evaluated against (`§12`, `§13`); done only when the reader could act without re-researching (`§11`).

## Hand-off (researcher proposes; others implement)
Never edit code here (`§11`): decision + rejected alternatives → `code-ops-suite:adr`; adoption/migration and any version bump → `code-ops-suite:dependency-upgrade`; flagged trust/egress concerns → `privacy-opsec-suite:supply-chain-trust`. State the hand-off target explicitly in the brief.

## Done when
Decision framed, full candidate set (including build and status-quo) and weighted criteria confirmed; requirements/constraints grounded with `file:line` citations; capabilities verified against the **installed/actual version**, every claim cited and tiered; egress checkpoint honored, every external request recorded via `research-manifest.mjs`, and the brief validated with `node <plugin-root>/scripts/research-manifest.mjs validate LIBRARY_EVAL.md` (no un-manifested web citation) before publishing; disconfirmation ran across fit, maintenance, license, supply-chain, migration cost, and lock-in; the brief leads with a tiered recommendation, a comparison, the smallest adoption slice, and explicit hand-off to `code-ops-suite:adr` and `code-ops-suite:dependency-upgrade`; SHA-stamped; no code changed. Present the recommendation paragraph first.
