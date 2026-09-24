# Code Ops Suite for Codex

> Generated in the code-ops repository (https://github.com/skylarsabo/code-ops) by `scripts/build-codex-marketplace.mjs` from the canonical Claude source. Do not edit this directory directly.

Adaptive, multi-agent engineering workflows for any codebase: audit, security/privacy threat assessment, remediation, feature discovery & build, performance, tests, dependencies, local review gates, doc alignment, onboarding, and code and concept normalization. Developer-in-the-loop, behavior-preserving, with shared conventions.

## Use

Name a workflow in Codex as `code-ops-suite:<skill>`. Every generated skill sets `policy.allow_implicit_invocation: true`, matching the Claude-side model-invocable policy.

## Skills

- `adr` — Use to capture the reasons behind a codebase's architecture as decision records, by backfilling load-bearing past decisions or writing an ADR for a current one.
- `api-docs` — Use when you need an accurate API or interface reference for a codebase, generated from the code and types, not from memory.
- `architecture` — Use when you need a deep, diagram-rich architecture reference for a codebase, written for a senior engineer and grounded in the actual code.
- `atlas` — Use to create a repo's atlas, its durable cache of codebase judgment, refresh it after code moves, or consolidate inbox notes. atlas-check sets freshness.
- `calibration-run` — Use for a standard, isolated assess-only calibration run against a real-scale target repo. Ends in a sanitized trend entry and never quotes target internals.
- `codebase-audit` — Use when you want a broad, multi-lens review of an unfamiliar or drifting codebase. It writes a ranked findings backlog and applies only safe fixes.
- `conform` — Use to assess and repair a repo's standards contract, vault, atlas, and doc drift, or with scope global to align the user-wide Claude or Codex contract.
- `current-docs` — Use when you need current, version-accurate docs for a library or framework before coding against its API. It reads the installed version, not memory.
- `data-model` — Use when you need a clear data-model reference for a codebase, generated from the real schema and migrations.
- `debug` — Use when you have a bug symptom and want it driven from reproduction to a root-cause fix at full rigor.
- `dependency-upgrade` — Use when dependencies are outdated or carry known CVEs and you want safe, staged upgrades verified at each step. It never bulk-bumps.
- `doc-alignment` — Use when docs have drifted from code and you want them reconciled into a clean single source of truth.
- `everything` — Use for a checkpointed pass over installed plugins, from one plugin pipeline to the cross-plugin superset. Pick plugins and a track: assess-only, full, feature.
- `feature-discovery` — Use when you want grounded, high-value feature ideas mined from the codebase rather than a generic wishlist. Discovery only, and it writes no code.
- `feature-implementation` — Use when feature specs already exist and you want them built incrementally. It requires specs as input.
- `handoff` — Use when a long run needs a continue, compact, or transfer decision. A transfer captures verifiable state as HANDOFF.md; resume re-verifies every claim.
- `local-review-gate` — Use when deep review, OpSec review, or judgment evals should run locally before a PR, with exact-SHA receipts and optional GitHub status publication.
- `normalize` — Use when code has inconsistent style or hasty-code artifacts and needs a behavior-preserving standard. Concept mode unifies a divergent concept and enforces it.
- `onboarding` — Use when you need a verified, code-grounded orientation guide, with an architecture diagram, for a new contributor.
- `ops-docs` — Use when you need an operational runbook for a codebase, written for the senior engineer who has to operate it or be on call for it.
- `performance` — Use when something is measurably slow or hot paths need optimization with proof. Profiles first. For broad measured wins, use rigor:improve-measured.
- `pr-split` — Use when you have one big branch you want carved into a clean, reviewable stack of small PRs, each independently green and traceless.
- `provider-parity-audit` — Use to audit the suite on Claude, Codex, Grok, and OpenCode for host-specific assumptions in hooks, agents, skills, scripts, settings, manifests, and docs.
- `remediation` — Use when a FINDINGS_REGISTER.md exists and its NEEDS-REVIEW and NEEDS-DESIGN items need safe implementation with tests. Requires a register as input.
- `repo-docs` — Use when repository documentation must be extracted, refreshed, or proven current from one manifest-owned documentation hub.
- `run-cost-audit` — Use to audit a finished run's cost discipline: dispatch counts, artifact sizes, and tier and effort mix. Requires its artifact folder, not a live run.
- `security-privacy-audit` — Use for an adversarial security and privacy threat model deeper than the audit's lens. Anonymity egress, metadata, and fingerprints go to privacy-opsec-suite.
- `ship` — Use when you want to implement one change, a feature or a one-off, end to end at high quality, shipped as a clean traceless PR.
- `test-hardening` — Use when critical paths lack coverage or tests are flaky. Builds characterization and regression tests. To audit fault detection, use rigor:test-suite-audit.
- `vault` — Use when a repo needs its Obsidian docs vault created, an existing docs tree migrated into the standard layout, or an existing vault checked for conformance.

## Packaging notes

- The complete workflow text and conventions are rendered from `plugins/code-ops-suite/` in the code-ops repository.
- Claude-specific GitHub Action examples are intentionally not bundled here.
- Root-level `agents/*.md` files are collaboration-subagent briefing templates. Their machine-readable minimum tiers are in `agents/model-floors.json`; the lead selects a supported runtime model before dispatch.
- The package bundles optional, plugin-scoped MCP servers: `code-ops-docs`, `code-ops-query`.
- The package bundles 10 hook commands. Codex requires the user to review and trust plugin hooks before they run.
  - `PreToolUse` `enforce-traceless.mjs`: blocks a commit or pull-request command whose published text carries attribution traces.
  - `PreToolUse` `digest-rewrite.mjs`: routes a simple shell command through the output digest so long output arrives compressed.
  - `PreToolUse` `dispatch-guard.mjs`: holds a subagent to its brief’s round budget, denies a wide-surface dispatch that names no reason, denies a suite-agent dispatch whose brief lacks a field the agent’s contract requires, gates new dispatches past the context ceiling until a handoff assessment, and flags a dispatch that overrides a declared tier.
  - `PostToolUse` `index-refresh.mjs`: re-indexes a file right after a tool edits it, so context queries read the live tree.
  - `PostToolUse` `handoff-card.mjs`: prompts the lead to assess continue, compact, or handoff at a safe boundary when resident context crosses each 150,000-token band.
  - `UserPromptSubmit` `handoff-card.mjs`: prompts the lead to assess continue, compact, or handoff at a safe boundary when resident context crosses each 150,000-token band.
  - `SessionStart` `routing-card.mjs`: prints the routing card at session start, a restore instruction after compaction, and up to 3 pending handoffs by session name on a fresh session, where the session is new work unless the operator resumes one.
  - `SessionEnd` `session-receipt.mjs`: appends a local session receipt row with token usage, tool calls, and model mix.
  - `SubagentStart` `ladder-card.mjs`: hands an implementer subagent the code-economy ladder card.
  - `SubagentStop` `subagent-report.mjs`: notes, without blocking, a subagent report whose first line lacks a declared verdict or that exceeds its word cap.

For source history and release notes, see the generated `CHANGELOG.md` and the repository root.
