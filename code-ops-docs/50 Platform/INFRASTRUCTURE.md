---
type: reference
status: current
updated: 2026-09-13
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

The read-only `run-runtime.mjs status` surface bounds its event output and reports checkpoint, pending-dispatch, partial-acceptance, drift, and token-budget state. Context delivery is also bounded twice: `context-bundle.mjs view` produces a verified unit projection, and `worker-brief.mjs` enforces separate invariant, unit, and total byte limits with a source-bound receipt.

There is no application server, managed database, container image, Terraform root, or cloud-runtime configuration in the current repository. That is an inspected repository boundary, not a statement about hosts that install the marketplace.

## Repository infrastructure

GitHub Actions provides CI. GitHub hosts pull requests, branch protection, and the marketplace repository. `.github/actions-lock.json` owns the reviewed action identities, immutable SHAs, provenance, permissions, egress, telemetry, and advisory notes. The deterministic checker rejects mutable, unlisted, or drifted action references.

Git hooks can regenerate derived host distributions and reject unsafe staging conditions. CI remains the backstop when hooks are missing or bypassed. Evidence: `AGENTS.md:103-105`.

## Host hook switches

The code-ops-suite package registers seven commands across six events in
`plugins/code-ops-suite/hooks/hooks.json`. Every one is on by default where the host exposes
the required event contract. Six fail open on every path. The traceless guard intentionally
blocks a publishing command when it detects a trace and fails open on infrastructure errors.
Five commands carry an off switch, read from the canonical `.claude/settings.json`
environment. Rendered hosts use their documented process environment:

```json
{ "env": { "CODE_OPS_DIGEST": "off" } }
```

| Variable | Value that turns it off | What it governs |
| --- | --- | --- |
| `CODE_OPS_DIGEST` | `off`, `0`, or `false` | the `PreToolUse` output digest, `digest-rewrite.mjs` |
| `CODE_OPS_INDEX` | `off`, `0`, or `false` | the `PostToolUse` symbol-index refresh, `index-refresh.mjs` |
| `CODE_OPS_LADDER_CARD` | `off`, `0`, or `false` | the `SubagentStart` code-economy card, `ladder-card.mjs` |
| `CODE_OPS_RECEIPTS` | `off`, `0`, or `false` | the `SessionEnd` measurement row, `session-receipt.mjs` |
| `CODE_OPS_HANDOFF_CARD` | `off`, `0`, or `false` | the `UserPromptSubmit` context-size nudge, `handoff-card.mjs` |

Any other `CODE_OPS_RECEIPTS` value names the receipt ledger path.

Two variables name a storage path:

| Variable | What it names | Default |
| --- | --- | --- |
| `CODE_OPS_DIGEST_DIR` | the digest store root | `<host home>/code-ops/digest/<project slug>/` |
| `CODE_OPS_INDEX_DIR` | the symbol-index directory | `<host home>/code-ops/index/<project slug>/` |

`<host home>` is `~/.codex` under the Codex projection and `~/.claude` on every other host.
Evidence: `codex-marketplace/plugins/code-ops-suite/hooks/session-receipt.mjs:29`.

`CODE_OPS_DIGEST_STORE=off` keeps compression enabled while disabling raw-output and receipt storage.

The two commands with no switch are `enforce-traceless.mjs` at `PreToolUse` and
`routing-card.mjs` at `SessionStart`. There is no `PreCompact` command. Claude and Codex
instead receive a durable-state restore instruction on `SessionStart source=compact`; this
runs after compaction and does not alter the summary that was already produced. The
[contracts reference](../35%20Contracts%20and%20Data/CONTRACTS.md) owns each command's
contract. Evidence: `plugins/code-ops-suite/hooks/hooks.json` and
`plugins/code-ops-suite/hooks/routing-card.mjs`.

## What the local stores hold

Leaving `digest-rewrite.mjs` on persists the complete raw output of every rewritten command, in
plain text, under `<host home>/code-ops/digest/<slug of the repository>/`, with a receipt row that
records the command's arguments as written. Nothing purges that store. Delete the directory to
purge it. `CODE_OPS_DIGEST_STORE=off` beside the switch keeps the compression and writes nothing,
at the cost of the recovery hints. The store is keyed by the repository that opted in, never by a
`cd` target inside a command. Evidence: `plugins/code-ops-suite/hooks/digest-rewrite.mjs:12-16`
and `plugins/code-ops-suite/hooks/digest-rewrite.mjs:161-176`.

The symbol index lives under `<host home>/code-ops/index/<slug of the repository>/` or
`$CODE_OPS_INDEX_DIR`, never in the tree, and holds definitions, call sites, and import edges,
never file bodies. Delete the directory to purge it. Evidence:
`plugins/code-ops-suite/hooks/index-refresh.mjs:6-11` and
`plugins/code-ops-suite/hooks/index-refresh.mjs:25-36`.

The session-receipt ledger is `<host home>/code-ops/session-receipts.jsonl`, or `$CODE_OPS_RECEIPTS`.
`context-audit.mjs receipts --purge-before <ISO date>` is the only thing that removes rows, so
retention stays one operator command. Evidence: `scripts/context-audit.mjs:8-16`.

The handoff-card marker store is `<host home>/code-ops/handoff/<project slug>/<session id>.json`,
one small file per session holding the highest 200,000-token band already nudged. It has no
override variable and nothing purges it automatically; delete the directory to purge it.
Evidence: `plugins/code-ops-suite/hooks/handoff-card.mjs:79-92`.

`context-audit.mjs --host codex` reads local Codex session JSONL, filters to the current
directory unless `--all` is present, and normalizes current response usage. A receipt follows
child rollout `parent_thread_id` links rather than assuming Claude's nested directory layout.
For installed Grok 1.0.13, the receipt parser reads cumulative per-prompt snapshots from the
session's `updates.jsonl` and records `ladderCard=false`. The report omits tool arguments and
working-directory values unless raw output was explicitly requested.

Keeping a switch per repository is what makes a measurement arm possible: one checkout runs with
the mechanism and another runs without it, and their session receipts compare. The
[measurements reference](../55%20Operations/MEASUREMENTS.md) owns the baseline rows and the
comparison method. The `ladder-card.mjs` card is an arm of exactly that kind, and it stays only
if the receipts show it beats the brief-only control. Evidence:
`plugins/code-ops-suite/hooks/ladder-card.mjs:6-10`.

## Host projections

Claude and Grok consume the canonical packages. Codex and OpenCode consume deterministic
host projections. Parity means equivalent behavior through each host's supported API, not
byte-identical packaging.

| Capability | Claude | Grok | Codex | OpenCode |
| --- | --- | --- | --- | --- |
| Skills and scripts | Native | Native package | Rendered | Rendered |
| Operative floors | Native agent metadata | Preflight with collapsed model ladder | `model-floors.json` plus role brief | `chat.params` gate plus preflight carrier |
| Publishing gate | `PreToolUse` | Canonical command hook | Payload-adapted hook | `tool.execute.before` port |
| Digest and index | Native hooks | `updatedInput` digest and `PostToolUse` index side effect | Payload-adapted hooks | Mutable tool arguments and `file.edited` port |
| Routing and compaction | Session context and `source=compact` restore | Instruction files only; passive stdout unavailable | Projected session context and restore | System-transform and compaction ports |
| Documentation MCP | Plugin manifest | Plugin manifest | Projected MCP manifest | Runtime `config` hook with local commands |
| Ladder card | Native | Instruction files only; receipt arm is false | Projected hook | Unavailable: no typed subagent-start callback |
| Session receipt | Native transcript callback | `updates.jsonl` side effect | Child rollouts followed by `parent_thread_id` | Unavailable: no transcript callback |
| Handoff card | Native | Instruction files only; passive stdout unavailable | Projected hook; silent if the payload omits `transcript_path` | Unavailable: no transcript or usage callback |

The Codex renderer removes Claude-only matchers and lets normalized payload adapters filter
the actual tool. The OpenCode renderer translates both slash and bare canonical skill names,
blocks unknown or below-floor operative models, and derives local MCP paths from the plugin
module. Its compatibility page names the two host gaps instead of claiming nonexistent
hooks. The Grok behavior above is local runtime evidence from installed version 1.0.13 and
`~/.grok/docs/user-guide/10-hooks.md`. The deterministic evals prove accepted output shapes
and side effects; they do not claim that a fresh live external model turn was run during this
change. Evidence: `scripts/build-codex-marketplace.mjs`,
`scripts/build-opencode-dist.mjs`, and `evals/grok-build-compat/run.mjs`.

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
