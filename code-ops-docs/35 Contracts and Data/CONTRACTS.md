---
type: reference
status: current
updated: 2026-08-24
---

# Contracts

## Run contract

`RUN_CONTRACT.json` is the machine-checked plan for an orchestrated run. `run-contract.mjs` supports versions 1 and 2. Version 2 adds a required context binding. Evidence: `scripts/run-contract.mjs:10-24` and `scripts/run-contract.mjs:67-83`.

Each contract declares these top-level concerns:

- `quality` defines ordered criteria, proof, oracle, owner, and blocking status.
- `budget` limits dispatches, concurrent work, and retries per unit.
- `units` define scope, artifact, dependencies, routing, and quality criteria.
- `context` binds version 2 work to a snapshot, bundle location, untracked-file policy, and byte budgets.

The validator requires the lead to use a strong-or-frontier model at high effort. Execution, judgment, and review units have separate tier and effort floors. Evidence: `scripts/run-contract.mjs:84-125`.

## Snapshot receipt

`CONTEXT_SNAPSHOT.json` identifies one visible repository state. Its identifier covers Git head, staged state, unstaged state, untracked-file policy, and generator digests. Ignored content is excluded by policy. Evidence: `scripts/context-index-lib.mjs:99-166` and `scripts/context-snapshot.mjs:143-170`.

The snapshot command can generate a delta only when it receives both a previous receipt and a delta output. A changed snapshot requires a new contract revision and affected bundles. Evidence: `scripts/context-snapshot.mjs:30-35`, `scripts/context-snapshot.mjs:123-170`, and `scripts/run-contract.mjs:57-65`.

## Context bundle

`CONTEXT_BUNDLE.json` binds one work unit to a version 2 contract revision and snapshot identifier. It contains scoped repository-map entries, direct import relations, scoped visible changes, an optional snapshot delta, and Atlas material. Evidence: `scripts/context-bundle.mjs:41-75` and `scripts/context-bundle.mjs:108-149`.

The bundle never silently falls back to broad context. It writes `BROAD_CONTEXT_REQUIRED` for high-risk or oversized scope. It writes `BUDGET_EXCEEDED` when the rendered bundle exceeds `maxBundleBytes`. Evidence: `scripts/context-bundle.mjs:52-55` and `scripts/context-bundle.mjs:117-162`.

## Acceptance and result

`ACCEPTANCE.md` is an append-only table. Every row names a quality criterion, attempt number, verdict, proof, actor, and reason. Evidence: `scripts/run-contract.mjs:24`, `scripts/run-contract.mjs:188-205`, and `scripts/run-contract.mjs:218-224`.

Finalization requires every planned dispatch to be reported and every blocking criterion to have a latest `PASS` verdict. It writes a `RUN_RESULT.json` receipt only after those checks pass. Evidence: `scripts/run-contract.mjs:226-230`.

## Compatibility

Version 1 contracts remain valid without a context object. New context-bound runs use version 2. Do not add context fields to a version 1 contract. Evidence: `scripts/run-contract.mjs:71-83`.
