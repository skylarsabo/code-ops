---
type: reference
status: current
updated: 2026-09-01
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

## Long-horizon runtime

Run Contract v3 adds a runtime boundary to the v2 context binding. The contract names a
host-capability receipt, a JSONL runtime receipt chain, ordered stable-prefix source
files, a prefix byte limit, and a policy for prompt caching, compaction, context editing,
host memory, and task budget. The contract validator verifies the context snapshot and
the runtime configuration before runtime work starts. Evidence:
`scripts/run-contract.mjs:11-27`, `scripts/run-contract.mjs:60-72`, and
`scripts/runtime-lib.mjs:73-106`.

`host-capabilities.mjs` writes one explicit descriptor. It records host, provider, model,
evidence source, observation time, and one state per capability. The descriptor does not
infer host behavior from the model name. Evidence: `scripts/host-capabilities.mjs:12-15`
and `scripts/host-capabilities.mjs:30-67`.

The stable-prefix compiler accepts only exact tracked UTF-8 text paths. It emits a framed,
ordered byte payload and records its digest, total bytes, and per-file digests. It rejects
invalid paths, NUL bytes, and payloads over the contract limit. Evidence:
`scripts/runtime-lib.mjs:142-166`.

The runtime creates an `init` receipt, then appends checkpoints, resumes, replans, and
optional observations under a runtime mutation lock. A checkpoint binds the verified
ledger, optional acceptance and handoff files, verified context bundles, and named
artifacts. Resume revalidates the latest checkpoint references. Replan retains the run ID
and advances exactly one revision. Evidence: `scripts/run-runtime.mjs:107-136` and
`scripts/run-runtime.mjs:186-290`.

Receipt replay verifies contiguous sequence numbers, predecessor digests, receipt digests,
binding stability, checkpoint requirements, and resume replay. This chain is the runtime
continuity record; source code remains authoritative for behavior. Evidence:
`scripts/runtime-lib.mjs:295-341`.

## Local judgment before PR

Model judgment happens locally before a pull request. `local-review-gate.mjs` prepares a
review plan only from a clean, non-default feature branch whose base is an ancestor of
`HEAD`. The plan binds base and head SHAs, a binary diff digest, and sorted changed paths.
Plan, report, and receipt paths must be ignored by Git. Evidence:
`scripts/local-review-gate.mjs:79-191` and `scripts/local-review-gate.mjs:363-389`.

The local gate has exactly two review domains: `local-deep-review` and
`local-opsec-gate`. Each report receipt is chained and binds the review plan, reviewer and
model label, tier, effort, verdict, confirmed and blocking finding counts, and report
digest. A check requires one passing receipt for each domain. Evidence:
`scripts/local-review-gate.mjs:32-40`, `scripts/local-review-gate.mjs:200-275`, and
`scripts/local-review-gate.mjs:390-484`.

Authority paths cannot use symbolic-link components or physical aliases, and the two gates
must name different reviewer identities. The publisher reads live remote refs without changing
the local tracking state. It requires the planned base and reviewed feature tip on one remote,
then derives the GitHub destination from that same remote.

Hosted CI remains the deterministic backstop. The `validate` workflow runs structural
checks and regression evals on pull requests, main pushes, and manual dispatch. It also
runs the local-review and judgment-orchestration fixture evals; it does not run a hosted
model-review service. Provider-specific action examples are compatibility paths, not the
source of the local judgment decision. Evidence: `.github/workflows/validate.yml:3-16`,
`.github/workflows/validate.yml:23-67`, and `.github/workflows/validate.yml:147-159`.

The optional status publisher first verifies the local receipt chain and both remote branch
tips, then posts one success status per gate. A receipt's reviewer, model, and execution fields
are attestations; the chains prove record integrity, not hardware-backed identity. Strict
required statuses provide the separate base-update invalidation boundary.

## Authority

Code is authoritative for behavior. The contract author chooses policy. The host descriptor
states only observed or operator-supplied capability evidence. Runtime receipts prove the
bound inputs and their sequence, not provider execution, elapsed time, or unreported cache
savings. Local judgment receipts prove the reviewed diff, report bytes, and receipt order.
They do not authenticate their reviewer or model labels. GitHub statuses are optional
external evidence and require write authority. This document describes the implementation
and must be updated with architecture-changing work. The documentation manifest identifies
the canonical documentation records and their source evidence.

## Documentation evidence boundary

`docs-manifest.mjs` validates the authored hub and its required domains. Manifest v2 also registers permanent record collections without transferring authored authority to their historical paths.

`records.mjs` owns collection classification, admission, permanent identity, citation state, curation, history verification, and semantic projections. Inventory v3 keeps one authority-batch chain for membership and provenance. The separate curation ledger owns status and supersession.

Every authority writer uses one clone-wide lock beneath Git's common directory. Optimistic bindings reject stale work from another clone. `docs-extract.mjs` gives affected documentation work only the collection inventory and semantic index. It never injects full record bodies by default.

This separation keeps the hub authoritative while preserving immutable evidence. It also keeps large repositories bounded: one context snapshot serves the run, and unchanged collections create no model dispatch.
