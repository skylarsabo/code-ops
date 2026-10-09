# Code Ops Suite for Codex

> Generated in the code-ops repository (https://github.com/skylarsabo/code-ops) by `scripts/build-codex-marketplace.mjs` from the canonical Claude source. Do not edit this directory directly.

Adaptive, multi-agent engineering workflows for any codebase: audit, security/privacy threat assessment, remediation, feature discovery & build, performance, tests, dependencies, local review gates, doc alignment, onboarding, and code and concept normalization. Developer-in-the-loop, behavior-preserving, with shared conventions.

## Use

Name a workflow in Codex as `code-ops-suite:<skill>`. Every generated skill sets `policy.allow_implicit_invocation: true`, matching the Claude-side model-invocable policy.

## Skills

- `adr` — Use to capture architecture rationale as decision records, backfilling past decisions or writing one for a current decision.
- `api-docs` — Use for an accurate API or interface reference generated from the code and types, not memory.
- `architecture` — Use for a deep, diagram-rich architecture reference for senior engineers, grounded in the code.
- `atlas` — Use to create a repo's atlas (durable cache of codebase judgment), refresh it after code moves, or consolidate inbox notes; atlas-check sets freshness.
- `calibration-run` — Use for a standard isolated assess-only calibration run against a real-scale target repo; sanitized trend entry, no target internals.
- `codebase-audit` — Use for a broad multi-lens review of an unfamiliar or drifting codebase; writes a ranked findings backlog, applies only safe fixes.
- `conform` — Use to assess and repair a repo's standards contract, vault, atlas, and doc drift; scope global aligns the Claude or Codex contract.
- `current-docs` — Use for current, version-accurate library or framework docs before coding against its API; reads the installed version, not memory.
- `data-model` — Use for a data-model reference generated from the real schema and migrations.
- `debug` — Use when you have a bug symptom and want it driven from reproduction to a root-cause fix at full rigor.
- `dependency-upgrade` — Use when dependencies are outdated or carry CVEs; safe staged upgrades verified at each step, never bulk-bumped.
- `distill` — Use to cut a program ledger to its finish line, or back-fill a docs vault with a no-loss check, baseline, gate, and maintain pass.
- `doc-alignment` — Use when docs have drifted from code and need reconciling into one source of truth.
- `everything` — Use for a checkpointed pass over installed plugins, from one pipeline to the cross-plugin superset; pick plugins and a track (assess-only, full, feature).
- `feature-discovery` — Use for grounded, high-value feature ideas mined from the codebase, not a generic wishlist. Discovery only; writes no code.
- `feature-implementation` — Use when feature specs exist and you want them built incrementally. Requires specs as input.
- `handoff` — Use when a long run needs a continue, compact, or transfer decision. Transfer writes verifiable state to HANDOFF.md; resume re-verifies every claim.
- `local-review-gate` — Use to run deep review, OpSec review, or judgment evals locally before a PR, with exact-SHA receipts and optional GitHub status publication.
- `normalize` — Use for a behavior-preserving standard on inconsistent style or hasty-code artifacts. Concept mode unifies a divergent concept.
- `onboarding` — Use for a verified, code-grounded orientation guide with an architecture diagram for a new contributor.
- `ops-docs` — Use for an operational runbook for the senior engineer who operates or is on call for the codebase.
- `performance` — Use when something is measurably slow or hot paths need optimization with proof; profiles first. Broad measured wins go to rigor:improve-measured.
- `pr-split` — Use to carve one big branch into a clean, reviewable stack of small PRs, each independently green and traceless.
- `provider-parity-audit` — Use to audit the suite on Claude, Codex, Grok, and OpenCode for host-specific assumptions in hooks, agents, skills, scripts, settings, manifests, and docs.
- `remediation` — Use when a FINDINGS_REGISTER.md exists and its NEEDS-REVIEW and NEEDS-DESIGN items need safe implementation with tests. Requires a register.
- `repo-docs` — Use to extract, refresh, or prove current the repository documentation in one manifest-owned hub.
- `run-cost-audit` — Use to audit a finished run's cost discipline (dispatch counts, artifact sizes, tier and effort mix). Requires its artifact folder.
- `security-privacy-audit` — Use for an adversarial security and privacy threat model deeper than the audit lens. Anonymity egress, metadata, and fingerprints go to privacy-opsec-suite.
- `ship` — Use to implement one change, a feature or one-off, end to end at high quality, shipped as a clean traceless PR.
- `test-hardening` — Use when critical paths lack coverage or tests are flaky; builds characterization and regression tests. Auditing fault detection goes to rigor:test-suite-audit.
- `vault` — Use to create a repo's Obsidian docs vault, migrate a docs tree into the standard layout, or check a vault for conformance.

## Packaging notes

- The complete workflow text and conventions are rendered from `plugins/code-ops-suite/` in the code-ops repository.
- Claude-specific GitHub Action examples are intentionally not bundled here.
- Root-level `agents/*.md` files are collaboration-subagent briefing templates. Their machine-readable minimum tiers are in `agents/model-floors.json`; the lead selects a supported runtime model before dispatch.
- The package bundles optional, plugin-scoped MCP servers: `code-ops-docs`, `code-ops-query`.
- The package bundles 16 hook commands. Codex requires the user to review and trust plugin hooks before they run.
  - `PreToolUse` `enforce-traceless.mjs`: blocks a commit or pull-request command whose published text carries attribution traces.
  - `PreToolUse` `digest-rewrite.mjs`: routes a simple shell command through the output digest so long output arrives compressed.
  - `PreToolUse` `digest-rewrite.mjs`: routes a simple shell command through the output digest so long output arrives compressed.
  - `PreToolUse` `dispatch-guard.mjs`: holds a subagent to its brief’s round budget, denies a wide-surface dispatch that names no reason, denies a suite-agent dispatch whose brief lacks a field the agent’s contract requires, gates new dispatches past the context ceiling until a handoff assessment, and flags a dispatch that overrides a declared tier.
  - `PreToolUse` `peer-guard.mjs`: denies a message to a peer session that already handed off and names the live successor to resend to.
  - `PostToolUse` `index-refresh.mjs`: re-indexes a file right after a tool edits it, so context queries read the live tree.
  - `PostToolUse` `agent-ledger.mjs`: records each subagent launch and report in a local ledger so the agents still unreported after a handoff can be listed.
  - `PostToolUse` `handoff-card.mjs`: prompts the lead to checkpoint durable state at a safe boundary when resident context crosses each 150,000-token band, and to assess a handoff only where the host keeps one.
  - `UserPromptSubmit` `handoff-card.mjs`: prompts the lead to checkpoint durable state at a safe boundary when resident context crosses each 150,000-token band, and to assess a handoff only where the host keeps one.
  - `PreCompact` `compact-snapshot.mjs`: writes a masked state snapshot of operator words, running work, open items, and peers owed a reply just before the host compacts the session.
  - `PostCompact` `compact-snapshot.mjs`: writes a masked state snapshot of operator words, running work, open items, and peers owed a reply just before the host compacts the session.
  - `SessionStart` `routing-card.mjs`: prints the routing card at session start, the compaction snapshot state, git state, and live pending work after compaction, and up to 3 pending handoffs by session name on a fresh session, where the session is new work unless the operator resumes one.
  - `SessionEnd` `session-receipt.mjs`: appends a local session receipt row with token usage, tool calls, and model mix.
  - `SubagentStart` `ladder-card.mjs`: hands an implementer subagent the code-economy ladder card.
  - `SubagentStop` `subagent-report.mjs`: notes, without blocking, a subagent report whose first line lacks a declared verdict or that exceeds its word cap.
  - `SubagentStop` `agent-ledger.mjs`: records each subagent launch and report in a local ledger so the agents still unreported after a handoff can be listed.

For source history and release notes, see the generated `CHANGELOG.md` and the repository root.
