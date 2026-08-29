---
type: reference
status: current
updated: 2026-08-29
---

# Infrastructure

## Runtime

The project is a Node.js repository that intentionally uses only Node built-ins. `.node-version` is the runtime SSOT and selects Node 24 LTS. CI and local tooling consume that file rather than maintain separate Node versions. Evidence: `.node-version`, `.github/workflows/validate.yml`, and `scripts/check-no-deps.mjs`.

There is no application server, managed database, container image, Terraform root, or cloud-runtime configuration in the current repository. This is an inspected repository boundary, not a statement about hosts that install the marketplace.

## Repository infrastructure

GitHub Actions provides CI. GitHub hosts pull requests, branch protection, and the marketplace repository. `.github/actions-lock.json` owns the reviewed action identities, immutable SHAs, provenance, permissions, egress, telemetry, and advisory notes. The deterministic checker rejects mutable, unlisted, or drifted action references.

Git hooks can regenerate derived host distributions and reject unsafe staging conditions. CI remains the backstop when hooks are missing or bypassed. Evidence: `AGENTS.md:115-117`.

## Host projections

The first host renderer maps canonical plugin packages into its marketplace projection and manifest. The opencode renderer maps them into `opencode-dist/`, including host-specific commands, agents, and configuration. Evidence: `AGENTS.md:108-117` and `scripts/build-opencode-dist.mjs:475-489`.

## External dependencies

The repository has no runtime third-party package dependency. CI can call a Claude action for deep review and OpSec review when a credential is configured. Those integrations are bounded to pull-request workflows. Evidence: `scripts/check-no-deps.mjs:24-28`, `.github/workflows/deep-review.yml:28-137`, and `.github/workflows/opsec-gate.yml:28-140`.

## Operational limits

The context compiler sets a 30-second timeout for repository-map, import-graph, and Atlas commands. It limits subprocess output to 64 MiB. Evidence: `scripts/context-snapshot.mjs:72-79` and `scripts/context-snapshot.mjs:97-106`.

## Record tooling distribution

`records.mjs` and `record-lib.mjs` are canonical root scripts. The vendor manifest copies them byte-identically into the code-ops-suite package. Codex and opencode renderers then carry that package into their generated host projections.

Record tooling uses Git and Node built-ins only. It stores generated inventories, citation baselines, curation JSONL, and semantic indexes beneath the documentation hub. Historical record bodies remain at their registered repository paths.
