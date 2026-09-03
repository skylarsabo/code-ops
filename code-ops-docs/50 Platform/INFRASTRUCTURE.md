---
type: reference
status: current
updated: 2026-09-01
---

# Infrastructure

## Runtime

The project is a Node.js repository that intentionally uses only Node built-ins. `.node-version` is the runtime SSOT and selects Node 24 LTS. CI and local tooling consume that file rather than maintain separate Node versions. Evidence: `.node-version`, `.github/workflows/validate.yml`, and `scripts/check-no-deps.mjs`.

Long-horizon runs use an explicit, ignored host-capability descriptor. The descriptor records
host, provider, model, observation source, and five capability states. Runtime receipts and
default metrics retain only its digest, states, and policy outcomes. The tools do not infer
capabilities from a model name. Initialization rejects Git-visible paths and linked components
before writing raw provenance. Evidence: `scripts/host-capabilities.mjs:1-79` and
`scripts/runtime-lib.mjs:17-29`, `193-218`.

The runtime stores a hash-chained receipt log at a repository-ignored path. It serializes mutations with a lock. A checkpoint or resume fails when its contract, capability receipt, stable prefix, ledger, bundle, or artifact has drifted. Evidence: `scripts/run-runtime.mjs:96-136`, `205-218`, and `253-292`.

There is no application server, managed database, container image, Terraform root, or cloud-runtime configuration in the current repository. This is an inspected repository boundary, not a statement about hosts that install the marketplace.

## Repository infrastructure

GitHub Actions provides CI. GitHub hosts pull requests, branch protection, and the marketplace repository. `.github/actions-lock.json` owns the reviewed action identities, immutable SHAs, provenance, permissions, egress, telemetry, and advisory notes. The deterministic checker rejects mutable, unlisted, or drifted action references.

Git hooks can regenerate derived host distributions and reject unsafe staging conditions. CI remains the backstop when hooks are missing or bypassed. Evidence: `AGENTS.md:115-117`.

One bundled host hook is opt-in per repository. `digest-rewrite.mjs` stays inert until
`CODE_OPS_DIGEST` holds `1`, `on`, or `true` in its environment, and a repository sets that in
the `env` block of its own `.claude/settings.json`, which is the only supported way to turn it
on:

```json
{ "env": { "CODE_OPS_DIGEST": "on" } }
```

Turning it on persists the complete raw output of every rewritten command, in plain text, under
`~/.claude/code-ops/digest/<slug of the repository>/`, together with a receipt row that records
the command's arguments as written. Nothing purges that store; delete the directory to purge it.
`CODE_OPS_DIGEST_STORE=off` beside the switch keeps the compression and writes nothing, at the
cost of the recovery hints. The store is keyed by the repository that opted in, never by a
`cd` target inside a command. Nothing else reads the variable, no default anywhere turns it on,
and removing the block turns it off again. Keeping the switch per repository is what makes the measurement arm possible: one
checkout runs with the digest and another runs without it, and their session receipts compare.
Evidence: `plugins/code-ops-suite/hooks/digest-rewrite.mjs:12-15` and
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:161`.

A second opt-in hook, `ladder-card.mjs`, runs at `SubagentStart` and hands an implementer-class
subagent the code-economy ladder as a card of at most ten lines. It stays inert until
`CODE_OPS_LADDER_CARD` holds `1`, `on`, or `true` in the same `env` block. It writes nothing to
disk and reads nothing but the payload. The card is an experiment arm: Phase 6 of the context and
code economy note keeps it only if the session receipts show it beats the brief-only control.
Evidence: `plugins/code-ops-suite/hooks/ladder-card.mjs:6-10` and
`plugins/code-ops-suite/hooks/ladder-card.mjs:51`.

A third opt-in hook, `index-refresh.mjs`, runs after every Edit, Write, MultiEdit, and
NotebookEdit and re-indexes the one file changed, so `context-query.mjs` answers from the live
tree without a daemon. It stays inert until `CODE_OPS_INDEX` holds `1`, `on`, or `true` in the
same `env` block. The index lives under `~/.claude/code-ops/index/<slug of the repository>/` or
`$CODE_OPS_INDEX_DIR`, never in the tree, and holds definitions, call sites, and import edges,
never file bodies. Delete the directory to purge it. Evidence:
`plugins/code-ops-suite/hooks/index-refresh.mjs:6-11` and
`plugins/code-ops-suite/hooks/index-refresh.mjs:25-36`.

## Host projections

The first host renderer maps canonical plugin packages into its marketplace projection and manifest. The opencode renderer maps them into `opencode-dist/`, including host-specific commands, agents, and configuration. Evidence: `AGENTS.md:108-117` and `scripts/build-opencode-dist.mjs:475-489`.

## External dependencies

The repository has no runtime third-party package dependency. Model-driven deep review and
OpSec review execute locally through Codex, not on this repository's GitHub runner. The local
review gate needs only Git, Node, ignored receipt storage, and an available local reviewer.
GitHub review examples remain opt-in consumer integrations. Evidence: `scripts/check-no-deps.mjs:24-28`
and `scripts/local-review-gate.mjs:1-39`.

## Operational limits

The context compiler sets a 30-second timeout for repository-map, import-graph, and Atlas commands. It limits subprocess output to 64 MiB. Evidence: `scripts/context-snapshot.mjs:52-59` and `61-105`.

The runtime receipt chain has a 32 MiB limit. Each configured stable prefix has its own byte
limit. Stable-prefix files must be regular stage-0 tracked UTF-8 text without linked
components. Evidence: `scripts/context-index-lib.mjs:82-110` and
`scripts/runtime-lib.mjs:148-172`, `303-351`.

## Record tooling distribution

`records.mjs` and `record-lib.mjs` are canonical root scripts. The vendor manifest copies them byte-identically into the code-ops-suite package. Codex and opencode renderers then carry that package into their generated host projections.

Record tooling uses Git and Node built-ins only. It stores generated inventories, citation baselines, curation JSONL, and semantic indexes beneath the documentation hub. Historical record bodies remain at their registered repository paths.
