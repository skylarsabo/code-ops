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
capabilities from a model name. Evidence: `scripts/host-capabilities.mjs:1-68` and
`scripts/runtime-lib.mjs:17-29`, `193-218`.

The runtime stores a hash-chained receipt log at a repository-ignored path. It serializes mutations with a lock. A checkpoint or resume fails when its contract, capability receipt, stable prefix, ledger, bundle, or artifact has drifted. Evidence: `scripts/run-runtime.mjs:96-136`, `205-218`, and `253-292`.

There is no application server, managed database, container image, Terraform root, or cloud-runtime configuration in the current repository. This is an inspected repository boundary, not a statement about hosts that install the marketplace.

## Repository infrastructure

GitHub Actions provides CI. GitHub hosts pull requests, branch protection, and the marketplace repository. `.github/actions-lock.json` owns the reviewed action identities, immutable SHAs, provenance, permissions, egress, telemetry, and advisory notes. The deterministic checker rejects mutable, unlisted, or drifted action references.

Git hooks can regenerate derived host distributions and reject unsafe staging conditions. CI remains the backstop when hooks are missing or bypassed. Evidence: `AGENTS.md:115-117`.

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
