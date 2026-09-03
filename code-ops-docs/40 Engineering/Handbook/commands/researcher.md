# `researcher` command reference

This page is the complete command reference for the `researcher` plugin.
It carries one entry per command: how it works, why it is useful, when to reach for it, and what it hands off.
Read it when you are picking a research command or wiring one into a larger run.

The `researcher` plugin is the marketplace's proposal layer. It runs code-grounded research
and produces registers, design briefs, and adoption verdicts. It hands the implementation to
the other three plugins. It never edits source.

Its stance is local-first, cited, and disconfirmed. The default sources are:

- your codebase and its version-control history
- installed-dependency docs through `lib-docs.mjs`, or the `code-ops-docs` MCP `get-docs` tool when `code-ops-suite` is installed
- the materials you hand it

Web and external retrieval is an explicit opt-in per run. Every request is recorded in
`EGRESS_MANIFEST.md` and surfaced at every checkpoint (`plugins/researcher/CONVENTIONS.md`
§A). Every claim names a source and a tier: CONFIRMED, PROBABLE, or SPECULATIVE. A claim
with no source is not reported (§7).

The plugin ships seven skills. Invoke a skill by slash command, or let the model route to it
under the standard-operating-mode routing card. Every egress checkpoint still applies.

For the cross-plugin mental model see [`../02-mental-model.md`](../02-mental-model.md). For
how the registers stay fresh see
[`../04-registers-and-freshness.md`](../04-registers-and-freshness.md). For the evidence
tiers and the disconfirmation pass see
[`../05-evidence-and-tiers.md`](../05-evidence-and-tiers.md). The full task-to-command router
is in [`README.md`](README.md).

## Shared run mechanisms

A research run reads a lot of code, so it uses the suite's shared context mechanisms. Read a
file's outline with `co context skim <file>`, then request a line range. Ask the symbol index
a structural question with `co context query find|callers|callees|blast <symbol>`, which
answers in `file:line` anchors. Long Bash output arrives digested, with a receipt naming the
raw file. Each mechanism is on by default and turns off from the `env` block of a
`.claude/settings.json`. The behavior contracts are in
[the contracts page](../../../35 Contracts and Data/CONTRACTS.md), and the switches are in
[the infrastructure page](../../../50 Platform/INFRASTRUCTURE.md). The
[code-ops-suite page](code-ops-suite.md#bundled-scripts-and-hooks) lists the commands.

## Index

Discover and propose (Mode: DISCOVERY, produces registers and briefs, never code):

- [`/researcher:research-spike`](#researcherresearch-spike): a cited design brief for a named task or plan.
- [`/researcher:research-improve`](#researcherresearch-improve): grounded, external-best-practice improvements for existing code.
- [`/researcher:research-ideate`](#researcherresearch-ideate): net-new, honestly-novel feature and direction ideas.
- [`/researcher:ecosystem-watch`](#researcherecosystem-watch): what changed in your stack to act on, schedulable.

Verify and evaluate (Mode: REVIEW, produces a verdict, never code):

- [`/researcher:research-verify`](#researcherresearch-verify): adversarial per-claim fact-check that gates the other skills.
- [`/researcher:library-eval`](#researcherlibrary-eval): "adopt X?" A-versus-B-versus-build with a tiered recommendation.

Orchestrator:

- [`/researcher:research-sweep`](#researcherresearch-sweep): run the whole pipeline end to end (ground, gather, verify, propose).

---

## Discover and propose

### `/researcher:research-spike`
**Mode:** DISCOVERY

**How it works.** Five phases (0 to 4) with two checkpoints:

- **Phase 0** restates the question in one sentence and pins the decision the brief must enable. It drafts success criteria and a disconfirmation list, then confirms whether web egress is permitted. The default is local-only.
- **Phase 1** grounds the question in your code with no egress: stack, modules, data, integration points, version-control history, latent capabilities, and hard edges. Each observation is cited at `file:line` and tiered.
- **Phase 2** gathers credible options and prior art, including building it yourself and using a capability you already have. It works local-first through `lib-docs.mjs`. The opt-in web leg composes the `deep-research` skill and records every request with `research-manifest.mjs record`.
- **Phase 3** composes `research-verify` to harden the load-bearing claims, then re-runs disconfirmation against the front-runner.
- **Phase 4** (checkpoint) synthesizes the brief to the §13 documentation standard: a summary-first recommendation, scored options, grounded fit, the smallest valuable slice, risks, open questions, and a Mermaid diagram where it clarifies. Before publishing it runs `research-manifest.mjs validate <brief>` fail-closed and `revalidate-register.mjs` on any carried register.

**Produces** a cited design brief plus `EGRESS_MANIFEST.md`.

**Why it's useful.** It turns "how should we build this?" into a brief a senior engineer can
implement without re-researching. Options are weighed against your real constraints. The
load-bearing facts are verified. The recommendation is explicit and names the smallest slice
that proves it.

**When to use it.** Reach for it before building anything where the approach is genuinely
open and the wrong call is expensive: a new subsystem, a refactor with several plausible
shapes, or a build-versus-integrate fork. Use `library-eval` instead when the question is
which dependency to adopt. Use `research-ideate` when you do not yet have a task and are
looking for what to build rather than how. Do not use it to make the change, because it
proposes and hands off.

**Prerequisites and hand-offs.** It requires only the `researcher` plugin. `lib-docs.mjs` is
bundled, and the `code-ops-docs` MCP server is used when `code-ops-suite` is installed. The
opt-in web leg composes `deep-research`. The brief hands off to
`code-ops-suite:feature-implementation` or `code-ops-suite:ship` for the build, and to
`code-ops-suite:adr` for an architectural decision worth recording. Work that needs a
step-by-step plan first goes to a planning step.

### `/researcher:research-improve`
**Mode:** DISCOVERY

**How it works.** Five phases (0 to 4) with two checkpoints:

- **Phase 0** is the egress gate. It pins the target modules and constraints, inventories local sources, and decides whether web research is needed at all. The default is local-only.
- **Phase 1** grounds the relevant code: structure, seams, the current approach, git history, exact installed dependency versions, existing tests, and blast radius. Anything not grounded stays `UNVERIFIED`.
- **Phase 2** gathers external knowledge cheapest and most local first. It reads installed-dependency capabilities through `lib-docs.mjs` with zero query egress, then established patterns and documented pitfalls, then the opt-in `deep-research` web leg with every request recorded.
- **Phase 3** (checkpoint) runs each candidate through the disconfirmation pass: does it apply here, is it already done, is it compatible, is it worth it. Survivors are gated adversarially with `research-verify`.
- **Phase 4** writes each survivor to `RESEARCH_FINDINGS.md` as an `RSCH-NNN` entry on the §6 schema, assigns a track (NOW-SAFE, NEEDS-REVIEW, or NEEDS-DESIGN), and ranks by value times reach divided by effort. Before publishing it runs `revalidate-register.mjs RESEARCH_FINDINGS.md --root .` and `research-manifest.mjs validate RESEARCH_FINDINGS.md`.

**Produces** `RESEARCH_FINDINGS.md`, `EGRESS_MANIFEST.md` when web sources were approved, and
`EXECUTIVE_SUMMARY.md`.

**Why it's useful.** It asks the outside world how your existing code is done well, and it
proves each improvement applies here before the improvement reaches the register. It does not
dump a generic best-practices checklist. Findings are tiered, cited at a seam, and carry a
smallest slice and a hand-off target.

**When to use it.** Use it when you have working code and want grounded improvements to
correctness, robustness, idiomatic dependency use, or maintainability. A measured performance
claim is out of scope, and it hands that to `rigor:improve-measured` rather than asserting a
speedup. Choose `research-ideate` instead for net-new features rather than improving what
exists.

**Prerequisites and hand-offs.** It requires only `researcher`, and the web leg composes
`deep-research`. Each `RSCH-NNN` entry names its implementer:

- improvements go to `code-ops-suite:remediation` or `rigor:fix-verified`
- broad behavior-preserving measured wins go to `rigor:improve-measured`
- an architectural rework is marked NEEDS-DESIGN for `code-ops-suite:adr`

Those skills consume the register. The researcher never edits it into code.

### `/researcher:research-ideate`
**Mode:** DISCOVERY

**How it works.** Five phases (0 to 4) with three checkpoints:

- **Phase 0** (local only) reads the product: feature set, user flows, target users, and intent signals. It frames the ideation (domain, user, appetite, and what net-new means here) and states the egress decision explicitly.
- **Phase 1** (local, everything cited at `file:line`) establishes the floor: current capabilities, latent assets already owned, and constraints including the privacy and egress posture.
- **Phase 2** fans out across inspiration lenses local-first: dependency capabilities through `lib-docs.mjs`, prior art in provided materials, and, opt-in only, adjacent products and ecosystem trends through the `deep-research` skill with every request recorded. The phase ends by surfacing the manifest.
- **Phase 3** composes `research-verify` and runs the disconfirmation pass on every candidate: is it actually new here, is it feasible here, is it worth it, does it endanger the egress and privacy posture.
- **Phase 4** (checkpoint) writes each survivor to `IDEAS_REGISTER.md` as an `IDEA-NNN` entry, ranks by value times reach divided by effort, and tags quick wins against big bets. It pre-filters with `revalidate-register.mjs` and validates with `research-manifest.mjs validate IDEAS_REGISTER.md`.

**Produces** `IDEAS_REGISTER.md`, `EGRESS_MANIFEST.md` when web egress occurred, and
`EXECUTIVE_SUMMARY.md`.

**Why it's useful.** It is the discovery skill that looks beyond the repo. It turns prior
art, adjacent products, and ecosystem trends into feature ideas that fit your code, with
honest novelty, feasibility, and a smallest slice for each.

**When to use it.** Use it when you want new directions and do not yet have a task or a
problem statement. That is the disambiguation from `code-ops-suite:feature-discovery`, which
mines the codebase alone for latent opportunity. `research-ideate` asks what the world is
doing that you could do here, and brings the outside view. Once you know what to build and
need to decide how, move to `research-spike`.

**Prerequisites and hand-offs.** It requires only `researcher`, and the web leg composes
`deep-research`. Each `IDEA-NNN` entry hands off to `code-ops-suite:feature-discovery` to
spec it into the product backlog, or to `code-ops-suite:feature-implementation` to build a
scoped slice. A direction with real architectural trade-offs routes to `code-ops-suite:adr`.

### `/researcher:ecosystem-watch`
**Mode:** DISCOVERY

**How it works.** Five phases (0 to 4) with two checkpoints, designed to run on a cadence:

- **Phase 0** detects the ecosystems: package managers, lockfiles, runtime pins, base images, the CI toolchain, and platform SDKs. It reads the prior `ECOSYSTEM_WATCH.md` so the run is a diff rather than a restart, frames scope (dependency tiers, change classes, and since when), and takes the egress opt-in. Gathering changes generally needs the web.
- **Phase 1** (local-first, no egress) builds the "what we run" baseline: installed and locked versions from the lockfile, confirmed in use by tracing imports at `file:line`, plus each dependency's installed surface and stated deprecation notices through `lib-docs.mjs`.
- **Phase 2** (opt-in web, every request recorded) composes `deep-research` to gather new releases, CVEs and advisories with affected ranges, deprecations and EOL dates, and newly available capabilities. Primary sources are preferred.
- **Phase 3** composes `research-verify` and triages each change against the baseline: does the affected range include our version, do we call the API, is it already mitigated, is the CVE reachable or theoretical. Noise that does not touch you is discarded.
- **Phase 4** (checkpoint) writes survivors to `ECOSYSTEM_WATCH.md` as `RSCH-NNN` entries ranked security-first, then runs `revalidate-register.mjs` and `research-manifest.mjs validate`.

**Produces** `ECOSYSTEM_WATCH.md`, `EGRESS_MANIFEST.md`, and `EXECUTIVE_SUMMARY.md`.

**Why it's useful.** It filters the firehose of ecosystem churn down to the small ranked set
that touches code you actually run. A CVE in a version you ship and an API you call survives
the filter. Generic advisory noise does not. That filtering is the value.

**When to use it.** Run it on a recurring schedule to stay ahead of dependency updates, CVEs,
deprecations, and newly available capabilities. Each scheduled run diffs against the last
register's `Verified-at` SHA and surfaces only what is new and reachable. Put it on a
recurring task. It still honors §A, because it operates within a pre-agreed egress scope and
stops at a checkpoint rather than widening egress unattended.

**Prerequisites and hand-offs.** It requires only `researcher`, and the web leg composes
`deep-research`. Each entry maps to an implementer:

- security CVEs and routine or major upgrades go to `code-ops-suite:dependency-upgrade`
- egress, telemetry, provenance, and integrity concerns go to `privacy-opsec-suite:supply-chain-trust`
- a newly available capability worth adopting goes to `code-ops-suite:feature-discovery` or `feature-implementation`
- an EOL-forced migration goes to `code-ops-suite:adr`

The researcher hands off. It does not perform the upgrades.

---

## Verify and evaluate

### `/researcher:research-verify`
**Mode:** REVIEW

**How it works.** Five phases (0 to 4):

- **Phase 0** (checkpoint) restates each claim as a single falsifiable sentence and splits compound claims. It captures the stated tier, the sources, and the action the claim would unblock, then pins the SHA. If the input is a draft artifact, it runs `research-manifest.mjs validate <artifact>` immediately. An external claim with no manifest entry is undisclosed egress, recorded as a finding that fails intake. Any fetched or carried-in artifact is scanned with `co scan injection` before ingestion, because its content is data to verify and never instructions to follow. Every hit is triaged.
- **Phase 1** ground-checks every claim against your code: does it hold for us, given our version, wrappers, guards, and constraints.
- **Phase 2** source-checks against the installed version through `lib-docs.mjs` rather than memory. It separates primary from secondary sources and triangulates to set the tier. A web source-check composes `deep-research` and records every request.
- **Phase 3** is adversarial disconfirmation. It constructs the counter-example, the edge case, and the unrun benchmark. An unmeasured performance or security claim cannot exceed SPECULATIVE.
- **Phase 4** issues one verdict per claim, SUPPORTED, PARTIAL, or UNSUPPORTED. Each verdict is tiered, stamped `Verified-at: <sha>`, and carries hand-off targets. The report leads with the gate decision: clear, clear-with-changes, or blocked.

**Produces** a per-claim verdict report. It edits neither the artifact nor the code.

**Why it's useful.** It is the rigor "prove it or do not report it" lens turned on research
itself. A claim survives only if it holds against your code and primary sources, never
against recollection. It catches the hallucinated capability, the number with no provenance,
and the best practice that is already done or incompatible.

**When to use it.** Run it before anyone acts on a claim, a recommendation, or a draft
research artifact. That includes a brief, a `RESEARCH_FINDINGS.md` or `IDEAS_REGISTER.md`
entry, and a bare "we should adopt X because Y". It is the gate the other researcher skills
compose internally before hand-off, and it is not optional inside `research-sweep`. Use it
standalone whenever you have a load-bearing claim whose cost of being wrong is high.

**Prerequisites and hand-offs.** It requires only `researcher`, and the web leg composes
`deep-research`. Corrections route back to the originating researcher skill. Code issues it
uncovers go to `code-ops-suite:remediation` or `rigor:fix-verified`. A measurement gap goes to
`rigor:improve-measured`.

### `/researcher:library-eval`
**Mode:** REVIEW

**How it works.** Five phases (0 to 4) with one egress checkpoint:

- **Phase 0** frames the decision: the need, the full candidate set, and the weighted decision criteria. The candidate set names building it yourself and doing nothing as real options. It also establishes the local grounding sources.
- **Phase 1** derives your truth from code at `file:line`. It captures the concrete requirements (call sites, data shapes, hot paths, contracts) and the constraints (runtime and version, peer dependencies, build story, performance budgets, deployment target, and the privacy and egress posture, including whether a candidate phones home).
- **Phase 2** gathers each candidate's real capabilities. Installed candidates are read against the installed version through `lib-docs.mjs`. Web-only candidates use the opt-in `deep-research` leg with every request recorded. Building it yourself gets a scoped minimal implementation.
- **Phase 3** scores against the criteria and disconfirms across the dimensions that sink real adoptions: fit and coverage, maintenance health, license, supply-chain and egress trust, migration cost, and lock-in and reversibility.
- **Phase 4** synthesizes the brief: a one-paragraph tiered recommendation, a side-by-side comparison table, grounded fit, migration cost and the smallest adoption slice, the runner-up and why not, risks, and open questions. It validates with `research-manifest.mjs validate LIBRARY_EVAL.md` before publishing.

**Produces** `LIBRARY_EVAL.md`, plus `EGRESS_MANIFEST.md` when any web source was used.

**Why it's useful.** It answers "should we adopt X?" as a verdict a senior engineer can act
on. Real capabilities are verified against the actual version. Fit and migration cost are
grounded in your seam. The recommendation is defensible and names the lowest-risk first step.

**When to use it.** Use it for any adopt, replace, or build decision about a library or
approach. Use `research-spike` instead when the question is how to build something rather
than which dependency to pick. Use `ecosystem-watch` when the trigger is a change in a
dependency you already run. For a deep trust check of a candidate's supply chain, it hands
off rather than asserting.

**Prerequisites and hand-offs.** It requires only `researcher`, and the web leg composes
`deep-research`. The verdict hands off to `code-ops-suite:adr` to record the decision and the
rejected alternatives, and to `code-ops-suite:dependency-upgrade` to execute the adoption and
any version bump. A flagged trust or egress concern routes to
`privacy-opsec-suite:supply-chain-trust`.

---

## Orchestrator

### `/researcher:research-sweep`
**Mode:** orchestrator (DISCOVERY and REVIEW, never DOCUMENT-only)

**How it works.** Six phases (0 to 5). It pauses at every phase boundary and surfaces
`EGRESS_MANIFEST.md` at each checkpoint. It orchestrates the researcher's own skills in
sequence and does not replace them:

- **Phase 0** scopes the run, records the HEAD `<sha>`, and confirms which modes run and in what order. The default order is ground, then improve and ideate, then verify, then propose. It also takes the egress permission and scope. `research-verify` is never optional.
- **Phase 1** grounds in your code with zero egress, verifying library facts against installed versions through `lib-docs.mjs`.
- **Phase 2** (checkpoint, surfaces the manifest) runs the selected discovery skills and collects entries into `RESEARCH_FINDINGS.md` and `IDEAS_REGISTER.md`, each stamped `Verified-at: <sha>`.
- **Phase 3** runs `research-verify` over every load-bearing claim, re-tiers on evidence, and re-validates the registers with `revalidate-register.mjs` before they cross the boundary.
- **Phase 4** ranks survivors and maps each to its implementer.
- **Phase 5** consolidates one `EXECUTIVE_SUMMARY.md`, separating CONFIRMED from PROBABLE and SPECULATIVE. It validates the egress discipline fail-closed with `research-manifest.mjs validate <artifact>` for every register, every brief, and the summary.

**Produces** the consolidated `RESEARCH_FINDINGS.md`, `IDEAS_REGISTER.md`, the per-spike
design briefs, `EGRESS_MANIFEST.md`, and a single `EXECUTIVE_SUMMARY.md`.

**Why it's useful.** It runs the full research pipeline as one developer-in-the-loop pass. It
carries the shared registers forward fresh, keeps a master plan, and keeps the egress posture
visible at every boundary, so you do not stitch the six skills together by hand.

**When to use it.** Use it when you want a broad, end-to-end research pass over a question or
an area rather than a single targeted skill. It is the intra-plugin orchestrator and composes
the researcher's own skills. For a cross-plugin pass that strings together orchestrators
across the marketplace, use `code-ops-suite:everything` instead, and treat `research-sweep` as
the research leg that feeds it. Reach for a single skill such as `research-improve` when the
scope is narrow and you do not need the whole pipeline.

**Prerequisites and hand-offs.** It requires nothing beyond the `researcher` plugin.
`lib-docs.mjs` is bundled, and the opt-in web leg runs only through the composed
`deep-research` skill behind a checkpoint. It composes `code-ops-suite`, `rigor`, and
`privacy-opsec-suite` skills only when they are installed, and only for hand-off (§11):

- improvements go to `code-ops-suite:remediation` or `rigor:fix-verified`
- features and ideas go to `code-ops-suite:feature-discovery`, `feature-implementation`, or `ship`
- an adopt-or-replace choice, or a load-bearing design choice, goes to `code-ops-suite:adr`
- measured performance goes to `rigor:improve-measured`
- dependency and CVE actions go to `code-ops-suite:dependency-upgrade` or `privacy-opsec-suite:supply-chain-trust`

It never edits code.

---

*Verified-at: b0ffede*
