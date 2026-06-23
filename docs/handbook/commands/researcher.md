# Command Reference — `researcher`

The `researcher` plugin is the marketplace's **proposal layer**: code-grounded research that proposes — registers, design briefs, and adoption verdicts — then hands the implementation to the other three plugins. It never edits source. Its stance is local-first, cited, and disconfirmed: default sources are your codebase, version-control history, installed-dependency docs (via `lib-docs.mjs`, or the `code-ops-docs` MCP `get-docs` when `code-ops-suite` is installed), and the materials you hand it; **web/external retrieval is explicit opt-in per run**, recorded in `EGRESS_MANIFEST.md`, and surfaced at every checkpoint (`plugins/researcher/CONVENTIONS.md` §A). Every claim names a source and a tier — CONFIRMED / PROBABLE / SPECULATIVE — and a claim with no source is not reported (§7). The plugin ships seven skills; all are manual-invoke (`disable-model-invocation: true`) — they will not auto-fire.

This page gives one entry per skill, grouped discovery → review → orchestrator, with the orchestrator last. For the cross-plugin mental model see [`../02-mental-model.md`](../02-mental-model.md); for how the registers stay fresh see [`../04-registers-and-freshness.md`](../04-registers-and-freshness.md); for the evidence tiers and the disconfirmation pass see [`../05-evidence-and-tiers.md`](../05-evidence-and-tiers.md). The full task → command router is in [`README.md`](README.md).

## Index

Discover & propose (Mode: DISCOVERY — produces registers/briefs, never code):
- [`/researcher:research-spike`](#researcherresearch-spike) — a cited design brief for a named task or plan.
- [`/researcher:research-improve`](#researcherresearch-improve) — grounded, external-best-practice improvements for existing code.
- [`/researcher:research-ideate`](#researcherresearch-ideate) — net-new, honestly-novel feature and direction ideas.
- [`/researcher:ecosystem-watch`](#researcherecosystem-watch) — what changed in your stack to act on; schedulable.

Verify & evaluate (Mode: REVIEW — produces a verdict, never code):
- [`/researcher:research-verify`](#researcherresearch-verify) — adversarial per-claim fact-check that gates the other skills.
- [`/researcher:library-eval`](#researcherlibrary-eval) — "adopt X?" A-vs-B-vs-build with a tiered recommendation.

Orchestrator:
- [`/researcher:research-sweep`](#researcherresearch-sweep) — run the whole pipeline end-to-end (ground → gather → verify → propose).

---

## Discover & propose

### `/researcher:research-spike`
**Mode:** DISCOVERY

**How it works.** Five phases (0–4) with two checkpoints. Phase 0 restates the question in one sentence, pins the decision the brief must enable, drafts success criteria and a disconfirmation list, and **confirms whether web egress is permitted** (default local-only). Phase 1 grounds in your code (local, no egress): stack, modules, data, integration points, version-control history, latent capabilities, and hard edges — each observation cited at `file:line` and tiered. Phase 2 gathers credible options and prior art (including *build it ourselves* and *use a capability we already have*), local-first via `lib-docs.mjs`; the opt-in web leg composes the `deep-research` skill and records every request with `research-manifest.mjs record`. Phase 3 composes `research-verify` to harden the load-bearing claims and re-runs disconfirmation against the front-runner. Phase 4 (checkpoint) synthesizes the brief to the §13 documentation standard — summary-first recommendation, scored options, grounded fit, smallest valuable slice, risks, open questions, a Mermaid diagram where it clarifies — and before publishing runs `research-manifest.mjs validate <brief>` (fail-closed) and `revalidate-register.mjs` on any carried register. **Produces** a cited design brief plus `EGRESS_MANIFEST.md`.

**Why it's useful.** It turns "how should we build this?" into a brief a senior engineer can implement without re-researching — options weighed against your real constraints, the load-bearing facts verified, and an explicit recommendation with the smallest slice that proves it.

**When to use it.** Before building anything where the approach is genuinely open and the wrong call is expensive — a new subsystem, a refactor with several plausible shapes, a "build vs. integrate" fork. Reach for `library-eval` instead when the question is specifically *which dependency to adopt* (A-vs-B-vs-build with migration cost), and for `research-ideate` when you do not yet have a task — you are looking for *what* to build, not *how*. Do not use it to make the change; it proposes and hands off.

**Prerequisites & hand-offs.** Requires only the `researcher` plugin; `lib-docs.mjs` is bundled and the `code-ops-docs` MCP is used if `code-ops-suite` is installed. The opt-in web leg composes `deep-research`. The brief hands off to `code-ops-suite:feature-implementation` or `code-ops-suite:ship` (the build), `code-ops-suite:adr` (an architectural decision worth recording), and a writing-plans step when the work needs a step-by-step plan first.

### `/researcher:research-improve`
**Mode:** DISCOVERY

**How it works.** Five phases (0–4) with two checkpoints. Phase 0 (egress gate) pins the target modules/concern and the constraints, inventories local sources, and decides whether web research is even needed — default local-only. Phase 1 grounds the relevant code: structure, seams, the *current* approach (which library APIs you use and how), git history, exact **installed** dependency versions, existing tests, and blast radius; anything not grounded stays `UNVERIFIED`. Phase 2 gathers external knowledge cheapest-and-most-local first — installed-dependency capabilities via `lib-docs.mjs` (zero query egress), established patterns and documented pitfalls, then the opt-in `deep-research` web leg with every request recorded via `research-manifest.mjs record`. Phase 3 (checkpoint) runs each candidate through the disconfirmation pass (applies here? already done? compatible? worth it?) and adversarially gates survivors with `research-verify`. Phase 4 writes each survivor to `RESEARCH_FINDINGS.md` as an `RSCH-NNN` entry on the §6 schema, assigns a track (NOW-SAFE / NEEDS-REVIEW / NEEDS-DESIGN), and ranks by value × reach ÷ effort. Before publishing it runs `revalidate-register.mjs RESEARCH_FINDINGS.md --root .` and `research-manifest.mjs validate RESEARCH_FINDINGS.md`. **Produces** `RESEARCH_FINDINGS.md`, `EGRESS_MANIFEST.md` (if web was approved), and `EXECUTIVE_SUMMARY.md`.

**Why it's useful.** It asks the outside world how your existing code is done well — and proves each improvement applies *here* before it reaches the register — instead of dumping a generic best-practices checklist. Findings are tiered, cited at a seam, and carry a smallest slice and a hand-off target.

**When to use it.** When you have working code and want grounded improvements (correctness, robustness, idiomatic dependency use, maintainability) drawn from external practice. A measured performance claim is explicitly out of scope — it hands that to `rigor:improve-measured` rather than asserting a speedup. Choose `research-ideate` instead for net-new features rather than improving what exists.

**Prerequisites & hand-offs.** Requires only `researcher`; the web leg composes `deep-research`. Each `RSCH-NNN` names its implementer: improvements → `code-ops-suite:remediation` or `rigor:fix-verified`; broad behavior-preserving measured wins → `rigor:improve-measured`; an architectural rework → NEEDS-DESIGN for `code-ops-suite:adr`. The register is consumed by those skills; it is never edited into code by the researcher.

### `/researcher:research-ideate`
**Mode:** DISCOVERY

**How it works.** Five phases (0–4) with three checkpoints. Phase 0 (local only) reads the product — feature set, user flows, target users, intent signals — frames the ideation (domain, user, appetite, what "net-new" means *here*), and states the egress decision explicitly. Phase 1 (local, cite everything `file:line`) establishes the floor: current capabilities, **latent assets** (data, services, infrastructure already owned), and constraints including the privacy/egress posture. Phase 2 fans out across inspiration lenses local-first — dependency capabilities via `lib-docs.mjs`, prior art in provided materials, and (opt-in only) adjacent products and ecosystem trends via the `deep-research` skill with every request recorded; the phase ends by surfacing the manifest. Phase 3 composes `research-verify` and runs the disconfirmation pass on every candidate (actually new here? feasible here? worth it? endangers the egress/privacy posture?). Phase 4 (checkpoint) writes each survivor to `IDEAS_REGISTER.md` as an `IDEA-NNN` entry, ranks by value × reach ÷ effort, tags quick wins vs. big bets, and pre-filters with `revalidate-register.mjs` / validates with `research-manifest.mjs validate IDEAS_REGISTER.md`. **Produces** `IDEAS_REGISTER.md`, `EGRESS_MANIFEST.md` (if web egress occurred), and `EXECUTIVE_SUMMARY.md`.

**Why it's useful.** It is the discovery skill that looks *beyond* the repo — turning prior art, adjacent products, and ecosystem trends into feature ideas that fit your code, with honest novelty (not cargo-cult), feasibility, and a smallest slice for each.

**When to use it.** When you want new directions and do not yet have a task or a problem statement. This is the explicit disambiguation from `code-ops-suite:feature-discovery`, which mines the codebase *alone* for latent opportunity; `research-ideate` asks "what is the world doing that we could do *here*?" and brings the outside view. Once you know *what* to build and need to decide *how*, move to `research-spike`.

**Prerequisites & hand-offs.** Requires only `researcher`; the web leg composes `deep-research`. Each `IDEA-NNN` hands off to `code-ops-suite:feature-discovery` (to spec it into the product backlog) or `code-ops-suite:feature-implementation` (to build a scoped slice); a direction with real architectural trade-offs routes to `code-ops-suite:adr`.

### `/researcher:ecosystem-watch`
**Mode:** DISCOVERY

**How it works.** Five phases (0–4) with two checkpoints, designed to run on a cadence. Phase 0 detects the ecosystem(s) — package managers, lockfiles, runtime pins, base images, CI toolchain, platform SDKs — reads the **prior `ECOSYSTEM_WATCH.md`** so the run is a diff not a restart, frames scope (dependency tiers · change classes · since-when), and gets the egress opt-in (change-gathering generally needs the web). Phase 1 (local-first, no egress) builds the "what we run" baseline: installed/locked versions from the lockfile, confirmed in-use by tracing imports at `file:line`, plus each dep's installed surface and stated deprecation notices via `lib-docs.mjs`. Phase 2 (opt-in web, every request recorded) composes `deep-research` to gather new releases, CVEs/advisories with affected ranges, deprecations/EOL dates, and newly-available capabilities — primary sources preferred. Phase 3 composes `research-verify` and triages each change against the baseline (does the affected range include our version? do we call the API? already mitigated? reachable CVE or theoretical?), discarding noise that doesn't touch you. Phase 4 (checkpoint) writes survivors to `ECOSYSTEM_WATCH.md` as `RSCH-NNN` entries ranked security-first, then runs `revalidate-register.mjs` and `research-manifest.mjs validate`. **Produces** `ECOSYSTEM_WATCH.md`, `EGRESS_MANIFEST.md`, and `EXECUTIVE_SUMMARY.md`.

**Why it's useful.** It filters the firehose of ecosystem churn down to the small, ranked set that actually touches code you run — a CVE in a version you ship and an API you call, not generic advisory noise. That filtering is the value.

**When to use it.** On a recurring schedule to stay ahead of dependency updates, CVEs, deprecations, and newly-available capabilities. Each scheduled run diffs against the last register's `Verified-at` SHA and surfaces only what is new and reachable. Put it on a Routine (`/schedule`); it still honors §A — it operates within a pre-agreed egress scope and stops at a checkpoint rather than widening egress unattended.

**Prerequisites & hand-offs.** Requires only `researcher`; the web leg composes `deep-research`. Each entry maps to an implementer: security CVEs and routine/major upgrades → `code-ops-suite:dependency-upgrade`; egress/telemetry/provenance/integrity concerns → `privacy-opsec-suite:supply-chain-trust`; a newly-available capability worth adopting → `code-ops-suite:feature-discovery` / `feature-implementation`; an EOL-forced migration → `code-ops-suite:adr`. The researcher hands off; it does not perform the upgrades.

---

## Verify & evaluate

### `/researcher:research-verify`
**Mode:** REVIEW

**How it works.** Five phases (0–4). Phase 0 (checkpoint) restates each claim as a single falsifiable sentence (compound claims are split), captures its stated tier, sources, and the action it would unblock, pins the SHA, and — if the input is a draft artifact — runs `research-manifest.mjs validate <artifact>` immediately; any external claim without a manifest entry is **undisclosed egress**, recorded as a finding that fails intake. Phase 1 ground-checks every claim against your code (does this hold *for us*, given our version, wrappers, guards, constraints?). Phase 2 source-checks against the **installed** version via `lib-docs.mjs` — not memory — separating primary from secondary sources and triangulating to set the tier; a web source-check composes `deep-research` and records every request. Phase 3 is adversarial disconfirmation: construct the counter-example, the edge case, the unrun benchmark; an unmeasured perf/security claim cannot exceed SPECULATIVE. Phase 4 issues one verdict per claim — **SUPPORTED / PARTIAL / UNSUPPORTED** — each tiered, stamped `Verified-at: <sha>`, with hand-off targets, leading with the gate decision (clear / clear-with-changes / blocked). **Produces** a per-claim verdict report; it edits neither the artifact nor the code.

**Why it's useful.** It is the rigor "prove-it-or-don't" lens turned on research itself: a claim survives only if it holds against your code and primary sources, never against recollection. It catches the hallucinated capability, the number with no provenance, the "best practice" that is already done or incompatible.

**When to use it.** Before anyone acts on a claim, recommendation, or draft research artifact (a brief, a `RESEARCH_FINDINGS.md` / `IDEAS_REGISTER.md` entry, or a bare "we should adopt X because Y"). It is the **gate** the other researcher skills compose internally before hand-off, and is **not optional** inside `research-sweep`. Use it standalone whenever you have a load-bearing claim whose cost-of-wrong is high.

**Prerequisites & hand-offs.** Requires only `researcher`; the web leg composes `deep-research`. Corrections route back to the originating researcher skill (`research-spike` / `research-improve` / `research-ideate` / `library-eval`); code issues it uncovers go to `code-ops-suite:remediation` or `rigor:fix-verified`; a measurement gap goes to `rigor:improve-measured`.

### `/researcher:library-eval`
**Mode:** REVIEW

**How it works.** Five phases (0–4) with one egress checkpoint. Phase 0 frames the decision — the need, the full candidate set (A vs. B vs. … and, honestly, *build-it-ourselves* and *do-nothing/status-quo* as named options), and the weighted decision criteria — and establishes local grounding sources. Phase 1 derives *your* truth from code at `file:line`: the concrete requirements (call sites, data shapes, hot paths, contracts) and the constraints (runtime/version, peer deps, build story, perf budgets, deployment target, and the privacy/egress posture — does a candidate phone home?). Phase 2 gathers each candidate's *real* capabilities against the **installed** version via `lib-docs.mjs` for installed candidates, the opt-in `deep-research` leg for web-only ones (every request recorded), and a scoped minimal implementation for build-it-ourselves. Phase 3 scores against the criteria and disconfirms across the dimensions that sink real adoptions — fit & coverage, maintenance health, license, supply-chain & egress trust, migration cost, lock-in & reversibility. Phase 4 synthesizes the brief: a one-paragraph tiered recommendation, a side-by-side comparison table, grounded fit, migration cost and smallest adoption slice, the runner-up and *why not*, risks, and open questions; validated with `research-manifest.mjs validate LIBRARY_EVAL.md` before publishing. **Produces** `LIBRARY_EVAL.md` plus `EGRESS_MANIFEST.md` if any web source was used.

**Why it's useful.** It answers "should we adopt X?" as a verdict a senior engineer can act on — real capabilities verified against the actual version, fit and migration cost grounded in your seam, and a defensible recommendation with the lowest-risk first step.

**When to use it.** For any adopt/replace/build decision about a library or approach. Use `research-spike` instead when the question is *how to build* something rather than *which dependency to pick*; use `ecosystem-watch` when the trigger is a change in a dependency you already run. For a deep trust check of a candidate's supply chain, it hands off rather than asserting.

**Prerequisites & hand-offs.** Requires only `researcher`; the web leg composes `deep-research`. The verdict hands off to `code-ops-suite:adr` (record the decision and rejected alternatives) and `code-ops-suite:dependency-upgrade` (execute the adoption/migration and any version bump); a flagged trust/egress concern routes to `privacy-opsec-suite:supply-chain-trust`.

---

## Orchestrator

### `/researcher:research-sweep`
**Mode:** orchestrator (DISCOVERY + REVIEW; never DOCUMENT-only)

**How it works.** Six phases (0–5), pausing at every phase boundary and **surfacing `EGRESS_MANIFEST.md` at each checkpoint**. It orchestrates the researcher's *own* skills in sequence — it does not replace them. Phase 0 scopes the run, records the HEAD `<sha>`, confirms which modes run and in what order (default: ground → improve + ideate → verify → propose), and gets the egress permission and scope (`research-verify` is never optional). Phase 1 grounds in your code (local, zero egress), verifying library facts against installed versions via `lib-docs.mjs`. Phase 2 (checkpoint, surfaces the manifest) runs the selected discovery skills — `research-improve`, `research-ideate`, `library-eval`, `research-spike`, `ecosystem-watch` — collecting entries into `RESEARCH_FINDINGS.md` and `IDEAS_REGISTER.md`, each stamped `Verified-at: <sha>`. Phase 3 runs `research-verify` over every load-bearing claim, re-tiers on evidence, and re-validates registers with `revalidate-register.mjs` before they cross the boundary. Phase 4 ranks survivors and maps each to its implementer. Phase 5 consolidates one `EXECUTIVE_SUMMARY.md` (CONFIRMED separated from PROBABLE/SPECULATIVE) and validates the egress discipline fail-closed with `research-manifest.mjs validate <artifact>` for every register, brief, and the summary. **Produces** the consolidated `RESEARCH_FINDINGS.md`, `IDEAS_REGISTER.md`, per-spike design briefs, `EGRESS_MANIFEST.md`, and a single `EXECUTIVE_SUMMARY.md`.

**Why it's useful.** It runs the full research pipeline as one developer-in-the-loop pass — carrying the shared registers forward fresh, keeping a master plan, and keeping the egress posture visible at every boundary — instead of you stitching the six skills together by hand.

**When to use it.** When you want a broad, end-to-end research pass over a question or area rather than a single targeted skill. This is the **intra-plugin** orchestrator: it composes the researcher's own skills. For a **cross-plugin** pass that strings together orchestrators across the marketplace (code-ops breadth, rigor verification, the privacy track), use `code-ops-suite:everything` instead; `research-sweep` is the research leg that feeds it. Reach for a single skill (e.g. `research-improve` alone) when the scope is narrow and you do not need the whole pipeline.

**Prerequisites & hand-offs.** Requires nothing beyond the `researcher` plugin; `lib-docs.mjs` is bundled and the opt-in web leg runs only through the composed `deep-research` skill behind a checkpoint. It composes `code-ops-suite` / `rigor` / `privacy-opsec-suite` skills only when installed, for hand-off (§11): improvements → `code-ops-suite:remediation` / `rigor:fix-verified`; features/ideas → `code-ops-suite:feature-discovery` / `feature-implementation` / `ship`; an adopt/replace or load-bearing design choice → `code-ops-suite:adr`; measured performance → `rigor:improve-measured`; dependency/CVE actions → `code-ops-suite:dependency-upgrade` / `privacy-opsec-suite:supply-chain-trust`. It never edits code.

---

*Verified-at: c2b37e9*
