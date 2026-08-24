---
type: reference
status: current
updated: 2026-08-24
---

# Architecture

## Purpose

Code-ops is a dependency-free marketplace of agent skills, agents, runtime scripts, and regression evals. Canonical plugin packages live under `plugins/`. Host packages are generated projections, not independent implementations. The zero-dependency guard rejects non-`node:` imports. Evidence: `scripts/check-no-deps.mjs:24-28`.

## System boundaries

The repository has four behavior-bearing layers:

- `plugins/` contains the canonical Claude-format packages, skills, agents, conventions, and runtime scripts.
- `scripts/` contains canonical repository tooling, including renderers, validation, orchestration receipts, and repository-context compilation.
- `evals/` contains executable regression fixtures and score checks.
- `.github/workflows/` runs the merge gates on pull requests and the complete validation set on `main`.

The two host distributions are rendered from canonical packages. Both renderers expose a `--check` mode that fails on drift. Evidence: `AGENTS.md:108-117` and `scripts/build-opencode-dist.mjs:475-489`.

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

The `validate` workflow runs on pull requests and on pushes to `main`. It uses a per-ref concurrency group that cancels superseded validation runs. Evidence: `.github/workflows/validate.yml:3-20`.

## Planned agent work

`scripts/run-contract.mjs` validates a bounded run contract before reconciliation, acceptance recording, or finalization. A contract declares quality criteria, model routing, dispatch limits, write scopes, dependencies, and replan triggers. Evidence: `scripts/run-contract.mjs:10-24`, `scripts/run-contract.mjs:55-140`, and `scripts/run-contract.mjs:209-230`.

The contract rejects concurrent write scopes or artifacts that overlap in one wave. It also rejects duplicate non-review work with the same phase, lens, and scope. Evidence: `scripts/run-contract.mjs:126-137`.

The dispatch ledger records planned work and state transitions. A failed dispatch can move only to `redispatched`; a reported dispatch is terminal. Evidence: `scripts/dispatch-ledger.mjs:323-326`.

## Context compiler

The context compiler separates an exact repository snapshot from a per-unit bundle. A snapshot hashes visible Git state and generator identities, then reuses a content-addressed structural cache. Evidence: `scripts/context-index-lib.mjs:135-195` and `scripts/context-snapshot.mjs:72-124`.

A bundle selects files in the unit scope, direct import neighbors, visible changes, and freshness-gated Atlas excerpts. It fails with a marker when scope is broad or the byte budget is exceeded. Evidence: `scripts/context-bundle.mjs:52-83` and `scripts/context-bundle.mjs:85-164`.

## Authority

Code is authoritative for behavior. This document describes the implementation and must be updated with architecture-changing work. The documentation manifest identifies the canonical documentation records and their source evidence.

## Documentation evidence boundary

`docs-manifest.mjs` validates the authored hub and its required domains. Manifest v2 also registers permanent record collections without transferring authored authority to their historical paths.

`records.mjs` owns collection classification, adoption, permanent identity, citation state, curation, history verification, and semantic projections. `docs-extract.mjs` gives affected documentation work only the collection inventory and semantic index. It never injects full record bodies by default.

This separation keeps the hub authoritative while preserving immutable evidence. It also keeps large repositories bounded: one context snapshot serves the run, and unchanged collections create no model dispatch.
