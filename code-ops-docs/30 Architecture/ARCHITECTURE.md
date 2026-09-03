---
type: reference
status: current
updated: 2026-09-03
---

# Architecture

This page describes the shape of the repository: what the layers are, what runs at
session time, and where each mechanism's own reference lives. Read it before changing a
layer boundary, adding a host hook, or moving a script between plugins. Architecture-changing
work must update it in the same commit.

## Purpose

Code-ops is a dependency-free marketplace of agent skills, agents, runtime scripts, and regression evals. Canonical plugin packages live under `plugins/`. Host packages are generated projections, not independent implementations. The zero-dependency guard rejects non-`node:` imports. Evidence: `scripts/check-no-deps.mjs:24-28`.

## System boundaries

The repository has four behavior-bearing layers:

- `plugins/` contains the canonical Claude-format packages, skills, agents, conventions, and runtime scripts.
- `scripts/` contains canonical repository tooling, including renderers, validation, orchestration receipts, and repository-context compilation.
- `evals/` contains executable regression fixtures and score checks.
- `.github/workflows/` runs the merge gates on pull requests and the complete validation set on `main`.

The two host distributions are rendered from canonical packages. Both renderers expose a `--check` mode that fails on drift. Evidence: `AGENTS.md:94-101` and `scripts/build-opencode-dist.mjs:475-489`.

## Execution flow

```text
canonical plugin and script source
            |
            +--> first host renderer --------> first host projection
            |
            +--> opencode renderer ----------> opencode-dist/
            |
            +--> structural lint and evals --> CI verdict
```

The `validate` workflow runs on pull requests, on pushes to `main`, on a weekly schedule, and on manual dispatch. It uses a per-ref concurrency group that cancels superseded validation runs. The [CI and delivery reference](../50%20Platform/CI_DELIVERY.md) owns the job layout. Evidence: `.github/workflows/validate.yml:3-27`.

## Script entrypoint

`scripts/co.mjs` is one entrypoint over the canonical scripts. A static verb table maps `<domain> <verb>` to a sibling script name across eleven domains: `context`, `run`, `scan`, `check`, `docs`, `atlas`, `register`, `calibrate`, `review`, `research`, and `build`. The entrypoint rewrites `process.argv` to the argument list the script would have received directly, then imports that sibling. It starts no child process and duplicates no logic. A plugin vendors only the scripts its skills use, so a verb naming an absent script exits 2 and says so. The direct `node scripts/<name>.mjs` paths stay valid. The [contracts reference](../35%20Contracts%20and%20Data/CONTRACTS.md) owns the exit codes and the subcommand rule. Evidence: `scripts/co.mjs:34-106`, `scripts/co.mjs:184-201`, and `scripts/vendored-manifest.mjs:13-22`.

## Host hooks

Seven hooks ship with the code-ops-suite package and register in `plugins/code-ops-suite/hooks/hooks.json`. Two run at `PreToolUse` on Bash: `enforce-traceless.mjs` blocks a `git commit` or `gh pr create|merge` whose command string carries an AI or tooling trace, and `digest-rewrite.mjs` reruns an allowlisted simple command under `scripts/digest.mjs` so the session sees a compressed result. `index-refresh.mjs` runs at `PostToolUse` after `Edit`, `Write`, `MultiEdit`, and `NotebookEdit`, and re-indexes the one file that changed. `routing-card.mjs` runs at `SessionStart` and prints the routing card. `session-receipt.mjs` runs at `SessionEnd` and appends one measurement row. `ladder-card.mjs` runs at `SubagentStart` and hands an implementer-class subagent the code-economy ladder. `precompact-preserve.mjs` runs at `PreCompact` and states what a compaction summary must keep. Every hook is on by default and fails open. Four carry an off switch, set in the `env` block of a `.claude/settings.json`: `CODE_OPS_DIGEST`, `CODE_OPS_INDEX`, `CODE_OPS_LADDER_CARD`, and `CODE_OPS_RECEIPTS`. The [infrastructure reference](../50%20Platform/INFRASTRUCTURE.md) owns the switches and their storage, and the [contracts reference](../35%20Contracts%20and%20Data/CONTRACTS.md) owns each hook's contract. Evidence: `plugins/code-ops-suite/hooks/hooks.json:1-71`.

## Symbol index and query server

`scripts/context-query.mjs` answers a structural question with `file:line` anchors rather than file bodies, through `find`, `callers`, `callees`, `blast`, `explore`, `refresh`, and `status`. Its index is one JSON document under `~/.claude/code-ops/index/<project slug>/` or `$CODE_OPS_INDEX_DIR`, keyed by the repository root, so nothing is committed and no query crosses repositories. `scripts/symbol-lib.mjs` is the single source of the definition rules and the import extraction for all four readers, so `repo-map.mjs`, `import-graph.mjs`, `skim.mjs`, and `context-query.mjs` cannot disagree about what a definition or an import edge is. `scripts/context-query-mcp.mjs` serves the same queries as a newline-delimited JSON-RPC 2.0 stdio server, registered as `code-ops-query` in the plugin manifest with the tools `context_query` and `context_refresh`, so a host with no shell reaches them. The [contracts reference](../35%20Contracts%20and%20Data/CONTRACTS.md) owns the resolution rules and the stale banner. Evidence: `scripts/context-query.mjs:8-21`, `scripts/symbol-lib.mjs:45-64`, and `plugins/code-ops-suite/.claude-plugin/plugin.json:30-35`.

## Atlas freshness and claims

The atlas is the repository's durable cache of code-grounded judgment. `scripts/atlas-check.mjs check` reports each section as malformed, stale, or fresh from a `verifiedDigest` over its declared scope, and `--gate` makes a stale section a job failure. Beneath each verdict the check prints a claim report, where a claim is a `path:line` citation in the section's prose, classified by `revalidate-register.mjs` so the atlas and a findings register grade a drifted citation identically. `--claims-gate` is separate and exits 1 on any claim the classifier did not call FRESH. `atlas-check.mjs scope <slug> --suggest` reads `context-query.mjs blast --json` over the section's scoped files and prints the depth-1 importers the scope does not yet cover. The [atlas technique page](../40%20Engineering/Techniques/atlas.md) owns the trust doctrine and the stamping workflow. Evidence: `scripts/atlas-check.mjs:302-344`, `scripts/atlas-check.mjs:698-706`, and `scripts/atlas-check.mjs:763-841`.

## Measurement loop

The suite measures its own context spend from local transcripts, with no model in the loop and no egress. The `SessionEnd` hook `session-receipt.mjs` appends one row per session to `~/.claude/code-ops/session-receipts.jsonl`, or to `$CODE_OPS_RECEIPTS`, carrying tokens by class for the main thread and its subagents, tool calls, model mix, wall time, and an `arms` object recording which switches that session ran under. `scripts/context-audit.mjs` reads the same transcripts on demand and reports tokens, context characters by tool, and Bash output by command family, sanitized by default. `context-audit.mjs receipts --by-arm` groups the ledger by those switches and prints per-session means, which is how an on-and-off comparison is read. `receipts --purge-before <ISO date>` is the only thing that removes rows, so retention stays one operator command. The [measurements reference](../55%20Operations/MEASUREMENTS.md) owns the baseline rows and the method for adding one. Evidence: `plugins/code-ops-suite/hooks/session-receipt.mjs:1-20` and `scripts/context-audit.mjs:1-22`.

## Planned agent work

`scripts/run-contract.mjs` validates a bounded run contract before reconciliation, acceptance recording, or finalization. A contract declares quality criteria, model routing, dispatch limits, write scopes, dependencies, and replan triggers. Evidence: `scripts/run-contract.mjs:10-24`, `scripts/run-contract.mjs:55-140`, and `scripts/run-contract.mjs:209-230`.

The contract rejects concurrent write scopes or artifacts that overlap in one wave. It also rejects duplicate non-review work with the same phase, lens, and scope. Evidence: `scripts/run-contract.mjs:126-137`.

The dispatch ledger records planned work and state transitions. A failed dispatch can move only to `redispatched`. A reported dispatch is terminal. Evidence: `scripts/dispatch-ledger.mjs:323-326`.

## Context compiler

The context compiler separates an exact repository snapshot from a per-unit bundle. A snapshot hashes visible Git state and generator identities, then reuses a content-addressed structural cache. Evidence: `scripts/context-index-lib.mjs:135-195` and `scripts/context-snapshot.mjs:72-124`.

A bundle selects files in the unit scope, direct import neighbors, visible changes, and freshness-gated Atlas excerpts. It fails with a marker when scope is broad or the byte budget is exceeded. Evidence: `scripts/context-bundle.mjs:52-83` and `scripts/context-bundle.mjs:85-164`.

## Long-horizon runtime

Run Contract v3 adds a runtime boundary to the v2 context binding. The contract names a
host-capability receipt, a JSONL runtime receipt chain, ordered stable-prefix source
files, a prefix byte limit, and a policy for prompt caching, compaction, context editing,
host memory, and task budget. The contract validator verifies the context snapshot and
the runtime configuration before runtime work starts. Capability and receipt paths must
differ portably and physically. Runtime heads use exact SHA-1 or SHA-256 object IDs. Evidence:
`scripts/run-contract.mjs:11-27`, `scripts/run-contract.mjs:60-72`, and
`scripts/runtime-lib.mjs:76-114` and `scripts/runtime-lib.mjs:175-192`.

`host-capabilities.mjs` writes one explicit descriptor. It records host, provider, model,
evidence source, observation time, and one state per capability. The descriptor does not
infer host behavior from the model name. Initialization requires an ignored path without
linked components before writing. Evidence: `scripts/host-capabilities.mjs:12-22` and
`scripts/host-capabilities.mjs:37-79`.

The stable-prefix compiler accepts only exact tracked UTF-8 text paths. It emits a framed,
ordered byte payload and records its digest, total bytes, and per-file digests. It rejects
invalid paths, NUL bytes, and payloads over the contract limit. Evidence:
`scripts/runtime-lib.mjs:148-174`.

The runtime creates an `init` receipt, then appends checkpoints, resumes, replans, and
optional observations under a runtime mutation lock. A checkpoint binds the verified
ledger, optional acceptance and handoff files, verified context bundles, and named
artifacts. Resume revalidates the latest checkpoint references. Replan retains the run ID
and advances exactly one revision. Evidence: `scripts/run-runtime.mjs:107-136` and
`scripts/run-runtime.mjs:186-290`.

Receipt replay verifies contiguous sequence numbers, predecessor digests, receipt digests,
binding stability, checkpoint requirements, and resume replay. The receipt chain is the runtime
continuity record. Source code remains authoritative for behavior. Evidence:
`scripts/runtime-lib.mjs:310-358`.

## Local judgment before a pull request

Model judgment happens locally before a pull request, and it runs only when the operator opts
in. `local-review-gate.mjs` prepares a
review plan only from a clean, unambiguous-index, non-default feature branch whose base is an ancestor of
`HEAD`. The plan binds base and head SHAs, a binary diff digest, and sorted changed paths.
Plan, report, and receipt paths must be ignored by Git. Evidence:
`scripts/context-index-lib.mjs:67-79`, `scripts/local-review-gate.mjs:83-185`, and
`scripts/local-review-gate.mjs:357-383`.

The local gate has exactly two review domains: `local-deep-review` and
`local-opsec-gate`. Each report receipt is chained and binds the review plan, reviewer and
model label, tier, effort, verdict, confirmed and blocking finding counts, and report
digest. A check requires one passing receipt for each domain. Evidence:
`scripts/local-review-gate.mjs:35-43`, `scripts/local-review-gate.mjs:194-269`, and
`scripts/local-review-gate.mjs:374-468`.

Ignored authority paths cannot alias tracked Git paths, and the two gates must name different
reviewer identities. The same boundary covers the local judgment-eval planner's plans, findings,
and score receipts. The [contracts reference](../35%20Contracts%20and%20Data/CONTRACTS.md) owns
the alias and physical-identity rules.

Hosted CI remains the deterministic backstop. The `validate` workflow runs structural
checks and regression evals on pull requests, main pushes, a weekly schedule, and manual dispatch. It also
runs the local-review and judgment-orchestration fixture evals. It does not run a hosted
model-review service. The optional status publisher first verifies the local receipt chain and
both remote branch tips, then posts one success status per gate. The
[CI and delivery reference](../50%20Platform/CI_DELIVERY.md) owns the job layout and the
branch-protection rule. Evidence: `.github/workflows/validate.yml:3-27` and
`scripts/local-review-gate.mjs:274-344`.

## Authority

Code is authoritative for behavior. The contract author chooses policy. The host descriptor
states only observed or operator-supplied capability evidence. Runtime receipts prove the
bound inputs and their sequence, not provider execution, elapsed time, or unreported cache
savings. Local judgment receipts prove the reviewed diff, report bytes, and receipt order.
They do not authenticate their reviewer or model labels. GitHub statuses are optional
external evidence and require write authority. The documentation manifest identifies
the canonical documentation records and their source evidence.

## Documentation evidence boundary

`docs-manifest.mjs` validates the authored hub and its required domains. Manifest v2 also registers permanent record collections without transferring authored authority to their historical paths.

`records.mjs` owns collection classification, admission, permanent identity, citation state, curation, history verification, and semantic projections. Inventory v3 keeps one authority-batch chain for membership and provenance. The separate curation ledger owns status and supersession.

Every authority writer uses one clone-wide lock beneath Git's common directory. Optimistic bindings reject stale work from another clone. `docs-extract.mjs` gives affected documentation work only the collection inventory and semantic index. It never injects full record bodies by default.

That separation keeps the hub authoritative while preserving immutable evidence. It also keeps large repositories bounded: one context snapshot serves the run, and unchanged collections create no model dispatch.
