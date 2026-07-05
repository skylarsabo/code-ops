# code-ops-suite — Command Reference

The **code-ops-suite** plugin is the spine of the marketplace: broad-breadth engineering workflows for any codebase, packaged as 23 namespaced skills you invoke as `/code-ops-suite:<name>`. Every skill reads the shared [`CONVENTIONS.md`](../../../plugins/code-ops-suite/CONVENTIONS.md) first — the backbone that defines the operating model, the developer-in-the-loop interaction protocol, the safety rails (branch, tests-green, redact secrets, never fabricate), the modes, the finding/fix tracks, the schemas, the severity taxonomy, the quality lenses, the implementation loop, and the single-source-of-truth conventions. All skills are manual-invoke (`disable-model-invocation: true`) because they are deliberate operations. This page is the complete reference: one entry per skill, grouped by what it does, with the orchestrators last.

A quick orientation for newcomers: the suite has three shapes of work. **Assess** skills read the code and write a ranked backlog. **Build** skills implement against that backlog or against specs. **Document** skills generate beautiful, code-grounded reference docs. Four **orchestrators** chain the others into one developer-in-the-loop pipeline. The thread that ties everything together is the **register** — a live backlog with stable IDs (`SEC-003`, `PERF-007`, `FEAT-012`) that flows discovery → register → commit/PR → log, kept fresh with `Verified-at: <sha>` stamps and the `revalidate-register.mjs` freshness check.

## Index

**Assess (AUDIT / DISCOVERY)**
- [`codebase-audit`](#code-ops-suitecodebase-audit) — broad multi-lens review; ranked findings backlog
- [`security-privacy-audit`](#code-ops-suitesecurity-privacy-audit) — adversarial STRIDE + LINDDUN threat assessment
- [`feature-discovery`](#code-ops-suitefeature-discovery) — grounded, ranked feature ideas + specs

**Build (IMPLEMENT)**
- [`remediation`](#code-ops-suiteremediation) — implement the findings backlog with tests
- [`feature-implementation`](#code-ops-suitefeature-implementation) — build specified features, slice-first, behind flags
- [`performance`](#code-ops-suiteperformance) — measure, optimize what's proven hot, prove it
- [`test-hardening`](#code-ops-suitetest-hardening) — meaningful, deterministic coverage on critical paths
- [`dependency-upgrade`](#code-ops-suitedependency-upgrade) — safe, staged upgrades + CVE remediation
- [`normalize`](#code-ops-suitenormalize) — one consistent, behavior-preserving house style
- [`pr-split`](#code-ops-suitepr-split) — carve a big branch into a clean, traceless stack

**Review (REVIEW)**
- [`pr-review`](#code-ops-suitepr-review) — rigorous pre-merge review against all lenses

**Document (DOCUMENT)**
- [`doc-alignment`](#code-ops-suitedoc-alignment) — reconcile doc drift; establish the SSOT
- [`onboarding`](#code-ops-suiteonboarding) — verified orientation guide with a diagram
- [`current-docs`](#code-ops-suitecurrent-docs) — version-accurate library docs, in-house
- [`architecture`](#code-ops-suitearchitecture) — deep C4 architecture reference
- [`api-docs`](#code-ops-suiteapi-docs) — accurate interface reference
- [`data-model`](#code-ops-suitedata-model) — ER diagram + per-entity invariants
- [`adr`](#code-ops-suiteadr) — architecture decision records
- [`ops-docs`](#code-ops-suiteops-docs) — the operator's runbook

**Orchestrators**
- [`full-sweep`](#code-ops-suitefull-sweep) — the whole suite end-to-end (intra-plugin)
- [`everything`](#code-ops-suiteeverything) — the cross-plugin superset (all three plugins)
- [`ship`](#code-ops-suiteship) — implement one change end-to-end at full rigor
- [`debug`](#code-ops-suitedebug) — drive a bug from symptom to proven root-cause fix

---

## Assess

### `/code-ops-suite:codebase-audit`
**Mode:** AUDIT

**How it works.** Phase 0 (checkpoint) detects the stack and tooling, builds the real service/module inventory, captures the build/test/lint baseline, and opens a coverage ledger (every area × every applicable lens). Phase 1 runs the adaptive loop (`CONVENTIONS §1`): sub-agents apply the relevant quality lenses (`§10`) to disjoint slices and return findings in the finding schema (`§7`), classified by track (`§6`). It applies only confirmed **NOW-SAFE** fixes (with your OK per batch) via the implementation loop (`§11`), logging each. Produces `FINDINGS_REGISTER.md` (the authoritative backlog), `REMEDIATION_LOG.md` (applied fixes), `FEATURE_OPPORTUNITIES.md` (opportunities noticed in passing), and `EXECUTIVE_SUMMARY.md`, under a dated audit folder. Critical findings surface to you immediately.

**Why it's useful.** It turns an unfamiliar or drifting codebase into a ranked, evidence-backed backlog you can act on cold — every finding cites `file:line`, states impact, and ends with a concrete recommendation, led by a "top N highest-value."

**When to use it.** Reach for it on an unfamiliar inheritance, before a big push, or on a periodic health pass. It pays particular attention to modularity, performance, intricate correctness bugs, security, privacy/data handling, and (for UIs) styling/theming/a11y. Do **not** use it when you already have a register and just want it implemented (use `remediation`), nor when you want a deep adversarial security model (use `security-privacy-audit`).

**Sibling disambiguation — `codebase-audit` vs `rigor:bug-hunt`.** `codebase-audit` is breadth: every module against every lens, static evidence acceptable, a wide backlog. `rigor:bug-hunt` is depth-with-proof: it goes deep per subsystem, requires a runnable reproduction before flagging, and emphasizes root cause plus a sibling sweep. Use `codebase-audit` to map the field; use `rigor:bug-hunt` to nail a specific class of defect to the floor.

**Prerequisites & hand-offs.** No prerequisites beyond the plugin. Feeds `FINDINGS_REGISTER.md` → `remediation`; its `FEATURE_OPPORTUNITIES.md` → `feature-discovery`; routes the security lens depth-out to `security-privacy-audit`.

### `/code-ops-suite:security-privacy-audit`
**Mode:** AUDIT

**How it works.** Phase 0 (checkpoint) maps the attack and data surface: every entry point, input, deserialization, upload, auth boundary, admin/debug surface, and client code; defines trust boundaries and the relevant adversaries (external attacker, passive/active network observer, malicious/compromised operator, legal/subpoena demand, malicious peer, supply-chain attacker); and builds a data-flow map for personal/sensitive data. Phase 1 fans out per surface and threat class: **STRIDE** for security (plus crypto/transport, config/headers/CORS/cookies, and a deep dependency-CVE pass with lockfile integrity) and **LINDDUN** for privacy, scaled to data sensitivity, plus the insider and legal threat. Findings use the schema (`§7`) augmented with threat class, exploitability, adversary, and a conceptual attack/leak scenario. It applies only trivial, obviously-safe hardening with your OK. Produces `THREAT_MODEL.md` (a durable, reusable artifact), `SECURITY_PRIVACY_FINDINGS.md`, and `EXECUTIVE_SUMMARY.md`; routes NEEDS-REVIEW/NEEDS-DESIGN items into `FINDINGS_REGISTER.md`.

**Why it's useful.** It thinks like an attacker auditing your own system to harden it — deeper than the audit's single security lens — and leaves a reusable threat model plus a fix-first list ranked by severity × exploitability. The work is defensive: findings describe vulnerabilities and their fixes, never weaponized exploits.

**When to use it.** Before exposing a new surface, after a security-relevant change, on a recurring schedule, or whenever the system handles personal/sensitive data. Do **not** reach for it for anonymity-specific egress/metadata/fingerprint work — that is the privacy-opsec-suite anonymity track.

**Sibling disambiguation — `security-privacy-audit` vs `privacy-opsec-suite:anonymity-threat-model`.** This skill is a general STRIDE + LINDDUN assessment for any system, scaling its privacy depth to how much sensitive data the system handles. `privacy-opsec-suite:anonymity-threat-model` is the keystone of the anonymity track — it presumes the project has explicit anonymity/opsec requirements and seeds six parallel leak audits feeding a `LEAK_REGISTER.md`. Use this skill for "is my system secure and privacy-respecting?"; use the anonymity threat model for "can an adversary deanonymize a user of this system?".

**Prerequisites & hand-offs.** No prerequisites. Feeds `FINDINGS_REGISTER.md` → `remediation`; `THREAT_MODEL.md` is consumed by ongoing security work and the privacy-opsec track where applicable.

### `/code-ops-suite:feature-discovery`
**Mode:** DISCOVERY

**How it works.** Phase 0 (checkpoint) detects latent capabilities, maps the current feature set and main user flows, infers product intent and target users, and harvests intent signals (TODOs, disabled flags, stubbed endpoints, dead routes, and recurring demand from VCS history). Phase 1 fans out across discovery lenses × product areas — latent capability, half-built/abandoned, UX friction, workflow completion, power-user/automation, onboarding/activation, configurability, extensibility, performance-as-feature, accessibility, trust/transparency/control, category parity — producing ideas in the idea schema (`§7`). Phase 2 (checkpoint) scores ideas (impact × reach ÷ effort, weighted by confidence; `§8`), tags quick wins and big bets, defines the smallest valuable slice, and writes a mini-spec per chosen feature. Produces `FEATURE_OPPORTUNITIES.md`, the chosen mini-specs (`TOP_FEATURES.md` or `specs/`), `FEATURE_ROADMAP.md` (Now/Next/Later), and `EXECUTIVE_SUMMARY.md`. No code changes.

**Why it's useful.** It mines high-value, grounded feature ideas from what the codebase can already cheaply do — not a generic wishlist — and hands implementation-ready specs to the build track.

**When to use it.** At planning time, when looking for high-leverage work, or to turn the audit's `FEATURE_OPPORTUNITIES.md` into real specs. Do **not** use it to build features (that is `feature-implementation`) — it writes no code.

**Prerequisites & hand-offs.** No prerequisites; can ingest `codebase-audit`'s `FEATURE_OPPORTUNITIES.md`. Feeds its mini-specs + roadmap → `feature-implementation`.

---

## Build

### `/code-ops-suite:remediation`
**Mode:** IMPLEMENT

**How it works.** Phase 0 (checkpoint) reads `FINDINGS_REGISTER.md` and **re-validates first** (`§12`): it runs `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .`, triages its FRESH / MOVED / DRIFTED / GONE / AMBIGUOUS / NO-REF report, drops anything already-fixed or obsolete (marking it `OBSOLETE-AT <sha>`), then builds a dependency + conflict graph (disjoint → parallel, coupled → serial), sequencing by value × risk. Phase 1 runs each item through the implementation loop (`§11`); NEEDS-REVIEW items change behavior by definition, so it confirms the intended new behavior and pins it with tests, and integrates continuously, re-running the full suite after each batch. NEEDS-DESIGN items get their options presented for a direction first. Produces verified fixes (atomic branches/PRs), an updated `FINDINGS_REGISTER.md`, and `IMPLEMENTATION_LOG.md`; updates docs wherever behavior changed.

**Why it's useful.** It is the disciplined executor of a backlog — implementing findings efficiently and at high quality without re-introducing the problems the audit found, and never re-listing items already fixed in code.

**When to use it.** When a `FINDINGS_REGISTER.md` already exists (from `codebase-audit`, `security-privacy-audit`, or the deep-dives) and you want it implemented safely. Do **not** use it without a register — it consumes one as input.

**Prerequisites & hand-offs.** Requires a `FINDINGS_REGISTER.md`. Consumes the register's NEEDS-REVIEW + NEEDS-DESIGN items; feeds its PRs → `pr-review`.

### `/code-ops-suite:feature-implementation`
**Mode:** IMPLEMENT

**How it works.** Phase 0 (checkpoint) reads the specs, register, and roadmap, re-grounds each feature against current code, and drafts a build plan honoring dependencies — confirming which features, in what order, slice boundaries, flag strategy, and PR preference, and batch-answering each spec's open questions. Phase 1 builds the smallest valuable slice first, runs the implementation loop (`§11`), lands features behind flags where it reduces risk, builds real states (loading/empty/error/success, edge and unhappy paths), reuses existing services per the spec's "builds-on," asserts acceptance criteria, and re-checks the privacy posture on the actual implementation. Produces shipped features (flagged PRs), an updated `FEATURE_OPPORTUNITIES.md`, and `BUILD_LOG.md`; updates docs for everything shipped.

**Why it's useful.** It builds specified features incrementally and safely, matching the repo's conventions and verifying acceptance criteria — turning specs into shipped, tested, flag-guarded code.

**When to use it.** When feature specs already exist (from `feature-discovery`). Do **not** use it for unspecified ideas (run `feature-discovery` first) or for a single ad-hoc change end-to-end (use `ship`).

**Prerequisites & hand-offs.** Requires feature specs (+ `FEATURE_OPPORTUNITIES.md` + `FEATURE_ROADMAP.md`). Feeds its PRs → `pr-review`.

### `/code-ops-suite:performance`
**Mode:** IMPLEMENT

**How it works.** Its prime directive is **measure first** — never optimize code not demonstrated to be hot. Phase 0 (checkpoint) identifies the perf-critical paths, sets up repeatable profiling + benchmarks, captures baseline numbers, and ranks hot spots by actual cost. Phase 1 fans out per hot path: where profiling points, it reduces algorithmic complexity, fixes data access (N+1, indexes with your OK, batching, caching with correct invalidation), concurrency, memory/allocation, payload size, frontend (code-split, trim deps, render thrash), and build/CI. Every optimization is confirmed hot → smallest change → benchmark before/after → tests green → commit with the delta; if a change doesn't move the number, it is reverted. Produces optimizations (each commit carrying before/after numbers) and `PERFORMANCE_REPORT.md`; remaining design/behavior-changing opportunities go to `FINDINGS_REGISTER.md`.

**Why it's useful.** It delivers proven speedups, not speculative ones — and documents tempting-but-cold targets as "not worth it, here's the data," so you stop chasing them.

**When to use it.** When something is measurably slow and you want hot paths optimized with proof. Do **not** use it for broad behavior-preserving cleanups with measured wins across the board — that is `rigor:improve-measured`.

**Sibling disambiguation — `performance` vs `rigor:improve-measured`.** `code-ops-suite:performance` targets a specific slow surface: profile it, optimize the proven-hot path, prove the delta. `rigor:improve-measured` is the verification layer's broad measured-improvement pass — it only ships changes that carry a measured before→after delta and is behavior-preserving across whatever it touches. Reach for `performance` when you have a hot spot in mind; reach for `improve-measured` for a disciplined, evidence-gated improvement sweep.

**Prerequisites & hand-offs.** No prerequisites; can ingest audit perf findings as leads. Feeds residual opportunities → `FINDINGS_REGISTER.md`.

### `/code-ops-suite:test-hardening`
**Mode:** IMPLEMENT

**How it works.** Phase 0 (checkpoint) detects the frameworks/runners, baselines pass/fail, coverage and run time, identifies flaky tests (running the suite a few times), and ranks targets by risk × importance. Phase 1 fans out per area writing behavior-focused, deterministic, meaningful tests across happy/edge/boundary/error paths, with special passes for characterization tests (pinning current behavior before refactors), regression tests, and security/privacy-path tests; flaky tests are fixed at the root, never retry-wrapped. A **hard rule** holds throughout: never change product code to make a test pass — if a test exposes a bug, write a failing/skipped test documenting it and log a finding. Produces committed tests and `TEST_COVERAGE_REPORT.md`; bugs exposed go to `FINDINGS_REGISTER.md`.

**Why it's useful.** It raises *meaningful* coverage where it matters — tests that assert behavior and would catch real regressions — and provides the characterization safety net that makes later refactors provably behavior-preserving.

**When to use it.** When critical paths lack coverage, tests are flaky, or before a risky refactor. Do **not** use it to judge whether your existing tests actually catch faults — that is `rigor:test-suite-audit` (mutation/assertion strength).

**Prerequisites & hand-offs.** No prerequisites; ingests audit under-test flags. Provides the characterization net consumed by `remediation`/`normalize`; logged bugs → `FINDINGS_REGISTER.md`.

### `/code-ops-suite:dependency-upgrade`
**Mode:** IMPLEMENT

**How it works.** Phase 0 (checkpoint) catalogues direct vs transitive deps, current vs latest, deprecated/EOL, duplicates, known CVEs with severity, unused deps, licenses, and lockfile state, then prioritizes (CVEs → deprecated/EOL → valuable majors → routine minors → dedup/removal) and asks you to approve or defer the majors. Phase 1 upgrades one branch/PR per item: read the changelog/migration guide → for majors get your go-ahead and plan the migration → apply the bump + code changes → run the full suite, build, typecheck/lint → exercise UI-affecting libs → commit/PR with the version delta, breaking changes handled, and CVE refs. It flags any dependency that adds telemetry, phones home, or changes the egress/trust surface as a developer decision, and **never bulk-bumps**. Produces verified upgrade PRs, `DEPENDENCY_REPORT.md`, and a clean lockfile.

**Why it's useful.** It brings dependencies current *safely* — each change isolated, changelog-checked, and individually verified — closing CVEs without the "bump everything and pray" failure mode.

**When to use it.** When dependencies are outdated or have known CVEs and you want staged, verified upgrades; good on a recurring schedule. Do **not** use it to bulk-bump everything at once — it deliberately refuses that.

**Prerequisites & hand-offs.** No prerequisites; ingests audit deps findings. Feeds residual items back to the register.

### `/code-ops-suite:normalize`
**Mode:** IMPLEMENT (behavior-preserving)

**How it works.** Phase 0 (required checkpoint) detects tooling, derives the house style from the codebase's dominant patterns, inventories the "tells" of hasty/generated code, the inconsistencies, and the modularization opportunities, and baselines tests/build/lint/coverage — capturing the ratified standard in `STYLE_GUIDE.md`. A "tells" checklist drives the hunt: narration comments, tutorial voice, placeholder/disclaimer comments, emoji, inflated prose, debug residue, generic names, over-defensive ceremony, over-engineered indirection, section-divider mega-functions, commented-out code, and inconsistent terminology. Phase 1 fans out conflict-aware across nine workstreams (style/formatting, naming, comments, dead-code removal, standardizing recurring operations, modularization, method clarity, README/docs, VCS history), committing in reviewable logical chunks, and finishing with a hostile-reviewer pass. **Behavior preservation is absolute** — tests green at every step; where coverage is thin, characterization tests come first. Produces the normalized codebase, `STYLE_GUIDE.md`, an enforced linter/formatter config + recommended pre-commit/CI gate, `NORMALIZATION_LOG.md`, and a separate list of behavior-changing issues found (not fixed here).

**Why it's useful.** It makes the codebase read as the consistent work of one experienced team and hold up under line-by-line review, with the standard machine-enforced so consistency can't silently rot again.

**When to use it.** When a codebase has inconsistent style or the artifacts of hasty/generated code and you want one professional standard. Do **not** use it to close *divergent implementations of a concept* (two competing ways to do the same thing) — that is `rigor:consistency-closure`.

**Sibling disambiguation — `normalize` vs `rigor:consistency-closure`.** `code-ops-suite:normalize` is about surface and style: one coherent voice everywhere, tells removed, dead code gone, recurring operations done the same way, enforced by a linter/formatter config. `rigor:consistency-closure` is about semantic convergence: when a concept is implemented several divergent ways, it picks one canonical form, migrates every site, and adds enforcement so the divergence can't recur. Use `normalize` to make the code *look* like one team wrote it; use `consistency-closure` to make a concept *behave* one way everywhere.

**Prerequisites & hand-offs.** No prerequisites; uses `test-hardening`-style characterization where coverage is thin. Routes behavior-changing finds to a separate list for the audit/remediation track.

### `/code-ops-suite:pr-split`
**Mode:** IMPLEMENT

**How it works.** Phase 0 (checkpoint) resolves the merge-base against the target trunk, captures the full diff, runs `/rigor:ground-truth` for the baseline, learns the repo's commit/PR conventions, and confirms the trunk, max PR size, and automation level (`§4`). Phase 1 builds a change-unit graph and groups hunks into reviewer-sized PRs (~≤400 lines) by dependency, concern/layer, and atomicity, ordered topologically. Phase 2 verifies-as-it-carves: each stacked PR builds/tests green at its step — green-at-every-step is the invariant. Phase 3 is a fail-closed trace scrub: it runs `privacy-opsec-suite:authorship-hygiene` (L1 metadata, L2 prose voice, L3 code-idiom blend-in), which runs `scan-ai-tells.mjs` fail-closed; if privacy-opsec-suite is not installed it runs the bundled `${CLAUDE_PLUGIN_ROOT}/scripts/scan-ai-tells.mjs` directly as the mechanical floor — and aborts the push if the trace can't be cleaned. Phase 4 pushes the stack via `gh`, opening each PR against its parent. It **never auto-merges**.

**Why it's useful.** It turns one unreviewable mega-branch into a clean stack of small, independently-green PRs scrubbed of AI/tooling trace — making review fast and the authorship hygiene airtight.

**When to use it.** When you have one big branch to carve into a reviewable stack. Do **not** use it to review someone's diff (use `pr-review`) or to implement from scratch.

**Prerequisites & hand-offs.** Requires `rigor` (for `/rigor:ground-truth`) and, ideally, `privacy-opsec-suite` (for `authorship-hygiene`; falls back to the bundled `scan-ai-tells.mjs`). Composes `privacy-opsec-suite:authorship-hygiene` fail-closed before any push; it is the traceless-finish stage that `ship`, `debug`, `full-sweep`, and `everything` delegate to.

---

## Review

### `/code-ops-suite:pr-review`
**Mode:** REVIEW

**How it works.** Phase 0 pulls the PR/branch/diff and its intent (description, linked issue/finding/spec, surrounding code context) and reviews the diff *against* the code it changes; for large PRs it fans out parallel reviewers per file-group and synthesizes one coherent review. Phase 1 applies the relevant lenses (`§10`) scoped to the diff plus needed context: correctness & intricate bugs, design & modularity, performance/efficiency regressions, security introduced, privacy/data-handling regressions (blocking, scaled to data sensitivity), UI/theming/a11y, tests, docs, and conventions. Output is a prioritized review — each comment at `file:line` with a concrete suggested change, labeled **Blocking** / **Should-fix** / **Nit** — ending with a verdict (*approve / approve-with-nits / request-changes*) and a 2–3 line summary, blocking items first. Delivered as PR comments if a VCS tool is connected, else `REVIEW.md`. Review-only by default; it switches to the implementation loop only if asked to fix.

**Why it's useful.** It is a senior-level pre-merge gate that catches the bugs, regressions, and missing tests that matter, with each comment carrying a concrete fix and a clear merge verdict.

**When to use it.** Before merging any specific change; it can be wired into CI on every PR with the official `anthropics/claude-code-action@v1` (see the plugin's `examples/github-pr-review.yml`, or run `/install-github-app`). Do **not** use it for a verification-bar review that blocks only on reproduced defects (use `rigor:deep-review`) or for an anonymity gate (use `privacy-opsec-suite:opsec-pr-gate`).

**Sibling disambiguation — `pr-review` vs `rigor:deep-review` vs `privacy-opsec-suite:opsec-pr-gate`.** All three review a change before merge, but at different bars. `code-ops-suite:pr-review` is the broad senior review across all quality lenses, producing prioritized comments and a verdict — it will flag should-fixes and nits. `rigor:deep-review` is the verification-first review: it blocks only on *reproduced* defects (evidence-tiered), trading breadth for a high-signal, low-noise gate. `privacy-opsec-suite:opsec-pr-gate` is the anonymity gate: it blocks a change that introduces a new leak, egress, identifier, or fingerprint, or that weakens fail-closed posture. Run `pr-review` for general merge readiness, `deep-review` when you want only proven blockers, and `opsec-pr-gate` on any change touching an anonymity surface.

**Prerequisites & hand-offs.** No prerequisites; uses a VCS tool if connected. Consumes the PRs from `remediation`/`feature-implementation`; if asked to fix, it enters the implementation loop.

---

## Document

### `/code-ops-suite:doc-alignment`
**Mode:** DOCUMENT

**How it works.** Phase 0 (checkpoint) inventories all docs with each one's purpose, maps code reality, maps the intended SSOT (which doc is supposed to be authoritative per topic), and flags no-owner and duplicate-authority topics — using VCS history to date the drift. Phase 1 verifies every doc claim against code and classifies each mismatch (stale, wrong, contradictory, orphaned, missing, duplicate-SSOT, broken-ref, outdated-diagram, dead-procedure, drifted-comment), then auto-fixes unambiguous factual drift while bringing stale-vs-aspirational and structural calls to you (the central judgment: never silently delete a possible plan or "correct" reality to match a roadmap). Phase 2 establishes one authoritative source per topic with working cross-links and an index. Code is ground truth; it edits documentation only — a likely *code* bug is logged as a finding, not fixed. Produces reconciled docs (edited in place), `DRIFT_REPORT.md`, `SSOT_MAP.md`, and `OPEN_QUESTIONS.md`.

**Why it's useful.** It reconciles drifted docs against code reality and leaves a clean single source of truth a future operator can trust — and is the skill that keeps the generated reference docs true over time.

**When to use it.** When docs have drifted from code, or as the ground-truth first step of a sweep so later phases work from an accurate map. Do **not** expect it to change code — it logs code issues as findings instead.

**Prerequisites & hand-offs.** No prerequisites; uses VCS history if available. Establishes the SSOT that the DOCUMENT-mode generators write into and keeps true; routes suspected code bugs to the audit/remediation track.

### `/code-ops-suite:onboarding`
**Mode:** DOCUMENT

**How it works.** Phase 0 (checkpoint) maps the system — stack, services/modules, data models, main flows, entry points, build/test/run commands, conventions, and the data-handling model — and confirms the audience and emphasis. Phase 1 writes the guide in a sensible reading order: the mental model, architecture (with a diagram matching the real map), repo tour, getting started (clone→install→configure→run→test, **verified by actually running it**, secrets redacted), key flows traced through the actual code, conventions & standards, the data-handling/security rules a contributor must not break, gotchas, and a glossary. Follows the documentation quality standard (`§13`). Produces `ONBOARDING.md` (or a small `docs/onboarding/` set) inside the repo's SSOT structure, with the architecture diagram and a list of open questions.

**Why it's useful.** It makes a new engineer — or a fresh agent — productive fast, with verified setup steps and real flows rather than a drifted paraphrase of old docs.

**When to use it.** When a newcomer (human or agent) needs orientation, or to capture a freshly-mapped system. It sits *inside* the doc track. Do **not** treat its setup steps as unverified theory — it runs them to confirm they work.

**Prerequisites & hand-offs.** No prerequisites; ingests reconciled SSOT docs if present. Lives inside the SSOT structure that `doc-alignment` keeps true.

### `/code-ops-suite:current-docs`
**Mode:** AUDIT (read-only)

**How it works.** It implements the suite-wide "documentation/reference lookup" capability (`CONVENTIONS §2`) in-house — local-first, no third-party indexer, no query egress. It runs the bundled engine, `node ${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs <library> [topic] --root <repo>`, which resolves the **installed** version from `node_modules`, returns that package's real README (topic-filtered) plus its exported type signatures with zero network, and only falls back to fetching the library's own source (`llms.txt` / GitHub README) when the bundled docs are thin (`--no-fetch` forbids that, `--json` gives structured output). The same capability is exposed as the `code-ops-docs` MCP server's `resolve-library` / `get-docs` tools. Fetched (non-installed) docs are treated as `UNVERIFIED` against the running version.

**Why it's useful.** It gives you version-accurate API facts that match what actually runs — unlike training-data memory or a third-party index pinned to a different version — and is the only correct source for private/internal packages.

**When to use it.** Before writing code against an unfamiliar or version-sensitive API. It is the suite's default documentation-lookup mechanism, used implicitly by other skills to confirm library facts. Do **not** code an API from memory when this is available.

**Prerequisites & hand-offs.** Works best with the library installed (reads `node_modules`); the `code-ops-docs` MCP server is optional. Feeds version-accurate facts into every other skill's implementation and DOCUMENT work.

### `/code-ops-suite:architecture`
**Mode:** DOCUMENT

**How it works.** Phase 0 (checkpoint) detects the stack and builds the real inventory (deployable units, modules, entrypoints, public surfaces, external systems, datastores, deployment topology) and picks the 3–5 runtime flows that matter most. Phase 1 is a **C4 ascent** — System Context, Containers, Components — each a Mermaid diagram plus narrative explaining responsibilities, boundaries, and why it's split that way. Phase 2 gives each chosen flow a Mermaid sequence diagram with step narrative (what, why, invariants, failure/recovery). Phase 3 covers cross-cutting concerns and the load-bearing invariants. Phase 4 captures the handful of architectural decisions that shaped the system. It assembles per `§13` — a ≤1-page exec summary first, `file:line` citations throughout, inferences marked `UNVERIFIED`, and a freshness SHA stamp. Produces `ARCHITECTURE.md`.

**Why it's useful.** It gives a senior engineer new to the system a diagram-rich, code-grounded map they can navigate and safely change from — not a flat "A → B."

**When to use it.** When you need the authoritative structural reference for a system. Do **not** expect it to fix code — it logs any code issue as a finding.

**Prerequisites & hand-offs.** No prerequisites. Seeds/links `adr` for the full decision records; kept true afterward by `doc-alignment`.

### `/code-ops-suite:api-docs`
**Mode:** DOCUMENT

**How it works.** Phase 0 (checkpoint) detects the public surface — HTTP routes, a GraphQL schema, RPC/gRPC services, or a library's exported API — and stops if there is no real external surface. Phase 1 documents each operation generated from the handlers + types/schema (not memory): signature, parameters, request/response shapes (linking the type/schema `file:line`), auth/permissions, error responses + status codes, side effects, and rate limits. Phase 2 makes it usable with a "how to call it" orientation, one **real** example per common operation (drawn from tests or call-sites, never invented), and a Mermaid sequence diagram for any non-trivial multi-call flow. Assembles per `§13` with an exec summary, citations, and a SHA stamp. Produces `API.md` (or per-service).

**Why it's useful.** It produces an accurate interface reference an integrating engineer can call correctly from the doc alone — shapes drawn from the actual types, examples drawn from actual call-sites.

**When to use it.** When a system exposes a real API surface that needs reference docs. Do **not** force it where there is no external surface — it self-scopes and stops.

**Prerequisites & hand-offs.** No prerequisites; uses `current-docs` for dependency facts. Kept true afterward by `doc-alignment`.

### `/code-ops-suite:data-model`
**Mode:** DOCUMENT

**How it works.** Phase 0 (checkpoint) finds the source of truth for data (SQL migrations, ORM models, a schema file, or NoSQL document shapes) and stops if there is no persistent data model. Phase 1 draws a Mermaid `erDiagram` of entities and relationships (cardinality, FK direction), split into domain clusters if large. Phase 2 documents each entity from the cited schema: fields + types, keys/indexes, constraints, relationships, and the **invariants the code relies on** (uniqueness, soft-delete, ownership, retention) that the raw schema doesn't show. Phase 3 covers schema evolution (migration history), the data lifecycle, and any denormalization or derived data. Assembles per `§13` with an exec summary, schema/migration citations, and a SHA stamp. Produces `DATA-MODEL.md`.

**Why it's useful.** It lets an engineer safely write a query or a migration from the doc — surfacing the non-obvious invariants the code depends on, which a raw schema dump never shows.

**When to use it.** When a system has a persistent data model worth documenting. Do **not** force it where there is no data model — it self-scopes and stops.

**Prerequisites & hand-offs.** No prerequisites. Kept true afterward by `doc-alignment`.

### `/code-ops-suite:adr`
**Mode:** DOCUMENT

**How it works.** It runs in one of two modes (confirmed at the start): **Backfill** mines the code, VCS history, and existing docs for the load-bearing decisions already made, writing an evidence-grounded ADR for each; **New** authors an ADR for a decision being made now, with options and a recommendation. Each ADR follows the standard form — `NNNN-title`, Status, Context, Options considered (with honest trade-offs), Decision, Consequences — citing the code/commits that embody the decision, one ADR per choice. It maintains a `docs/adr/README.md` index, ranks backfilled records by how load-bearing they are, and marks reconstructed rationale `UNVERIFIED` where history is silent. Produces numbered ADRs in `docs/adr/` (matching any existing ADR convention).

**Why it's useful.** It captures the *why* behind the architecture — the "why is it this way?" choices a newcomer hits — so a decision's true context, the options actually weighed, and the honest consequences survive past the people who made them.

**When to use it.** When you need to backfill the load-bearing past decisions or record a current one. Pairs with `architecture` (which seeds/links it). Do **not** use it to document structure or interfaces — that is `architecture` / `api-docs`.

**Prerequisites & hand-offs.** No prerequisites; uses VCS history if available. Linked from `architecture`; kept true afterward by `doc-alignment`.

### `/code-ops-suite:ops-docs`
**Mode:** DOCUMENT

**How it works.** Phase 0 (checkpoint) detects the operational surface (Dockerfiles/compose, CI/CD workflows, infra, deploy scripts, config/env, health checks, dashboards/alerts). Phase 1 documents the real deploy path (cited from the CI/scripts), rollback, and preconditions, with a Mermaid pipeline flow where it helps. Phase 2 is the configuration reference — the env/config the system actually reads, what each does, safe defaults, and the **secrets named but never valued** (`<REDACTED>`). Phase 3 gives incident runbooks (symptom → diagnosis → fix, with exact commands, grounded in real failure paths). Phase 4 covers health & observability. Assembles per `§13` with an exec summary (how it deploys, where it runs, the top 3 things that break + first response), citations, redacted secrets, and a SHA stamp. Produces `RUNBOOK.md` (and/or ops docs).

**Why it's useful.** It lets a senior engineer who has never operated the system deploy it, roll it back, change config, and work the top incidents from the doc alone — every step grounded in the real scripts/config, no secret values present.

**When to use it.** When a system needs an operator's runbook or on-call documentation. Do **not** expect secret values in it — they are named and redacted by rule (`§4`).

**Prerequisites & hand-offs.** No prerequisites. Kept true afterward by `doc-alignment`.

---

## Orchestrators

Orchestrators do not replace the individual skills — they run them in a sensible order, carry the shared registers forward fresh, maintain a master plan, and check in with you at every phase boundary.

### `/code-ops-suite:full-sweep`
**Mode:** orchestrator

**How it works.** The **intra-plugin** pipeline. Phase 0 (checkpoint) scopes the run — track (`assess-only` / `full` / a custom subset), scope, risk tolerance, PR preference, and automation level (`§4`) — and opens a master todo and a running `EXECUTIVE_SUMMARY.md`, carrying registers forward fresh (`§12`). Phases: **1 Ground truth** (`doc-alignment`); **2 Assess** (`codebase-audit` → `security-privacy-audit`, findings evidence-tiered and disconfirmed, merged into `FINDINGS_REGISTER.md`); **3 Safety net** (`test-hardening`); **4 Fix** (`remediation`, re-validating the register first); **5 Deep-dives** (`performance`, `dependency-upgrade`); **6 Consistency** (`normalize`); **7 Document** (`doc-alignment` then the generators — `architecture`, `data-model`, `api-docs`, `ops-docs`, `adr`, `onboarding`, self-scoping); **8 Ship** (`pr-split`). A separate **feature track** (`/code-ops-suite:full-sweep feature`) runs `feature-discovery` → `feature-implementation` → `pr-review` → `pr-split`. Checkpoints at every phase boundary; nothing code-changing happens without your approval.

**Why it's useful.** It runs the whole code-ops-suite end-to-end as one coherent, checkpointed pipeline — assess → safety-net → fix → polish → document — carrying the registers forward so nothing already-fixed is re-shown.

**When to use it.** When you want the whole suite on one codebase as a guided pipeline. Do **not** reach for it when you want the cross-plugin superset with rigor's verification layer and the privacy track — that is `everything`.

**Sibling disambiguation — `full-sweep` (intra-plugin) vs `everything` (cross-plugin).** `full-sweep` orchestrates only code-ops-suite skills; it needs nothing else installed and is the right default for a thorough single-plugin pass. `everything` is the superset across all three plugins — it weaves in rigor's verification methodology (evidence tiers, disconfirmation, the regression guard) and the privacy-opsec anonymity track, and requires `rigor` and `privacy-opsec-suite` installed. `everything` is deliberately the most thorough and most token-expensive option; `full-sweep` is the lighter, self-contained one.

**Prerequisites & hand-offs.** No external plugins required (uses `rigor:ground-truth` only inside the `pr-split` ship phase, if installed). Orchestrates the full code-ops-suite; ends by shipping with `pr-split`.

### `/code-ops-suite:everything`
**Mode:** orchestrator

**How it works.** The **cross-plugin superset**. Phase 0 (checkpoint) confirms all three plugins are available, sets scope, whether the privacy track is included, the remediation automation level (code-ops `§4` applied with rigor's tier gate), and the check-in level; it opens the master registers (`FINDINGS_REGISTER.md`, `CONSISTENCY_REGISTER.md`, and `LEAK_REGISTER.md` if privacy is in scope), a running `EXECUTIVE_SUMMARY.md`, and a growing proof set. Phases: **1 Map** (code-ops `doc-alignment` → `codebase-audit` → `security-privacy-audit`); **2 Ground truth & test trust** (rigor `ground-truth` → `test-suite-audit`); **3 Prove** (rigor `bug-hunt` + `quality-scan` + `regression-hunt`); **4 Anonymity & leak audits** (privacy-opsec `anonymity-threat-model` → the six leak audits → `LEAK_REGISTER.md`, if in scope); **5 Safety net** (rigor `safety-net`); **6 Consolidated review** (the main go/no-go checkpoint); **7 Remediate** (rigor `fix-verified` + code-ops `remediation` + privacy-opsec `opsec-hardening`); **8 Close inconsistencies** (rigor `consistency-closure`); **9 Improve** (rigor `improve-measured` + code-ops `performance` + `dependency-upgrade`); **10 Normalize & document** (code-ops `normalize` + the doc generators); **11 Final verification, report & ship** (`pr-split` with `authorship-hygiene`). CONFIRMED is separated from PROBABLE/SPECULATIVE throughout; never auto-merges.

**Why it's useful.** It is the most exhaustive end-to-end pass available — map → prove → leak-audit → safety-net → remediate → close → improve → normalize → document — applying each plugin's governing methodology in the right order, deduplicated, with one growing proof set.

**When to use it.** When you want the deepest possible pass and accept the token cost; it is phased with checkpoints, not a blind firehose, so you can widen or narrow scope at Phase 0. Do **not** reach for it for a single-plugin pass (use `full-sweep`) or a single change (use `ship`).

**Prerequisites & hand-offs.** **Requires `code-ops-suite`, `rigor`, and `privacy-opsec-suite` all installed.** It loads each plugin's `CONVENTIONS.md` and skill files so every phase applies its governing methodology. Notes the PR gates to wire in (`rigor:deep-review`, `privacy-opsec-suite:opsec-pr-gate`); ships via `pr-split`.

### `/code-ops-suite:ship`
**Mode:** orchestrator

**How it works.** Implements **one change** (a feature or a one-off) end-to-end, scaling each phase to the change (a one-off is light; a feature gets the full treatment). Phase 0 (checkpoint) detects the stack, runs `/rigor:ground-truth` for the baseline, sizes the change, confirms the approach for a feature, and sets the automation level. Phase 1 runs `/rigor:safety-net` if the change touches thin-coverage code. Phase 2 implements via the implementation loop (`§11`) at the smallest correct scope. Phase 3 proves it — tests that fail before and pass after, the full suite green, and the regression guard (`rigor §H`). Phase 4 is the privacy gate (if the change touches a privacy surface and `privacy-opsec-suite` is installed). Phase 5 finishes traceless — `pr-split` for a stack or a single PR scrubbed by `authorship-hygiene`, with `scan-ai-tells` passing fail-closed before push (the bundled `scan-ai-tells.mjs` as the floor if privacy-opsec-suite is absent). Never auto-merges.

**Why it's useful.** It takes a single intent to a proven, behavior-preserving, privacy-checked, trace-free PR — full rigor without you orchestrating the phases by hand.

**When to use it.** When you want to implement one change end-to-end at high quality. See the disambiguation below for `ship` vs `debug` vs `feature-implementation`.

**Sibling disambiguation — `ship` vs `debug` vs `feature-implementation`.** `ship` implements one *new* change (feature or one-off) end-to-end with proof and a traceless finish. `debug` starts from a *symptom* and drives reproduce → isolate → root-cause → fix-with-regression-proof → traceless ship; reach for it when something is broken, not when you're adding capability. `feature-implementation` builds a *set* of already-specified features incrementally from `feature-discovery` specs — it is the batch builder, where `ship` is the single-change end-to-end driver.

**Prerequisites & hand-offs.** **Requires `rigor`**; the privacy phase runs only if `privacy-opsec-suite` is installed and the change touches a privacy surface. Composes `rigor` (safety-net, proof, regression guard), the privacy leak gate, and `pr-split` + `authorship-hygiene` for the finish.

### `/code-ops-suite:debug`
**Mode:** orchestrator

**How it works.** Drives a bug from symptom to a proven root-cause fix. Phase 0 (checkpoint) captures the symptom, runs `/rigor:ground-truth`, and uses rigor's verifier to build a reliable reproduction — if it can't be reproduced, it stops and reports exactly what's needed rather than guessing a fix. Phase 1 isolates: trace the control/data path with rigor's tracer, derive invariants, narrow to the smallest triggering path, and `/rigor:regression-hunt` to bisect if it's a regression. Phase 2 (checkpoint) identifies the real cause at the correct layer (not the nearest symptom), cited `file:line`, with a disconfirmation pass, and gets a go before editing. Phase 3 runs the `rigor:fix-verified` loop: the repro passes, the suite is green, the regression guard holds, siblings are swept, and an enforcement is added so the class can't recur. Phase 4 is the privacy gate (if applicable). Phase 5 finishes traceless via `authorship-hygiene` / `pr-split`, with `scan-ai-tells` fail-closed. Never auto-merges.

**Why it's useful.** It refuses to guess — reproduce first, fix at root cause with a regression test that failed before and passes now, sweep for siblings, and enforce against recurrence — so a fixed bug stays fixed.

**When to use it.** When you have a bug symptom (error, stack trace, wrong behavior) to drive to a proven fix. Do **not** use it to add capability (use `ship`) or when you can't yet produce a reproduction — it will stop and ask for what's needed.

**Prerequisites & hand-offs.** **Requires `rigor`** (verifier, tracer, `regression-hunt`, `fix-verified`); the privacy phase runs only if `privacy-opsec-suite` is installed and the fix touches a privacy surface. Finishes via `pr-split` + `authorship-hygiene`.

---

*Verified-at: a181b36*
