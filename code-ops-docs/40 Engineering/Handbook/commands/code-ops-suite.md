# `code-ops-suite` command reference

This page is the complete command reference for the `code-ops-suite` plugin.
It carries one entry per command: how it works, why it is useful, when to reach for it, and what it hands off.
Read it when you are picking an engineering command, or when you need the bundled scripts and hooks a run leans on.

The `code-ops-suite` plugin is the spine of the marketplace. It packages broad-breadth
engineering workflows for any codebase as 34 namespaced skills, invoked as
`/code-ops-suite:<name>`. Every skill reads the shared
[`CONVENTIONS.md`](../../../../plugins/code-ops-suite/CONVENTIONS.md) first. That file defines
the operating model, the developer-in-the-loop interaction protocol, the safety rails (branch,
tests green, redact secrets, never fabricate), the modes, the finding and fix tracks, the
schemas, the severity taxonomy, the quality lenses, the implementation loop, and the
single-source-of-truth conventions.

Invoke a skill by slash command, or let the model route to it under the standard-operating-mode
routing card. Side-effect-bearing phases keep their checkpoints, and nothing ever auto-merges.

The suite has three shapes of work, plus the orchestrators. **Assess** skills read the code and
write a ranked backlog. **Build** skills implement against that backlog or against specs.
**Document** skills generate code-grounded reference docs and run-continuity state. Four
**orchestrators** chain the others into one developer-in-the-loop pipeline.

The thread that ties everything together is the register, a live backlog with stable IDs such
as `SEC-003`, `PERF-007`, and `FEAT-012`. It flows from discovery to register to commit or PR
to log. It is kept fresh with `Verified-at: <sha>` stamps and the `revalidate-register.mjs`
freshness check.

## Index

**Assess (AUDIT and DISCOVERY)**
- [`codebase-audit`](#code-ops-suitecodebase-audit): broad multi-lens review, producing a ranked findings backlog
- [`security-privacy-audit`](#code-ops-suitesecurity-privacy-audit): adversarial STRIDE and LINDDUN threat assessment
- [`feature-discovery`](#code-ops-suitefeature-discovery): grounded, ranked feature ideas and specs

**Build (IMPLEMENT)**
- [`remediation`](#code-ops-suiteremediation): implement the findings backlog with tests
- [`feature-implementation`](#code-ops-suitefeature-implementation): build specified features, slice-first, behind flags
- [`performance`](#code-ops-suiteperformance): measure, optimize what is proven hot, prove it
- [`test-hardening`](#code-ops-suitetest-hardening): meaningful, deterministic coverage on critical paths
- [`dependency-upgrade`](#code-ops-suitedependency-upgrade): safe, staged upgrades and CVE remediation
- [`normalize`](#code-ops-suitenormalize): one consistent, behavior-preserving house style
- [`pr-split`](#code-ops-suitepr-split): carve a big branch into a clean, traceless stack

**Review (REVIEW)**
- [`pr-review`](#code-ops-suitepr-review): rigorous pre-merge review against all lenses
- [`local-review-gate`](#code-ops-suitelocal-review-gate): opt-in local deep review, the OpSec gate, and judgment-eval receipts before PR creation

**Document (DOCUMENT)**
- [`adopt-standards`](#code-ops-suiteadopt-standards): bootstrap or maintain a repo's `CLAUDE.md` standards contract
- [`adopt-global-standards`](#code-ops-suiteadopt-global-standards): maintain the user-wide standards contract from marketplace doctrine
- [`doc-alignment`](#code-ops-suitedoc-alignment): reconcile doc drift and establish the single source of truth
- [`repo-docs`](#code-ops-suiterepo-docs): refresh the affected manifest-owned documentation domains
- [`onboarding`](#code-ops-suiteonboarding): verified orientation guide with a diagram
- [`current-docs`](#code-ops-suitecurrent-docs): version-accurate library docs, in-house
- [`architecture`](#code-ops-suitearchitecture): deep C4 architecture reference
- [`api-docs`](#code-ops-suiteapi-docs): accurate interface reference
- [`data-model`](#code-ops-suitedata-model): ER diagram plus per-entity invariants
- [`adr`](#code-ops-suiteadr): architecture decision records
- [`ops-docs`](#code-ops-suiteops-docs): the operator's runbook
- [`handoff`](#code-ops-suitehandoff): capture or resume a run's verifiable session state
- [`atlas`](#code-ops-suiteatlas): the repo's durable cache of judgment, with mechanical freshness
- [`conform`](#code-ops-suiteconform): assess and repair the complete code-ops standard
- [`vault`](#code-ops-suitevault): create, migrate, or check the repository documentation vault

**Meta and suite self-audit**
- [`calibration-run`](#code-ops-suitecalibration-run): standardized real-scale calibration on a one-way sanitized channel
- [`run-cost-audit`](#code-ops-suiterun-cost-audit): audit a completed run's cost discipline
- [`provider-parity-audit`](#code-ops-suiteprovider-parity-audit): audit the suite's own prose for provider-specific assumptions

**Orchestrators**
- [`full-sweep`](#code-ops-suitefull-sweep): the whole suite end to end (intra-plugin)
- [`everything`](#code-ops-suiteeverything): the cross-plugin superset (all three plugins)
- [`ship`](#code-ops-suiteship): implement one change end to end at full rigor
- [`debug`](#code-ops-suitedebug): drive a bug from symptom to a proven root-cause fix

Beyond the skills, the plugin bundles scripts and hooks you can call directly. See
[bundled scripts and hooks](#bundled-scripts-and-hooks).

---

## Bundled scripts and hooks

Every script below ships inside the plugin at `${CLAUDE_PLUGIN_ROOT}/scripts/`, and every hook
at `${CLAUDE_PLUGIN_ROOT}/hooks/`. A hook marked on by default turns off by setting its switch
to `off`, `0`, or `false` in the `env` block of a `.claude/settings.json`. The exact behavior
contracts live in [the contracts page](../../../35 Contracts and Data/CONTRACTS.md), and the
switches in [the infrastructure page](../../../50 Platform/INFRASTRUCTURE.md). This list is a
pointer, not a second contract.

- `co <domain> <verb> [args...]` is the one entrypoint. It resolves a verb to a sibling script and hands over every remaining argument unchanged. Run `co --help` for the full table, and `co <domain> --help` for one domain.
- `co context skim <file>` prints a header and an outline, so you request a line range instead of a whole file. `--range A,B` prints those lines with gutters.
- `co context digest -- <cmd>` runs a command with no shell and returns a compressed digest plus a receipt naming the raw output file. The `PreToolUse` hook `digest-rewrite.mjs` applies it to an allowlisted simple Bash command automatically. It is on by default, and its switch is `CODE_OPS_DIGEST`.
- `co context query find|callers|callees|blast|explore <symbol>` answers a structural question with `file:line` anchors and one-line signatures, never a verbatim dump. `refresh` and `status` maintain the index. The `PostToolUse` hook `index-refresh.mjs` re-parses changed files after an edit. It is on by default, and its switch is `CODE_OPS_INDEX`. The same index is served by the bundled `code-ops-query` MCP server.
- `co scan overbuild --git <range>` reads one diff and its head tree through git and reports eight over-build tells. Only an unrecorded dependency blocks, and every other tell is advisory.
- `co scan deferrals` collects every `deferred(<ceiling>, <upgrade path>)` marker in a tracked text file into `DEFERRALS_REGISTER.md`. `--check` re-harvests and exits 1 when the register on disk disagrees.
- `co context audit` summarizes where a session's context went. `co context audit receipts` reads the session-receipt ledger back, `--by-arm` groups sessions by the switches they ran under, and `--purge-before <ISO date>` trims old rows.
- The `SessionEnd` hook `session-receipt.mjs` appends one receipt row per session to a home-directory ledger, which never leaves the machine. Its switch is `CODE_OPS_RECEIPTS`, and it also names the ledger path.
- The `SubagentStart` hook `ladder-card.mjs` prints the code-economy ladder to an implementer-class subagent, in at most ten lines. It is on by default, and its switch is `CODE_OPS_LADDER_CARD`.
- The `PreCompact` hook `precompact-preserve.mjs` prints the fixed instruction naming what a compaction summary must keep. It reads no stdin and adds no per-turn tokens.
- The `PreToolUse` hook `enforce-traceless.mjs` blocks a flagged `git commit` or `gh pr create` at the tool layer, and the `SessionStart` hook `routing-card.mjs` prints the routing card.

---

## Assess

### `/code-ops-suite:codebase-audit`
**Mode:** AUDIT

**How it works.** Two phases:

- **Phase 0** (checkpoint) detects the stack and tooling, builds the real service and module inventory, captures the build, test, and lint baseline, and opens a coverage ledger of every area against every applicable lens.
- **Phase 1** runs the adaptive loop (`CONVENTIONS §1`). Sub-agents apply the relevant quality lenses (`§10`) to disjoint slices and return findings in the finding schema (`§7`), classified by track (`§6`). It applies only confirmed NOW-SAFE fixes, with your approval per batch, through the implementation loop (`§11`), and logs each one.

**Produces** four artifacts under a dated audit folder: `FINDINGS_REGISTER.md` as the
authoritative backlog, `REMEDIATION_LOG.md` for applied fixes, `FEATURE_OPPORTUNITIES.md` for
opportunities noticed in passing, and `EXECUTIVE_SUMMARY.md`. The run is not done until the
finished register passes `revalidate-register.mjs` clean. A non-FRESH citation is re-located
against the real tree or dropped. Critical findings surface to you immediately.

**Why it's useful.** It turns an unfamiliar or drifting codebase into a ranked,
evidence-backed backlog you can act on cold. Every finding cites `file:line`, states impact,
and ends with a concrete recommendation, led by a top-N-highest-value list.

**When to use it.** Reach for it on an unfamiliar inheritance, before a big push, or on a
periodic health pass. It pays particular attention to modularity, performance, intricate
correctness bugs, security, privacy and data handling, and, for user interfaces, styling,
theming, and accessibility. Do not use it when you already have a register and just want it
implemented, which is `remediation`. Do not use it when you want a deep adversarial security
model, which is `security-privacy-audit`.

**Sibling disambiguation, `codebase-audit` against `rigor:bug-hunt`.** `codebase-audit` is
breadth: every module against every lens, static evidence acceptable, and a wide backlog.
`rigor:bug-hunt` is depth with proof: it goes deep per subsystem, requires a runnable
reproduction before flagging, and emphasizes root cause plus a sibling sweep. Use
`codebase-audit` to map the field, and `rigor:bug-hunt` to nail a specific class of defect
down.

**Prerequisites and hand-offs.** It needs no prerequisites beyond the plugin. It feeds
`FINDINGS_REGISTER.md` to `remediation`, and its `FEATURE_OPPORTUNITIES.md` to
`feature-discovery`. It routes the security lens depth-out to `security-privacy-audit`.

### `/code-ops-suite:security-privacy-audit`
**Mode:** AUDIT

**How it works.** Two phases:

- **Phase 0** (checkpoint) maps the attack and data surface: every entry point, input, deserialization, upload, auth boundary, admin and debug surface, and client code. It defines the trust boundaries and the relevant adversaries: external attacker, passive or active network observer, malicious or compromised operator, legal or subpoena demand, malicious peer, and supply-chain attacker. It also builds a data-flow map for personal and sensitive data.
- **Phase 1** fans out per surface and threat class. It applies STRIDE for security, plus crypto and transport, config, headers, CORS, and cookies, and a deep dependency-CVE pass with lockfile integrity. It applies LINDDUN for privacy, scaled to data sensitivity, plus the insider and legal threat. Findings use the schema (`§7`), augmented with threat class, exploitability, adversary, and a conceptual attack or leak scenario. It applies only trivial, obviously safe hardening with your approval.

**Produces** `THREAT_MODEL.md` as a durable, reusable artifact, plus
`SECURITY_PRIVACY_FINDINGS.md` and `EXECUTIVE_SUMMARY.md`. It routes NEEDS-REVIEW and
NEEDS-DESIGN items into `FINDINGS_REGISTER.md`.

**Why it's useful.** It thinks like an attacker auditing your own system in order to harden
it, which is deeper than the audit's single security lens. It leaves a reusable threat model
plus a fix-first list ranked by severity times exploitability. The work is defensive, so
findings describe vulnerabilities and their fixes and never weaponized exploits.

**When to use it.** Use it before exposing a new surface, after a security-relevant change, on
a recurring schedule, or whenever the system handles personal or sensitive data. Do not reach
for it for anonymity-specific egress, metadata, or fingerprint work, which is the
privacy-opsec-suite anonymity track.

**Sibling disambiguation, `security-privacy-audit` against
`privacy-opsec-suite:anonymity-threat-model`.** This skill is a general STRIDE and LINDDUN
assessment for any system, scaling its privacy depth to how much sensitive data the system
handles. `privacy-opsec-suite:anonymity-threat-model` is the keystone of the anonymity track.
It presumes the project has explicit anonymity requirements, and it seeds six parallel leak
audits feeding a `LEAK_REGISTER.md`. Use this skill for "is my system secure and
privacy-respecting?", and the anonymity threat model for "can an adversary deanonymize a user
of this system?".

**Prerequisites and hand-offs.** It has no prerequisites. It feeds `FINDINGS_REGISTER.md` to
`remediation`. Its `THREAT_MODEL.md` is consumed by ongoing security work, and by the
privacy-opsec track where that applies.

### `/code-ops-suite:feature-discovery`
**Mode:** DISCOVERY

**How it works.** Three phases:

- **Phase 0** (checkpoint) detects latent capabilities, maps the current feature set and the main user flows, infers product intent and target users, and harvests intent signals: TODOs, disabled flags, stubbed endpoints, dead routes, and recurring demand in version-control history.
- **Phase 1** fans out across discovery lenses against product areas, producing ideas in the idea schema (`§7`). The lenses are latent capability, half-built or abandoned work, UX friction, workflow completion, power-user and automation, onboarding and activation, configurability, extensibility, performance as a feature, accessibility, trust and transparency and control, and category parity.
- **Phase 2** (checkpoint) scores ideas by impact times reach divided by effort, weighted by confidence (`§8`). It tags quick wins and big bets, defines the smallest valuable slice, and writes a mini-spec per chosen feature.

**Produces** `FEATURE_OPPORTUNITIES.md`, the chosen mini-specs in `TOP_FEATURES.md` or
`specs/`, `FEATURE_ROADMAP.md` on a Now, Next, Later shape, and `EXECUTIVE_SUMMARY.md`. It
changes no code.

**Why it's useful.** It mines high-value, grounded feature ideas from what the codebase can
already do cheaply, rather than a generic wishlist. It hands implementation-ready specs to the
build track.

**When to use it.** Use it at planning time, when looking for high-leverage work, or to turn
the audit's `FEATURE_OPPORTUNITIES.md` into real specs. Do not use it to build features, which
is `feature-implementation`, because it writes no code.

**Prerequisites and hand-offs.** It has no prerequisites, and can ingest `codebase-audit`'s
`FEATURE_OPPORTUNITIES.md`. It feeds its mini-specs and roadmap to `feature-implementation`.

---

## Build

### `/code-ops-suite:remediation`
**Mode:** IMPLEMENT

**How it works.** Two phases:

- **Phase 0** (checkpoint) reads `FINDINGS_REGISTER.md`. When the register is absent, it stops and routes to `codebase-audit` or `rigor:bug-hunt` to produce one, rather than synthesizing a register from memory. It re-validates first (`§12`) by running `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .` and triaging its FRESH, MOVED, DRIFTED, GONE, AMBIGUOUS, and NO-REF report. It drops anything already fixed or obsolete, marking it `OBSOLETE-AT <sha>`. It then builds a dependency and conflict graph, running disjoint items in parallel and coupled items in series, sequencing by value against risk.
- **Phase 1** runs each item through the implementation loop (`§11`). A NEEDS-REVIEW item changes behavior by definition, so it confirms the intended new behavior and pins it with tests. It integrates continuously and re-runs the full suite after each batch. A NEEDS-DESIGN item gets its options presented for a direction first. When three or more items fail verification or spawn new confirmed findings, the cascade circuit-breaker (`§11`) stops the loop and escalates the cluster as NEEDS-DESIGN.

**Produces** verified fixes as atomic branches or PRs, an updated `FINDINGS_REGISTER.md`, and
`IMPLEMENTATION_LOG.md`. It updates docs wherever behavior changed. The register must pass
`revalidate-register.mjs --consumed <pre-run copy>`. No consumed item vanishes or closes
without a pinned terminal form: closed-with-proof, deferred-with-reason, or OBSOLETE-AT.

**Why it's useful.** It is the disciplined executor of a backlog. It implements findings
efficiently and at high quality without re-introducing the problems the audit found, and it
never re-lists items already fixed in code.

**When to use it.** Use it when a `FINDINGS_REGISTER.md` already exists, from
`codebase-audit`, `security-privacy-audit`, or the deep-dives, and you want it implemented
safely. Do not use it without a register, because it consumes one as input.

**Prerequisites and hand-offs.** It requires a `FINDINGS_REGISTER.md`. It consumes the
register's NEEDS-REVIEW and NEEDS-DESIGN items, and feeds its PRs to `pr-review`.

### `/code-ops-suite:feature-implementation`
**Mode:** IMPLEMENT

**How it works.** Two phases:

- **Phase 0** (checkpoint) reads the specs, register, and roadmap, re-grounds each feature against current code, and drafts a build plan honoring dependencies. It confirms which features, in what order, the slice boundaries, the flag strategy, and the PR preference, and it batch-answers each spec's open questions.
- **Phase 1** builds the smallest valuable slice first and runs the implementation loop (`§11`). It lands features behind flags where that reduces risk, and builds real states for loading, empty, error, and success, plus the edge and unhappy paths. It reuses existing services per the spec's builds-on section, asserts the acceptance criteria, and re-checks the privacy posture against the actual implementation.

**Produces** shipped features as flagged PRs, an updated `FEATURE_OPPORTUNITIES.md`, and
`BUILD_LOG.md`. It updates docs for everything shipped. The updated register must pass
`revalidate-register.mjs --consumed <pre-run copy>`, and no consumed item vanishes or closes
without a pinned terminal form.

**Why it's useful.** It builds specified features incrementally and safely, matching the
repo's conventions and verifying the acceptance criteria. It turns specs into shipped, tested,
flag-guarded code.

**When to use it.** Use it when feature specs already exist, from `feature-discovery`. Do not
use it for unspecified ideas, because `feature-discovery` comes first. Do not use it for a
single ad-hoc change end to end, which is `ship`.

**Prerequisites and hand-offs.** It requires feature specs, plus
`FEATURE_OPPORTUNITIES.md` and `FEATURE_ROADMAP.md`. It feeds its PRs to `pr-review`.

### `/code-ops-suite:performance`
**Mode:** IMPLEMENT

**How it works.** Its prime directive is measure first. It never optimizes code not
demonstrated to be hot. Two phases:

- **Phase 0** (checkpoint) identifies the performance-critical paths, sets up repeatable profiling and benchmarks, captures baseline numbers, and ranks hot spots by actual cost.
- **Phase 1** fans out per hot path, following where profiling points. It reduces algorithmic complexity, fixes data access (N+1 queries, indexes with your approval, batching, and caching with correct invalidation), and addresses concurrency, memory and allocation, payload size, the frontend (code splitting, trimming dependencies, render thrash), and build and CI. Every optimization is confirmed hot, then made as the smallest change, then benchmarked before and after, then committed with the delta once tests are green. A change that does not move the number is reverted.

**Produces** optimizations, each commit carrying before-and-after numbers, plus
`PERFORMANCE_REPORT.md`. Remaining design-changing or behavior-changing opportunities go to
`FINDINGS_REGISTER.md`.

**Why it's useful.** It delivers proven speedups rather than speculative ones. It also
documents tempting but cold targets as not worth it, with the data, so you stop chasing them.

**When to use it.** Use it when something is measurably slow and you want hot paths optimized
with proof. Do not use it for broad behavior-preserving cleanups with measured wins across the
board, which is `rigor:improve-measured`.

**Sibling disambiguation, `performance` against `rigor:improve-measured`.**
`code-ops-suite:performance` targets a specific slow surface: profile it, optimize the
proven-hot path, prove the delta. `rigor:improve-measured` is the verification layer's broad
measured-improvement pass. It ships only changes that carry a measured before-and-after delta,
and it is behavior-preserving across whatever it touches. Reach for `performance` when you
have a hot spot in mind, and for `improve-measured` for a disciplined, evidence-gated
improvement sweep.

**Prerequisites and hand-offs.** It has no prerequisites, and can ingest audit performance
findings as leads. It feeds residual opportunities to `FINDINGS_REGISTER.md`.

### `/code-ops-suite:test-hardening`
**Mode:** IMPLEMENT

**How it works.** Two phases:

- **Phase 0** (checkpoint) detects the frameworks and runners, baselines pass and fail counts, coverage, and run time, identifies flaky tests by running the suite a few times, and ranks targets by risk times importance.
- **Phase 1** fans out per area, writing behavior-focused, deterministic, meaningful tests across the happy, edge, boundary, and error paths. Special passes cover characterization tests that pin current behavior before refactors, regression tests, and security and privacy-path tests. Flaky tests are fixed at the root and never retry-wrapped.

A hard rule holds throughout. Never change product code to make a test pass. When a test
exposes a bug, write a failing or skipped test documenting it and log a finding.

**Produces** committed tests and `TEST_COVERAGE_REPORT.md`. Bugs exposed go to
`FINDINGS_REGISTER.md`.

**Why it's useful.** It raises meaningful coverage where it matters, meaning tests that assert
behavior and would catch real regressions. It also provides the characterization safety net
that makes a later refactor provably behavior-preserving.

**When to use it.** Use it when critical paths lack coverage, when tests are flaky, or before
a risky refactor. Do not use it to judge whether your existing tests actually catch faults,
which is `rigor:test-suite-audit` and its mutation and assertion-strength work.

**Prerequisites and hand-offs.** It has no prerequisites, and ingests audit under-test flags.
It provides the characterization net consumed by `remediation` and `normalize`, and logged
bugs go to `FINDINGS_REGISTER.md`.

### `/code-ops-suite:dependency-upgrade`
**Mode:** IMPLEMENT

**How it works.** Two phases:

- **Phase 0** (checkpoint) catalogues direct against transitive dependencies, current against latest versions, deprecated and end-of-life packages, duplicates, known CVEs with severity, unused dependencies, licenses, and lockfile state. It prioritizes in order: CVEs, then deprecated and end-of-life, then valuable majors, then routine minors, then deduplication and removal. It then asks you to approve or defer the majors.
- **Phase 1** upgrades one branch or PR per item. It reads the changelog and migration guide, gets your go-ahead and plans the migration for a major, applies the bump and the code changes, and runs the full suite, the build, and typecheck and lint. It exercises libraries that affect the user interface, then commits or opens a PR with the version delta, the breaking changes handled, and the CVE references. It flags any dependency that adds telemetry, phones home, or changes the egress or trust surface as a developer decision, and it never bulk-bumps.

CVEs are closed on evidence. A fresh advisory re-scan against the final lockfile, using the
ecosystem's live audit tool, must show no remaining high or critical advisories except those
explicitly accepted or deferred with a rationale. Closure is never inferred from the version
bumps alone.

**Produces** verified upgrade PRs, `DEPENDENCY_REPORT.md` whose CVEs-closed list is backed by
the re-scan output, and a clean lockfile.

**Why it's useful.** It brings dependencies current safely. Each change is isolated,
changelog-checked, and individually verified, so CVEs close without the bump-everything
failure mode.

**When to use it.** Use it when dependencies are outdated or carry known CVEs and you want
staged, verified upgrades. It is good on a recurring schedule. Do not use it to bulk-bump
everything at once, because it deliberately refuses that.

**Prerequisites and hand-offs.** It has no prerequisites, and ingests audit dependency
findings. It feeds residual items back to the register.

### `/code-ops-suite:normalize`
**Mode:** IMPLEMENT (behavior-preserving)

**How it works.** Two phases:

- **Phase 0** (required checkpoint) detects tooling, derives the house style from the codebase's dominant patterns, and inventories the tells of hasty or generated code, the inconsistencies, and the modularization opportunities. It baselines tests, build, lint, and coverage, and captures the ratified standard in `STYLE_GUIDE.md`. A tells checklist drives the hunt: narration comments, tutorial voice, placeholder and disclaimer comments, emoji, inflated prose, debug residue, generic names, over-defensive ceremony, over-engineered indirection, section-divider mega-functions, commented-out code, and inconsistent terminology.
- **Phase 1** fans out conflict-aware across nine workstreams: style and formatting, naming, comments, dead-code removal, standardizing recurring operations, modularization, method clarity, README and docs, and version-control history. It commits in reviewable logical chunks and finishes with a hostile-reviewer pass.

Behavior preservation is absolute. Tests stay green at every step, and where coverage is thin,
characterization tests come first.

**Produces** the normalized codebase, `STYLE_GUIDE.md`, an enforced linter and formatter
config with a recommended pre-commit or CI gate, `NORMALIZATION_LOG.md`, and a separate list of
behavior-changing issues found and not fixed here.

**Why it's useful.** It makes the codebase read as the consistent work of one experienced
team, and hold up under line-by-line review. The standard is machine-enforced, so consistency
cannot silently rot again.

**When to use it.** Use it when a codebase has inconsistent style or the artifacts of hasty or
generated code and you want one professional standard. Do not use it to close divergent
implementations of a concept, meaning two competing ways to do the same thing, which is
`rigor:consistency-closure`.

**Sibling disambiguation, `normalize` against `rigor:consistency-closure`.**
`code-ops-suite:normalize` is about surface and style: one coherent voice everywhere, tells
removed, dead code gone, recurring operations done the same way, enforced by a linter and
formatter config. `rigor:consistency-closure` is about semantic convergence. When a concept is
implemented several divergent ways, it picks one canonical form, migrates every site, and adds
enforcement so the divergence cannot recur. Use `normalize` to make the code look like one
team wrote it, and `consistency-closure` to make a concept behave one way everywhere.

**Prerequisites and hand-offs.** It has no prerequisites, and uses `test-hardening`-style
characterization where coverage is thin. It routes behavior-changing finds to a separate list
for the audit and remediation track.

### `/code-ops-suite:pr-split`
**Mode:** IMPLEMENT

**How it works.** Five phases:

- **Phase 0** (checkpoint) resolves the merge base against the target trunk, captures the full diff, runs `/rigor:ground-truth` for the baseline, learns the repo's commit and PR conventions, and confirms the trunk, the maximum PR size, and the automation level (`§4`).
- **Phase 1** builds a change-unit graph and groups hunks into reviewer-sized PRs of roughly 400 lines or fewer, by dependency, concern or layer, and atomicity, ordered topologically.
- **Phase 2** verifies as it carves. Each stacked PR builds and tests green at its step, and green-at-every-step is the invariant.
- **Phase 3** is a fail-closed trace scrub through `privacy-opsec-suite:authorship-hygiene` and `co scan ai-tells`.
- **Phase 4** runs the deterministic gate chain and a diff read for each final stacked branch. It runs `local-review-gate` against that branch's exact parent and committed HEAD only when the operator opted in for that branch. It pushes each branch without a PR, publishes the SHA-bound statuses when the gates ran, then opens each PR against its parent. A moved parent invalidates the descendant review.

It never auto-merges, and it never force-pushes over an existing remote branch without
confirmation.

**Why it's useful.** It turns one unreviewable mega-branch into a clean stack of small,
independently green PRs scrubbed of AI and tooling trace. Review becomes fast, and the
authorship hygiene stays airtight.

**When to use it.** Use it when you have one big branch to carve into a reviewable stack. Do
not use it to review someone's diff, which is `pr-review`, or to implement from scratch.

**Prerequisites and hand-offs.** It requires `rigor` and `privacy-opsec-suite`, and the local
review gate when the operator opts in. It composes
`privacy-opsec-suite:authorship-hygiene` fail-closed before any push. It is the finish stage
that `ship`, `debug`, `full-sweep`, and `everything` delegate to.

---

## Review

### `/code-ops-suite:pr-review`
**Mode:** REVIEW

**How it works.** Two phases:

- **Phase 0** pulls the PR, branch, or diff and its intent, meaning the description, the linked issue, finding, or spec, and the surrounding code context. It reviews the diff against the code it changes. It traces the change's reach first, covering dependents and call sites of changed exported symbols, shared types and schemas, and API and database contracts. It scales reviewer fan-out and depth to that reach rather than to diff size, because a small diff in a shared contract is a large review. For a large PR it fans out parallel reviewers per file-group and synthesizes one coherent review.
- **Phase 1** applies the relevant lenses (`§10`) scoped to the diff plus the context it needs: correctness and intricate bugs, design and modularity, performance and efficiency regressions, security introduced, privacy and data-handling regressions (blocking, scaled to data sensitivity), user interface, theming, and accessibility, tests, docs, and conventions.

**Produces** a prioritized review. Each comment sits at `file:line` with a concrete suggested
change, labeled Blocking, Should-fix, or Nit. It ends with a verdict of approve,
approve-with-nits, or request-changes, plus a two-line or three-line summary, with the blocking
items first. Before any item ships as Blocking it goes through independent refutation (`§7`),
where a fresh `reviewer` or `tracer` that did not raise it tries to kill it by locating a
dominating guard or handler elsewhere. A refuted item drops or downgrades, citing the guard.
Each comment quotes a verbatim Anchor (`§9`) of its cited line, so the citation is checkable.
Comments post to the PR when a version-control tool is connected, and otherwise land in
`REVIEW.md`. It is review-only by default, and switches to the implementation loop only if you
ask it to fix.

**Why it's useful.** It is a senior-level pre-merge gate that catches the bugs, regressions,
and missing tests that matter. Each comment carries a concrete fix and a clear merge verdict.

**When to use it.** Use it before merging any specific change. Wire it into CI on every PR
with the reviewed immutable action pin in the plugin's
[`examples/github-pr-review.yml`](../../../../plugins/code-ops-suite/examples/github-pr-review.yml).
Do not use it for a verification-bar review that blocks only on reproduced defects, which is
`rigor:deep-review`, or for an anonymity gate, which is
`privacy-opsec-suite:opsec-pr-gate`.

**Sibling disambiguation among the three review gates.** All three review a change before
merge, at different bars. `code-ops-suite:pr-review` is the broad senior review across all
quality lenses, producing prioritized comments and a verdict, and it will flag should-fixes and
nits. `rigor:deep-review` is the verification-first review, blocking only on reproduced
defects with evidence tiers, trading breadth for a high-signal, low-noise gate.
`privacy-opsec-suite:opsec-pr-gate` is the anonymity gate, blocking a change that introduces a
new leak, egress, identifier, or fingerprint, or that weakens fail-closed posture. Run
`pr-review` for general merge readiness, `deep-review` when you want only proven blockers, and
`opsec-pr-gate` on any change touching an anonymity surface.

**Prerequisites and hand-offs.** It has no prerequisites, and uses a version-control tool when
connected. It consumes the PRs from `remediation` and `feature-implementation`. When asked to
fix, it enters the implementation loop.

### `/code-ops-suite:local-review-gate`
**Mode:** REVIEW

**How it works.** Two tracks. Track A runs deterministic checks before spending model time,
commits the final diff, and prepares an ignored plan binding the current base SHA, the HEAD
SHA, the binary full-index diff digest, the changed paths, and the required gate names. Two
independent strong-tier, high-effort reviewers then run `rigor:deep-review` and
`privacy-opsec-suite:opsec-pr-gate` locally against that boundary. The lead accepts their
evidence and records each report in one hash-chained receipt set. Any base movement, new
commit, report edit, missing gate, duplicate gate, malformed receipt, or blocking verdict
invalidates the pass. After the traceless checks, the branch is pushed without a PR, and the
verified local receipts may publish `local-deep-review` and `local-opsec-gate` commit statuses
for the exact remote SHA. The PR opens only afterward, and hosted CI stays deterministic.

Track B compiles local trend or model-floor units from `evals/judgment-matrix.json`, dispatches
them read-only, and writes one digest-bound deterministic scoring receipt.

**Why it's useful.** It pays for judgment once on the operator's local host, before review
latency and hosted Actions begin, while keeping merge evidence bound to the exact bytes
reviewed. One fixture matrix also removes the duplicated scheduled and dispatch workflow
definitions.

**When to use it.** Use Track A when the operator opts in, meaning a change that touches a
high-risk surface, or one the operator names for review. It is not the default for every PR.
The deterministic chain and the lead's own diff read are the default. Use Track B for
scheduled quality trends or explicit model-floor calibration. Do not reuse receipts after
changing HEAD or updating the base. Do not treat judgment-eval results as merge gates.

**Prerequisites and hand-offs.** Track A requires `rigor:deep-review` and
`privacy-opsec-suite:opsec-pr-gate`, a clean committed feature branch, and `gh` only when
publishing GitHub statuses. Track B requires the tracked judgment matrix and the repository
scorer. `ship` invokes Track A when the operator opted in.

---

## Document

### `/code-ops-suite:adopt-standards`
**Mode:** DOCUMENT

**How it works.** Phase 0 (checkpoint) detects the mode. BOOTSTRAP applies when no `CLAUDE.md`
exists, or when an existing one fails a quick audit. MAINTAIN applies when a sound one already
exists.

In BOOTSTRAP mode it audits the repo, then writes `CLAUDE.md` in the house style. The audit
covers the real build, test, lint, and gate commands, run read-only or cited to the CI workflow
at `file:line` and never invented, the architecture worth three to five lines, the non-obvious
gotchas, and the doc-lifecycle rules.

In MAINTAIN mode it re-verifies every claim against reality. Commands still run. The gate chain
still mirrors CI step for step. Enforcement claims are truthful. Line citations are swept
mechanically against the current tree rather than eyeballed. Cited paths still exist. It fixes
the drift and reports what was stale.

The house style is fixed. `## Never (no gate will save you)` comes first and carries only real,
repo-specific, backstop-free rules. `## Before declaring any change done` carries the verified
command chain mirroring CI, noting any unenforced convention. Post-edit chores follow when the
repo has them. `## Invariants the gates will catch` follows. A local-only or gitignored docs
note follows when it applies. It never duplicates the user's global `~/.claude/CLAUDE.md`
doctrine.

**Why it's useful.** It keeps a repo's standards contract mechanically true rather than
aspirational. The commands it lists actually run, the gates it claims actually gate, and the
citations it makes actually resolve, so the next operator can trust it cold.

**When to use it.** Use it when a repo has no `CLAUDE.md` and needs one bootstrapped from
verified reality, or when an existing one is suspected stale, meaning commands that no longer
run, citations that have drifted, or a gate chain that no longer matches CI. Do not use it to
write general engineering advice, because every line must be project-specific and verified.

**Prerequisites and hand-offs.** It has no prerequisites, and uses CI workflow files and
version-control history as evidence sources. It complements `doc-alignment`, which reconciles
the rest of the docs, because `adopt-standards` owns the standards contract specifically.

### `/code-ops-suite:adopt-global-standards`
**Mode:** DOCUMENT

**How it works.** Five phases:

- **Phase 0** (checkpoint) resolves both sides, the global `~/.claude/CLAUDE.md` and the marketplace checkout it caches. It detects BOOTSTRAP, meaning no global file or one carrying no suite doctrine, against MAINTAIN. It states both paths and the marketplace commit being verified against.
- **Phase 1** builds the current-doctrine baseline by reading the SSOT pages themselves, anchoring each claim to `file:line`. It reads `code-ops-docs/40 Engineering/Handbook/11-standard-operating-mode.md` for the routing table, the tier and effort rule, and the declared exception. It reads `code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md` and `AGENT_MODEL_FLOORS` in `scripts/lint-plugins.mjs` for the enforced floors. It reads `code-ops-docs/40 Engineering/Techniques/writing-standard.md` and the `CONVENTIONS.md` §7 and §9 schemas for the reporting standard.
- **Phase 2** classifies every divergence into one of five buckets. CONTRADICTS means the global file states a rule the SSOT now states differently, which is worse than silence because sessions follow it. STALE and MISSING are what they say. REPO-LOCAL means repo facts leaked upward, and they are handed back to `adopt-standards`. LOCAL-DOCTRINE means cross-repo rules the file already carries that no SSOT page states, which are kept, never pruned, and listed as candidates to promote into the marketplace. Line citations are swept mechanically.
- **Phase 3** checkpoints with the classified drift and the exact proposed edit before any write. It names every removal with the bucket justifying it, and it refuses to touch settings, hooks, permissions, or keybindings.
- **Phase 4** writes additively. The four global sections are the floor, and every existing section survives unless it was classified CONTRADICTS or REPO-LOCAL. It then stamps the marketplace commit verified against, so the next run computes drift from the log.

**Why it's useful.** The global contract is a cache of the marketplace's doctrine, and a stale
cache mis-routes every session in every repo, silently. An inverted tier rule down-tiers work
the SSOT routes to the strong tier, and nothing in a normal session surfaces that. This is the
only command that re-verifies the cache against its source.

**When to use it.** Use it after the suite's SSOT pages move, meaning a routing-table change, a
tier or effort revision, or a new enforcement mechanism. Use it when the global file has no
commit stamp, so its age is unknowable, or when a session's routing seems to contradict the
handbook. Do not use it to configure the harness, because `settings.json`, hooks, and
permissions are out of scope.

**Prerequisites and hand-offs.** It needs a local checkout of this marketplace as its ground
truth. The repo-side counterpart is `adopt-standards`. Between the two, each fact lives in
exactly one place, and `adopt-global-standards` hands any repo-local content it finds back to
it.

### `/code-ops-suite:doc-alignment`
**Mode:** DOCUMENT

**How it works.** Three phases:

- **Phase 0** (checkpoint) inventories all docs with each one's purpose, maps code reality, and maps the intended single source of truth, meaning which doc is authoritative per topic. It flags no-owner and duplicate-authority topics, using version-control history to date the drift.
- **Phase 1** verifies every doc claim against code and classifies each mismatch as stale, wrong, contradictory, orphaned, missing, duplicate-SSOT, broken-reference, outdated-diagram, dead-procedure, or drifted-comment. It auto-fixes unambiguous factual drift, and brings the stale-against-aspirational and structural calls to you. That is the central judgment: never silently delete a possible plan, and never correct reality to match a roadmap.
- **Phase 2** establishes one authoritative source per topic, with working cross-links and an index.

Code is ground truth, and it edits documentation only. A likely code bug is logged as a
finding, not fixed.

**Produces** reconciled docs edited in place, `DRIFT_REPORT.md`, `SSOT_MAP.md`, and
`OPEN_QUESTIONS.md`.

**Why it's useful.** It reconciles drifted docs against code reality and leaves a clean single
source of truth a future operator can trust. It is also the skill that keeps the generated
reference docs true over time.

**When to use it.** Use it when docs have drifted from code, or as the ground-truth first step
of a sweep so later phases work from an accurate map. Do not expect it to change code, because
it logs code issues as findings instead.

**Prerequisites and hand-offs.** It has no prerequisites, and uses version-control history when
available. It establishes the single source of truth that the DOCUMENT-mode generators write
into and that it keeps true. It routes suspected code bugs to the audit and remediation track.

### `/code-ops-suite:repo-docs`
**Mode:** DOCUMENT

**How it works.** It validates `<repo>-docs/98 System/DOCS_MANIFEST.json`, captures one exact
repository snapshot, and reuses that snapshot's content-addressed repo map, import graph, and
freshness-gated atlas. `docs-extract.mjs` intersects the repository delta with each domain's
declared source patterns. Only the affected domains receive bounded context bundles and model
dispatches. A broad or over-budget context fails explicitly rather than truncating. After the
source-grounded updates, the workflow syncs the domain source and content digests and runs the
manifest, link, vault, lint, and extraction gates.

**Why it's useful.** It replaces per-run rediscovery and whole-documentation rewrites with
deterministic delta routing. The manifest makes ownership explicit for architecture, contracts,
data, standards, CI, infrastructure, observability, design, guides, and the atlas.

**When to use it.** Use it after code, workflow, schema, or policy changes that may alter
repository documentation. Use `doc-alignment` for open-ended contradiction analysis, and
`repo-docs` for repeatable extraction into an established hub.

**Prerequisites and hand-offs.** It requires one manifest-owned documentation hub and the
bundled context compiler. It hands ambiguous code defects to the audit track rather than
changing source behavior.

### `/code-ops-suite:onboarding`
**Mode:** DOCUMENT

**How it works.** Two phases:

- **Phase 0** (checkpoint) maps the system and confirms the audience and emphasis. The map covers the stack, the services and modules, the data models, the main flows, the entry points, the build, test, and run commands, the conventions, and the data-handling model.
- **Phase 1** writes the guide in a sensible reading order: the mental model, the architecture with a diagram matching the real map, a repo tour, getting started from clone to install to configure to run to test, the key flows traced through the actual code, the conventions and standards, the data-handling and security rules a contributor must not break, the gotchas, and a glossary. The getting-started steps are verified by actually running them, with secrets redacted. It follows the documentation quality standard (`§13`).

**Produces** `ONBOARDING.md`, or a small `docs/onboarding/` set, inside the repo's
single-source-of-truth structure, with the architecture diagram and a list of open questions.

**Why it's useful.** It makes a new engineer, or a fresh agent, productive fast, with verified
setup steps and real flows rather than a drifted paraphrase of old docs.

**When to use it.** Use it when a newcomer needs orientation, or to capture a freshly mapped
system. It sits inside the doc track. Do not treat its setup steps as unverified theory,
because it runs them to confirm they work.

**Prerequisites and hand-offs.** It has no prerequisites, and ingests reconciled
single-source-of-truth docs when present. It lives inside the structure that `doc-alignment`
keeps true.

### `/code-ops-suite:current-docs`
**Mode:** AUDIT (read-only)

**How it works.** It implements the suite-wide documentation-lookup capability
(`CONVENTIONS §2`) in-house: local-first, with no third-party indexer and no query egress. It
runs the bundled engine,
`node ${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs <library> [topic] --root <repo>`, which
resolves the installed version from `node_modules`. It returns that package's real README,
filtered by topic, plus its exported type signatures, with zero network. It falls back to
fetching the library's own source, meaning `llms.txt` or the GitHub README, only when the
bundled docs are thin. `--no-fetch` forbids that fallback, and `--json` gives structured
output. The same capability is exposed as the `code-ops-docs` MCP server's `resolve-library`
and `get-docs` tools. Fetched docs from a non-installed package are treated as `UNVERIFIED`
against the running version.

**Why it's useful.** It gives you version-accurate API facts that match what actually runs,
unlike training-data memory or a third-party index pinned to a different version. It is also
the only correct source for a private or internal package.

**When to use it.** Use it before writing code against an unfamiliar or version-sensitive API.
It is the suite's default documentation-lookup mechanism, used implicitly by other skills to
confirm library facts. Do not code an API from memory when this is available.

**Prerequisites and hand-offs.** It works best with the library installed, because it reads
`node_modules`. The `code-ops-docs` MCP server is optional. It feeds version-accurate facts
into every other skill's implementation and DOCUMENT work.

### `/code-ops-suite:architecture`
**Mode:** DOCUMENT

**How it works.** Five phases:

- **Phase 0** (checkpoint) detects the stack and builds the real inventory: deployable units, modules, entrypoints, public surfaces, external systems, datastores, and deployment topology. It then picks the three to five runtime flows that matter most.
- **Phase 1** is a C4 ascent through System Context, Containers, and Components. Each level gets a Mermaid diagram plus narrative explaining the responsibilities, the boundaries, and why it is split that way.
- **Phase 2** gives each chosen flow a Mermaid sequence diagram with step narrative covering what, why, invariants, and failure and recovery.
- **Phase 3** covers cross-cutting concerns and the load-bearing invariants.
- **Phase 4** captures the handful of architectural decisions that shaped the system.

It assembles per `§13`, with an executive summary of one page or less first, `file:line`
citations throughout, inferences marked `UNVERIFIED`, and a freshness SHA stamp.

**Produces** `ARCHITECTURE.md`.

**Why it's useful.** It gives a senior engineer new to the system a diagram-rich,
code-grounded map they can navigate and safely change from, rather than a flat box diagram.

**When to use it.** Use it when you need the authoritative structural reference for a system.
Do not expect it to fix code, because it logs any code issue as a finding.

**Prerequisites and hand-offs.** It has no prerequisites. It seeds and links `adr` for the
full decision records, and `doc-alignment` keeps it true afterward.

### `/code-ops-suite:api-docs`
**Mode:** DOCUMENT

**How it works.** Three phases:

- **Phase 0** (checkpoint) detects the public surface, meaning HTTP routes, a GraphQL schema, RPC or gRPC services, or a library's exported API. It stops when there is no real external surface.
- **Phase 1** documents each operation, generated from the handlers and the types or schema rather than memory: signature, parameters, request and response shapes linking the type or schema `file:line`, auth and permissions, error responses and status codes, side effects, and rate limits.
- **Phase 2** makes it usable. It adds a "how to call it" orientation, one real example per common operation drawn from tests or call sites and never invented, and a Mermaid sequence diagram for any non-trivial multi-call flow.

It assembles per `§13`, with an executive summary, citations, and a SHA stamp.

**Produces** `API.md`, or one file per service.

**Why it's useful.** It produces an accurate interface reference an integrating engineer can
call correctly from the doc alone, with shapes drawn from the actual types and examples drawn
from actual call sites.

**When to use it.** Use it when a system exposes a real API surface that needs reference docs.
Do not force it where there is no external surface, because it self-scopes and stops.

**Prerequisites and hand-offs.** It has no prerequisites, and uses `current-docs` for
dependency facts. `doc-alignment` keeps it true afterward.

### `/code-ops-suite:data-model`
**Mode:** DOCUMENT

**How it works.** Four phases:

- **Phase 0** (checkpoint) finds the source of truth for data, meaning SQL migrations, ORM models, a schema file, or NoSQL document shapes. It stops when there is no persistent data model.
- **Phase 1** draws a Mermaid `erDiagram` of entities and relationships, with cardinality and foreign-key direction, split into domain clusters when it is large.
- **Phase 2** documents each entity from the cited schema: fields and types, keys and indexes, constraints, relationships, and the invariants the code relies on, such as uniqueness, soft delete, ownership, and retention. Those invariants are what the raw schema does not show.
- **Phase 3** covers schema evolution through migration history, the data lifecycle, and any denormalization or derived data.

It assembles per `§13`, with an executive summary, schema and migration citations, and a SHA
stamp.

**Produces** `DATA-MODEL.md`.

**Why it's useful.** It lets an engineer safely write a query or a migration from the doc,
because it surfaces the non-obvious invariants the code depends on, which a raw schema dump
never shows.

**When to use it.** Use it when a system has a persistent data model worth documenting. Do not
force it where there is no data model, because it self-scopes and stops.

**Prerequisites and hand-offs.** It has no prerequisites. `doc-alignment` keeps it true
afterward.

### `/code-ops-suite:adr`
**Mode:** DOCUMENT

**How it works.** It runs in one of two modes, confirmed at the start. Backfill mines the code,
version-control history, and existing docs for the load-bearing decisions already made, and
writes an evidence-grounded ADR for each one that clears the admission gate. New authors an ADR
for a decision being made now, with options and a recommendation.

Each ADR follows the standard form of `NNNN-title`, Status, Context, Options considered with
honest trade-offs, Decision, and Consequences. It cites the code and commits that embody the
decision, one ADR per choice.

An admission gate applies in both modes. A decision earns an ADR only when it is hard to
reverse, surprising without context, and the result of a real trade-off. A candidate failing
any prong is routed to a named destination instead of being written up: a code comment, the
repo's existing docs surface, or a CHANGELOG line.

It maintains a `code-ops-docs/20 Decisions/ADRs/README.md` index, ranks backfilled records by
how load-bearing they are, and marks reconstructed rationale `UNVERIFIED` where history is
silent.

**Produces** numbered ADRs in `code-ops-docs/20 Decisions/ADRs/`, matching any existing ADR
convention.

**Why it's useful.** It captures the reasoning behind the architecture, meaning the "why is it
this way?" choices a newcomer hits. A decision's true context, the options actually weighed,
and the honest consequences survive past the people who made them.

**When to use it.** Use it when you need to backfill the load-bearing past decisions or record
a current one. It pairs with `architecture`, which seeds and links it. Do not use it to
document structure or interfaces, which are `architecture` and `api-docs`.

**Prerequisites and hand-offs.** It has no prerequisites, and uses version-control history when
available. It is linked from `architecture`, and `doc-alignment` keeps it true afterward.

### `/code-ops-suite:ops-docs`
**Mode:** DOCUMENT

**How it works.** Five phases:

- **Phase 0** (checkpoint) detects the operational surface: Dockerfiles and compose files, CI/CD workflows, infrastructure, deploy scripts, config and environment, health checks, and dashboards and alerts.
- **Phase 1** documents the real deploy path cited from the CI and the scripts, the rollback, and the preconditions, with a Mermaid pipeline flow where that helps.
- **Phase 2** is the configuration reference: the environment and config the system actually reads, what each does, the safe defaults, and the secrets named but never valued, written as `<REDACTED>`.
- **Phase 3** gives incident runbooks from symptom to diagnosis to fix, with exact commands, grounded in real failure paths.
- **Phase 4** covers health and observability.

It assembles per `§13`, with an executive summary covering how it deploys, where it runs, and
the top three things that break with a first response. It carries citations, redacted secrets,
and a SHA stamp.

**Produces** `RUNBOOK.md`, and other ops docs where they fit.

**Why it's useful.** It lets a senior engineer who has never operated the system deploy it,
roll it back, change config, and work the top incidents from the doc alone. Every step is
grounded in the real scripts and config, with no secret values present.

**When to use it.** Use it when a system needs an operator's runbook or on-call documentation.
Do not expect secret values in it, because they are named and redacted by rule (`§4`).

**Prerequisites and hand-offs.** It has no prerequisites. `doc-alignment` keeps it true
afterward.

### `/code-ops-suite:handoff`
**Mode:** DOCUMENT

**How it works.** Two directions, picked at the start.

Write applies when a long run is near a context limit, ending, or changing hands. It captures
the run's true state as `HANDOFF.md` in the dated artifact folder: the goal and the state of
play (phases complete, in flight, and not started, the automation level, and the operator
steering), every register and artifact path stamped `Verified-at: <sha>`, the decisions made
with the options rejected, the traps and dead ends (approaches that failed, and mistakes the
successor will be tempted to repeat), and the in-flight boundaries with `file:line` pointers
each carrying a verbatim Anchor. Before handing over, run `co scan redaction HANDOFF.md`. That
is the mechanical floor under the secrets rule, because a handoff travels further than a
register. The rule throughout is state, not instructions. Describe what is true, such as "the
leak gate is implemented, the register sweep is not started", and never what to do next.

Resume treats every claim as context to verify rather than fact to trust. It runs
`revalidate-register.mjs` on every named register and checks the anchored pointers, where a
`DRIFTED` pointer is stale state. It re-runs the deterministic baseline when the tree moved,
then re-plans from what verified, surfacing contradictions at a checkpoint instead of silently
re-deciding.

**Why it's useful.** Registers carry findings across phases, but nothing else carried
decisions, rejected approaches, and in-flight boundaries across a context limit. That is the
most valuable and least recoverable session state. A verifiable handoff turns "trust the
summary" into "check the anchors".

**When to use it.** Use it before a long run such as `everything`, `full-sweep`, or a big audit
hits a context limit, or before a session ends mid-run. On the other side, use it to resume
from a `HANDOFF.md` someone else, or an earlier session, wrote. Do not use it as a findings
store, because findings belong in the registers it points to.

**Prerequisites and hand-offs.** Write has no prerequisites. Resume expects the `HANDOFF.md`
plus whatever registers it names. It composes with every orchestrator, and the registers it
points at are kept fresh by `revalidate-register.mjs` (`§12`).

### `/code-ops-suite:atlas`
**Mode:** DOCUMENT

**How it works.** The atlas is a durable, per-repo cache of judgment. It lives at
`code-ops-docs/98 System/Atlas/`, with `atlas/` as the fallback, and holds `MANIFEST.json`,
`INBOX.md`, and one prose section per area.

A default stamp records `verifiedAt` plus a squash-safe `verifiedDigest` over the exact scope
declarations and tracked state. `check` trusts a matching digest, and uses `verifiedAt` only
for changed-path diagnostics. A mismatch or an unavailable digest is STALE. A legacy section
without a digest retains commit-diff behavior.

`stamp` also derives a section's claims from its `path:line` citations.
`check --claims-gate` exits 1 when a citation no longer sits on the code it names, so a section
that is fresh as a whole cannot carry a sentence that quietly stopped being true.
`scope <slug> --suggest` prints the depth-1 importers of a section's scope as a pathspec list
for `add --scope`, so a scope can follow a module boundary instead of a directory name, and it
writes nothing.

The modes are INIT, which scaffolds 4 to 10 scoped sections, REFRESH, which rewrites only STALE
sections, and CONSOLIDATE, which folds inbox observations. Stage scoped work before default
stamping. The tool rejects index ambiguity. `--at` is historical mode and clears the digest.
Only `atlas-check.mjs stamp` writes stamps.

**Why it's useful.** Every run on a repo re-derives the same understanding of it and then
throws that understanding away. The atlas banks it. Unlike a README, it says mechanically
whether each part is still true, so a FRESH section can be consumed without re-verification
while a STALE one is treated as a lead rather than a fact. See
[the atlas technique](../../Techniques/atlas.md).

**When to use it.** Use it on a repo the suite will work in repeatedly: once to INIT, then
whenever `check` reports STALE sections or the inbox has unfolded entries. Do not use it as a
file or API inventory, because those facts are re-derivable in seconds, rot fast, and are
explicitly out of a section's remit.

**Prerequisites and hand-offs.** It requires a git repo. `code-ops-suite:ship` refreshes
sections in the same session, while the change rationale is still recoverable.

---

### `/code-ops-suite:conform`
**Mode:** ASSESS then DOCUMENT

**How it works.** Three phases:

- **Phase A** assesses five standardization surfaces read-only, in dependency order, and records each as CONFORMANT, DRIFTED, ABSENT, or UNKNOWN with the checker output that decided it. Surface 1 is the repo's standards contract: the pair exists, matches an accepted parity mode, and carries the routing section. Surface 2 is the docs vault: `<repo>-docs/` exists and `check-vault-standard.mjs` exits 0. Surface 3 is the atlas: `code-ops-docs/98 System/Atlas/` exists, its manifest parses, and `atlas-check.mjs check` reports each section FRESH or STALE. Surface 4 is doc alignment, assessed only when the first three surfaced a drift signal. Surface 5 is the user's global contract, off by default and never touched without asking. The verdicts go to `CONFORMANCE_REPORT.md`, written to the vault's `80 Runs/` folder when the repo has a vault, and to its dated-docs convention when it does not.
- **Phase B** repairs the approved surfaces one at a time. It delegates each surface to the skill that owns it and checkpoints between them, because repairing one surface changes what the next one reads.
- **Phase C** re-runs every mechanical check and re-writes the report in place, one row per surface, with the opening verdict noted in that row's evidence cell.

Fleet mode turns on when the run is handed a `FLEET.json`, or when one sits at the invocation
root. A fleet run is the per-repo run performed member by member, under one report. The layout,
the manifest schema, and the consent rule live in
[the fleet standard](../../Techniques/fleet-standard.md).

**Why it's useful.** Each standardization surface already had a skill and a checker, but
nothing asked whether a repo carried any of them. A repo could pass one surface and fail three,
and that only surfaced later, when a run needed the artifact that was missing. This command
answers the whole question at once, and answers it mechanically rather than by reading.

**When to use it.** Use it on a repo the suite is about to work in for the first time, or one
that has not been checked since the standard moved. Assess-only is a complete run, and stopping
with the report in hand is a legitimate outcome. Do not expect it to implement any repair
itself, because every fix is delegated, so a surface it cannot delegate is reported rather than
improvised.

**Prerequisites and hand-offs.** It needs nothing beyond the repo. It composes
`adopt-standards`, `vault`, `atlas`, `doc-alignment`, and, opt-in, `adopt-global-standards`.
`code-ops-suite:everything` runs it assess-only inside phase 0, as its standardization
preflight. See [the skill-composition map](../../Techniques/skill-composition.md).

---

### `/code-ops-suite:vault`
**Mode:** DOCUMENT

**How it works.** The vault is the repository's complete authored documentation hub at
`<repo>-docs/`. Numbered folders make topic placement predictable. It runs in three modes:

- **SCAFFOLD** creates the hub, its self-contained `Standard.md`, the home note, the README, and the templates.
- **MIGRATE** separates ordinary authored documents from permanent historical records. It moves ordinary authored work into the hub. It adopts immutable records before any move, and freezes adopted `_archive` paths in place.
- **CHECK** runs the vault, manifest, and applicable record checks. An existing evidence failure takes precedence over `pending-admission`. A committed immutable path uses `plan-adoption --incremental`, while a new staged native record uses `append`.

Collections remain open after genesis. Inventory v3 gives every authority object one
`genesis-adoption`, `incremental-adoption`, `native-append`, or `v2-migration` batch. That
membership chain remains separate from the curation ledger.

**Why it's useful.** One layout across every repo means an agent that has never opened this
vault can still predict where a note goes and what its frontmatter says. Vault behavior stops
being a per-repo thing each run relearns. See
[the vault standard](../../Techniques/vault-standard.md).

**When to use it.** Use it to create or migrate a documentation hub, check conformance, or
admit committed evidence into an existing collection. Do not move a governed record for
archival. Use curation and a canonical hub document instead.

**Prerequisites and hand-offs.** It needs nothing beyond the repo itself.
`code-ops-suite:adopt-standards` owns the `CLAUDE.md` and `AGENTS.md` contract that routes
agents to the vault's `Standard.md`. Run it after a SCAFFOLD or MIGRATE, rather than editing
the contract from the vault skill.

---

## Meta and suite self-audit

### `/code-ops-suite:calibration-run`
**Mode:** ASSESS

**How it works.** Five phases:

- **Phase 0** (checkpoint) confirms the target repo, that the session is a fresh isolated context, that the run is `assess-only`, and the one-way channel rule, where only a sanitized note returns (`code-ops-docs/40 Engineering/Techniques/calibration-protocol.md`). It runs `preflight.mjs`.
- **Phase 1** runs the atlas leg with `atlas-check.mjs check`, or `init` when the target keeps no atlas. It hands each section's FRESH or STALE state into the sweep briefs, then dispatches `full-sweep`, or `rigor:rigor-sweep`, in the `assess-only` track against the target, letting it run its own phases and checkpoints.
- **Phase 2** extracts the quality, token, orchestration, and standardization metrics with `calibration-metrics.mjs --artifacts`.
- **Phase 3** fills the sanitized-note template from the extracted metrics, meaning counts, deltas against the prior table row, and lessons, with zero paths, code, or URLs. It validates the note fail-closed with `calibration-metrics.mjs --validate-note`.
- **Phase 4** gates the note, ingests it into the calibration store under `evals/calibration/`, re-renders `evals/CALIBRATION_TABLE.md` from the store, and validates the graph.

**Why it's useful.** It standardizes what would otherwise be an ad-hoc calibration run. It
enforces the one-way channel mechanically, rather than relying on the operator to remember not
to quote the target's internals back.

**When to use it.** Use it when you want a real-scale calibration of the suite against an
actual codebase. Do not use it for the small in-repo eval fixtures, which score with
`evals/score.mjs` directly.

**Prerequisites and hand-offs.** It requires a target repo and an isolated session. It feeds a
validated row into `evals/CALIBRATION_TABLE.md`.

### `/code-ops-suite:run-cost-audit`
**Mode:** ASSESS

**How it works.** Three phases:

- **Phase 0** collects raw counts from `calibration-metrics.mjs --artifacts`, and dispatch, failure, and redispatch rates from `dispatch-ledger.mjs check`.
- **Phase 1** assesses the run against doctrine on three axes: bounded-wave discipline (`§1`) from the ledger's per-wave dispatch counts, artifact-size bounds (`§12`) through `co scan narration` over the run's summaries, and the tier and effort mix against the routing table in `code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md`.
- **Phase 2** writes `COST_AUDIT.md` of one page or less: the top three cost drivers, each with a concrete routing or bounding recommendation cited to a ledger row or an artifact.

**Why it's useful.** It turns "this run felt expensive" into a cited, ranked list of what
actually drove the cost, with a concrete fix, instead of a vague impression.

**When to use it.** Use it after a large orchestrated run, to check whether its dispatch, tier,
and effort choices matched the suite's own doctrine. Do not use it on a live run, because it
consumes a completed artifact folder.

**Prerequisites and hand-offs.** It requires a completed run's artifact folder, meaning the
registers, `DISPATCH_LEDGER.md`, and `EXECUTIVE_SUMMARY.md`. It produces `COST_AUDIT.md`
standalone.

### `/code-ops-suite:provider-parity-audit`
**Mode:** ASSESS

**How it works.** Three phases:

- **Phase 0** dispatches an `explorer` operative to inventory provider-coupled prose across `plugins/*/skills/*/SKILL.md`, every plugin's `CONVENTIONS.md`, and the documentation hub. That covers named harness mechanics, literal tool names, and host-specific invocation phrasing, returned as `file:line` hits rather than rewritten files.
- **Phase 1** classifies each hit as reconciled in the derived Codex render and therefore not a finding, as needing generic rewording, or as intentionally provider-specific with the reason documented.
- **Phase 2** writes the needs-rewording hits into `FINDINGS_REGISTER.md` in the finding schema (`§7`), tracked NOW-SAFE or NEEDS-REVIEW. Intentionally provider-specific hits are recorded as accepted-as-is, so a later pass does not re-flag them.

**Why it's useful.** `build-codex-marketplace.mjs --check` already guarantees the mechanical
render is correct. This command checks the prose that quietly assumes only one host exists,
which the render check cannot see.

**When to use it.** Run it periodically, or after a batch of skill and doc edits, to keep the
marketplace's prose honestly cross-host. Do not expect it to touch the derived Codex render,
which is the build script's job.

**Prerequisites and hand-offs.** It has no prerequisites. It feeds `FINDINGS_REGISTER.md` to
`remediation` for the needs-rewording items.

---

## Orchestrators

Orchestrators do not replace the individual skills. They run them in a sensible order, carry
the shared registers forward fresh, maintain a master plan, and check in with you at every
phase boundary.

### `/code-ops-suite:full-sweep`
**Mode:** orchestrator

**How it works.** It is the intra-plugin pipeline. Phase 0 (checkpoint) scopes the run, meaning
the track (`assess-only`, `full`, or a custom subset), the scope, the risk tolerance, the PR
preference, and the automation level (`§4`). It compiles the objective, quality vector, budget,
work graph, routing, and scopes into `RUN_CONTRACT.json`. It opens a master todo and a running
`EXECUTIVE_SUMMARY.md`, carrying registers forward fresh (`§12`). Each later wave reconciles the
contract against `DISPATCH_LEDGER.md`, and a declared learning trigger produces a new contract
revision.

The phases run in order:

- **1 Ground truth**: `doc-alignment`.
- **2 Assess**: `codebase-audit`, then `security-privacy-audit`, with findings evidence-tiered and disconfirmed, merged into `FINDINGS_REGISTER.md`.
- **3 Safety net**: `test-hardening`.
- **4 Fix**: `remediation`, re-validating the register first.
- **5 Deep dives**: `performance` and `dependency-upgrade`.
- **6 Consistency**: `normalize`.
- **7 Document**: `doc-alignment`, then the generators `architecture`, `data-model`, `api-docs`, `ops-docs`, `adr`, and `onboarding`, each self-scoping.
- **8 Ship**: `pr-split`.

A separate feature track, `/code-ops-suite:full-sweep feature`, runs `feature-discovery`, then
`feature-implementation`, then `pr-review`, then `pr-split`. Finalization writes
`RUN_CONTRACT_RESULT.json` only after every blocking criterion is accepted with replayable
proof. Checkpoints remain at every phase boundary, and nothing code-changing happens without
your approval.

**Why it's useful.** It runs the whole code-ops-suite end to end as one coherent, checkpointed
pipeline, from assess to safety-net to fix to polish to document. It carries the registers
forward, so nothing already fixed is re-shown.

**When to use it.** Use it when you want the whole suite on one codebase as a guided pipeline.
Do not reach for it when you want the cross-plugin superset with rigor's verification layer and
the privacy track, which is `everything`.

**Sibling disambiguation, `full-sweep` (intra-plugin) against `everything` (cross-plugin).**
`full-sweep` orchestrates only code-ops-suite skills. It needs nothing else installed and is
the right default for a thorough single-plugin pass. `everything` is the superset across all
three plugins. It weaves in rigor's verification methodology, meaning evidence tiers,
disconfirmation, and the regression guard, plus the privacy-opsec anonymity track, and it
requires `rigor` and `privacy-opsec-suite` installed. `everything` is deliberately the most
thorough and most token-expensive option, and `full-sweep` is the lighter, self-contained one.

**Prerequisites and hand-offs.** It requires no external plugins, and uses `rigor:ground-truth`
only inside the `pr-split` ship phase, when `rigor` is installed. It orchestrates the full
code-ops-suite, and ends by shipping with `pr-split`.

### `/code-ops-suite:everything`
**Mode:** orchestrator

**How it works.** It is the cross-plugin superset. Phase 0 (checkpoint) confirms all three
plugins are available and sets the scope, whether the privacy track is included, the
remediation automation level (code-ops `§4` applied with rigor's tier gate), and the check-in
level. It opens the master registers (`FINDINGS_REGISTER.md`, `CONSISTENCY_REGISTER.md`, and
`LEAK_REGISTER.md` when privacy is in scope), a running `EXECUTIVE_SUMMARY.md`, and a growing
proof set. It also runs `conform` assess-only as its standardization preflight.

The phases run in order:

- **1 Map**: code-ops `doc-alignment`, then `codebase-audit`, then `security-privacy-audit`.
- **2 Ground truth and test trust**: rigor `ground-truth`, then `test-suite-audit`.
- **3 Prove**: rigor `bug-hunt`, `quality-scan`, and `regression-hunt`.
- **4 Anonymity and leak audits**: privacy-opsec `anonymity-threat-model`, then the six leak audits into `LEAK_REGISTER.md`, when in scope.
- **5 Safety net**: rigor `safety-net`.
- **6 Consolidated review**: the main go or no-go checkpoint.
- **7 Remediate**: rigor `fix-verified`, code-ops `remediation`, and privacy-opsec `opsec-hardening`.
- **8 Close inconsistencies**: rigor `consistency-closure`.
- **9 Improve**: rigor `improve-measured`, code-ops `performance`, and `dependency-upgrade`.
- **10 Normalize and document**: code-ops `normalize` plus the doc generators.
- **11 Final verification, report, and ship**: `pr-split` with `authorship-hygiene`.

CONFIRMED stays separated from PROBABLE and SPECULATIVE throughout, and it never auto-merges.

**Why it's useful.** It is the most exhaustive end-to-end pass available: map, prove, leak
audit, safety net, remediate, close, improve, normalize, document. It applies each plugin's
governing methodology in the right order, deduplicated, with one growing proof set.

**When to use it.** Use it when you want the deepest possible pass and accept the token cost.
It is phased with checkpoints rather than a blind firehose, so you can widen or narrow scope at
Phase 0. Do not reach for it for a single-plugin pass, which is `full-sweep`, or for a single
change, which is `ship`.

**Prerequisites and hand-offs.** It requires `code-ops-suite`, `rigor`, and
`privacy-opsec-suite` all installed. It loads each plugin's `CONVENTIONS.md` so every phase
applies its governing methodology. Final diffs route through `local-review-gate` when the
operator opted in, and ship through `pr-split`.

### `/code-ops-suite:ship`
**Mode:** orchestrator

**How it works.** It implements one change, a feature or a one-off, end to end. It scales each
phase to the change, so a one-off is light and a feature gets the full treatment:

- **Phase 0** (checkpoint) detects the stack, runs `/rigor:ground-truth` for the baseline, sizes the change, confirms the approach for a feature, and sets the automation level.
- **Phase 1** runs `/rigor:safety-net` when the change touches thin-coverage code.
- **Phase 2** implements through the implementation loop (`§11`) at the smallest correct scope.
- **Phase 3** proves it: tests that fail before and pass after, the full suite green, and the regression guard (`rigor §H`).
- **Phase 4** is the privacy gate when the change touches a privacy surface.
- **Phase 5** commits the final diff, runs the deterministic gate chain, and reads the diff. It runs `local-review-gate` for local deep and OpSec review only when the Phase 0 answer was yes. It finishes traceless, pushes the branch, publishes the SHA-bound local statuses when those gates ran, and only then opens the PR. Hosted CI runs deterministic checks and is the required merge gate.

When the repo carries an atlas, Phase 5 also closes the loop on it. It runs
`atlas-check.mjs check`, then refreshes and stamps any section this change turned STALE, in the
same session. When a full section rewrite is out of scope, it appends the observation with the
`inbox` subcommand and leaves the section STALE.

It never auto-merges.

**Why it's useful.** It takes a single intent to a proven, behavior-preserving,
privacy-checked, trace-free PR, at full rigor, without you orchestrating the phases by hand.

**When to use it.** Use it when you want to implement one change end to end at high quality.
See the disambiguation below for `ship` against `debug` against `feature-implementation`.

**Sibling disambiguation, `ship` against `debug` against `feature-implementation`.** `ship`
implements one new change, a feature or a one-off, end to end with proof and a traceless
finish. `debug` starts from a symptom and drives reproduce, isolate, root-cause,
fix-with-regression-proof, and traceless ship. Reach for `debug` when something is broken,
rather than when you are adding capability. `feature-implementation` builds a set of
already-specified features incrementally from `feature-discovery` specs. It is the batch
builder, where `ship` is the single-change end-to-end driver.

**Prerequisites and hand-offs.** It requires `rigor`, and `privacy-opsec-suite` when the change
touches a privacy surface. It composes `rigor` for the safety net, the proof, and the
regression guard, the privacy leak gate, `local-review-gate` only when the operator opted in at
Phase 0, and `pr-split` and `authorship-hygiene` for the finish.

### `/code-ops-suite:debug`
**Mode:** orchestrator

**How it works.** It drives a bug from symptom to a proven root-cause fix:

- **Phase 0** (checkpoint) captures the symptom, runs `/rigor:ground-truth`, and uses rigor's verifier to build a reliable reproduction. When it cannot be reproduced, it stops and reports exactly what is needed rather than guessing a fix.
- **Phase 1** isolates. It traces the control and data path with rigor's tracer, derives the invariants, narrows to the smallest triggering path, and runs `/rigor:regression-hunt` to bisect when it is a regression.
- **Phase 2** (checkpoint) identifies the real cause at the correct layer, not the nearest symptom, cited at `file:line`, with a disconfirmation pass. It gets a go before editing.
- **Phase 3** runs the `rigor:fix-verified` loop. The reproduction passes, the suite is green, the regression guard holds, siblings are swept, and an enforcement is added so the class cannot recur. When the fix keeps cascading into new findings, the cascade circuit-breaker (`§11`) stops the loop and escalates as NEEDS-DESIGN.
- **Phase 4** is the privacy gate, when it applies.
- **Phase 5** finishes traceless through `authorship-hygiene` and `pr-split`, with `co scan ai-tells` fail-closed.

It never auto-merges.

**Why it's useful.** It refuses to guess. It reproduces first, fixes at root cause with a
regression test that failed before and passes now, sweeps for siblings, and enforces against
recurrence, so a fixed bug stays fixed.

**When to use it.** Use it when you have a bug symptom, meaning an error, a stack trace, or
wrong behavior, to drive to a proven fix. Do not use it to add capability, which is `ship`, or
when you cannot yet produce a reproduction, because it will stop and ask for what is needed.

**Prerequisites and hand-offs.** It requires `rigor`, meaning the verifier, the tracer,
`regression-hunt`, and `fix-verified`. The privacy phase runs only when
`privacy-opsec-suite` is installed and the fix touches a privacy surface. It finishes through
`pr-split` and `authorship-hygiene`.

---

*Verified-at: b0ffede*
