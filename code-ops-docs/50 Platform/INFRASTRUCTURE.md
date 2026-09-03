---
type: reference
status: current
updated: 2026-09-03
---

# Infrastructure

This page owns the runtime environment: the Node version, the repository's own CI and hook
infrastructure, the bundled host hooks and their switches, and the operational limits. Look
here first for the name of a switch or the path of a local store.

## Runtime

The project is a Node.js repository that intentionally uses only Node built-ins. `.node-version` is the runtime SSOT and selects Node 24 LTS. CI and local tooling consume that file rather than maintain separate Node versions. Evidence: `.node-version`, `.github/workflows/validate.yml`, and `scripts/check-no-deps.mjs`.

Long-horizon runs use an explicit, ignored host-capability descriptor. The descriptor records
host, provider, model, observation source, and five capability states. Runtime receipts and
default metrics retain only its digest, states, and policy outcomes. The tools do not infer
capabilities from a model name. Initialization rejects Git-visible paths and linked components
before writing raw provenance. Evidence: `scripts/host-capabilities.mjs:1-79` and
`scripts/runtime-lib.mjs:17-29`, `193-218`.

The runtime stores a hash-chained receipt log at a repository-ignored path. It serializes mutations with a lock. A checkpoint or resume fails when its contract, capability receipt, stable prefix, ledger, bundle, or artifact has drifted. Evidence: `scripts/run-runtime.mjs:96-136`, `205-218`, and `253-292`.

There is no application server, managed database, container image, Terraform root, or cloud-runtime configuration in the current repository. That is an inspected repository boundary, not a statement about hosts that install the marketplace.

## Repository infrastructure

GitHub Actions provides CI. GitHub hosts pull requests, branch protection, and the marketplace repository. `.github/actions-lock.json` owns the reviewed action identities, immutable SHAs, provenance, permissions, egress, telemetry, and advisory notes. The deterministic checker rejects mutable, unlisted, or drifted action references.

Git hooks can regenerate derived host distributions and reject unsafe staging conditions. CI remains the backstop when hooks are missing or bypassed. Evidence: `AGENTS.md:103-105`.

## Host hook switches

The code-ops-suite package registers seven hooks in `plugins/code-ops-suite/hooks/hooks.json`.
Every one is on by default and fails open. Four carry an off switch, read from the `env` block
of a `.claude/settings.json` at user scope for every repository or at repository scope for one:

```json
{ "env": { "CODE_OPS_DIGEST": "off" } }
```

| Variable | Value that turns it off | What it governs |
| --- | --- | --- |
| `CODE_OPS_DIGEST` | `off`, `0`, or `false` | the `PreToolUse` output digest, `digest-rewrite.mjs` |
| `CODE_OPS_INDEX` | `off`, `0`, or `false` | the `PostToolUse` symbol-index refresh, `index-refresh.mjs` |
| `CODE_OPS_LADDER_CARD` | `off`, `0`, or `false` | the `SubagentStart` code-economy card, `ladder-card.mjs` |
| `CODE_OPS_RECEIPTS` | `off`, `0`, or `false` | the `SessionEnd` measurement row, `session-receipt.mjs` |

Three variables name a path instead of switching a mechanism:

| Variable | What it names | Default |
| --- | --- | --- |
| `CODE_OPS_DIGEST_DIR` | the digest store root | `~/.claude/code-ops/digest/<project slug>/` |
| `CODE_OPS_DIGEST_STORE` | set to `off` it keeps the compression and writes no raw file and no receipt row | the store is written |
| `CODE_OPS_INDEX_DIR` | the symbol-index directory | `~/.claude/code-ops/index/<project slug>/` |

The three hooks with no switch write nothing that a switch could suppress: `enforce-traceless.mjs` at `PreToolUse`, `routing-card.mjs` at `SessionStart`, and `precompact-preserve.mjs` at `PreCompact`. The [contracts reference](../35%20Contracts%20and%20Data/CONTRACTS.md) owns each hook's contract. Evidence: `plugins/code-ops-suite/hooks/hooks.json:1-71`.

## What the local stores hold

Leaving `digest-rewrite.mjs` on persists the complete raw output of every rewritten command, in
plain text, under `~/.claude/code-ops/digest/<slug of the repository>/`, with a receipt row that
records the command's arguments as written. Nothing purges that store. Delete the directory to
purge it. `CODE_OPS_DIGEST_STORE=off` beside the switch keeps the compression and writes nothing,
at the cost of the recovery hints. The store is keyed by the repository that opted in, never by a
`cd` target inside a command. Evidence: `plugins/code-ops-suite/hooks/digest-rewrite.mjs:12-16`
and `plugins/code-ops-suite/hooks/digest-rewrite.mjs:161-176`.

The symbol index lives under `~/.claude/code-ops/index/<slug of the repository>/` or
`$CODE_OPS_INDEX_DIR`, never in the tree, and holds definitions, call sites, and import edges,
never file bodies. Delete the directory to purge it. Evidence:
`plugins/code-ops-suite/hooks/index-refresh.mjs:6-11` and
`plugins/code-ops-suite/hooks/index-refresh.mjs:25-36`.

The session-receipt ledger is `~/.claude/code-ops/session-receipts.jsonl`, or `$CODE_OPS_RECEIPTS`.
`context-audit.mjs receipts --purge-before <ISO date>` is the only thing that removes rows, so
retention stays one operator command. Evidence: `scripts/context-audit.mjs:8-16`.

Keeping a switch per repository is what makes a measurement arm possible: one checkout runs with
the mechanism and another runs without it, and their session receipts compare. The
[measurements reference](../55%20Operations/MEASUREMENTS.md) owns the baseline rows and the
comparison method. The `ladder-card.mjs` card is an arm of exactly that kind, and it stays only
if the receipts show it beats the brief-only control. Evidence:
`plugins/code-ops-suite/hooks/ladder-card.mjs:6-10`.

## Host projections

The first host renderer maps canonical plugin packages into its marketplace projection and manifest. The opencode renderer maps them into `opencode-dist/`, including host-specific commands, agents, and configuration. Evidence: `AGENTS.md:94-101` and `scripts/build-opencode-dist.mjs:475-489`.

## External dependencies

The repository has no runtime third-party package dependency. Model-driven deep review and
OpSec review execute locally, not on this repository's GitHub runner, and the gate names no
provider: a receipt records whichever reviewer identity ran it. The local
review gate needs only Git, Node, ignored receipt storage, and an available local reviewer.
GitHub review examples remain opt-in consumer integrations. Evidence: `scripts/check-no-deps.mjs:24-28`
and `scripts/local-review-gate.mjs:1-39`.

`ctags` and `codegraph` are optional external tools, not dependencies. `preflight.mjs` prints
each one as present or absent beside its other capability lines, and their absence never fails a
preflight. `context-query.mjs` spawns one only when `refresh --provider` names it, and without
one the index falls back to its own line rules. Evidence: `scripts/preflight.mjs:93-99` and
`scripts/context-query.mjs:208-213`.

## Operational limits

The context compiler sets a 30-second timeout for repository-map, import-graph, and Atlas commands. It limits subprocess output to 64 MiB. Evidence: `scripts/context-snapshot.mjs:52-59` and `61-105`.

The runtime receipt chain has a 32 MiB limit. Each configured stable prefix has its own byte
limit. Stable-prefix files must be regular stage-0 tracked UTF-8 text without linked
components. Evidence: `scripts/context-index-lib.mjs:82-110` and
`scripts/runtime-lib.mjs:148-172`, `303-351`.

## Record tooling distribution

`records.mjs` and `record-lib.mjs` are canonical root scripts. The vendor manifest copies them byte-identically into the code-ops-suite package. Codex and opencode renderers then carry that package into their generated host projections.

Record tooling uses Git and Node built-ins only. It stores generated inventories, citation baselines, curation JSONL, and semantic indexes beneath the documentation hub. Historical record bodies remain at their registered repository paths.
