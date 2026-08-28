---
type: reference
status: current
updated: 2026-08-28
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

## Documentation manifest

Manifest v1 contains `version`, `hub`, and `domains`. Manifest v2 retains those fields and adds `runs`, `recordCollections`, and `legacyPaths`. Version 2 requires vault standard v4. Version 1 remains valid under standards v3 and v4 when no collection is declared.

Each record collection declares `id`, permanent `collectionUuid`, `identityVersion`, repository-relative `root`, four hub-relative generated paths, and total classification `scopes`. Omitted `classificationVersion` selects v1 scopes containing exactly `pattern`, `kind`, and `policy`.

`classificationVersion: 2` selects scopes containing exactly `id`, `match`, `paths`, `kind`, and `policy`. Exact tracked `paths` outrank glob `match` selectors. The manifest gate rejects stale exact paths and case mismatches. Record classification rejects multiple exact owners, multiple surviving glob owners, and zero owners. The single-owner rule makes scope order non-authoritative.

Legacy paths contain `path`, `disposition`, hub-owned `target`, and qualifying `requiredBy` evidence. Manifest synchronization updates domain digests only. It never creates pointers, tombstones, inventories, citation baselines, or curation events.

## Record operations

`records.mjs` exposes `classify`, `plan-adoption`, `adopt`, `curate`, `append`, `render`, `check`, `verify-history --strict`, and `reindex-locators`. Every authority mutation is a fail-closed transaction. Strict history failure is infrastructure failure. Evidence loss requires complete history.

`classify` reports partition validity and historical adoption readiness. Invalid classification reports `classification-invalid` even when history is unavailable. Uncommitted index candidates report `pending-commit` without invalidating structural classification. An immutable path outside authority blocks `check` as `pending-admission`.

Genesis `plan-adoption` writes only to a repository-relative ignored path. The plan binds `HEAD`, canonical Git-index manifest and candidate bytes, and path history. Historically revised immutable candidates require a `freeze-current` disposition and rationale. `adopt --review` recomputes every binding.

`plan-adoption --incremental` writes a version 2 plan with `mode: "incremental"`. Its `baseBindings` cover inventory, citations, curation, index, and the authority-batch head. `adopt` infers incremental mode only from this receipt.

An empty incremental delta prints `{"mode":"incremental","status":"no-op","reason":"no-pending-admission","candidates":0}` and writes nothing. `--require-delta` instead refuses with `incremental admission requires at least one pending immutable path`.

Inventory v3 preserves singular `adoptionReview` for genesis evidence and v2 compatibility. Its one growing `authorityBatches` chain records all immutable membership and provenance. Incremental batches embed or bind their reviewed payload through `reviewReceiptDigest`.

Each authority batch stores `version`, `sequence`, `type`, `previousBatchDigest`, `sourceHead`, `manifestSha256`, `priorAuthorityDigest`, `authorityDigest`, `baseBindings`, `objects`, `review`, `reviewReceiptDigest`, and `batchDigest`. Batch type is `genesis-adoption`, `incremental-adoption`, `native-append`, or `v2-migration`. Genesis has no prior generated state, so only non-genesis batches carry `baseBindings`. Their `authorityBatchHead` equals `previousBatchDigest`, and complete-history checks re-derive every binding from the source state or an earlier batch in the same transaction.

An `incremental-adoption` batch embeds its complete receipt in `review`. Genesis and v2 migration bind the singular `adoptionReview` by digest and set `review` to null. Native append sets both review fields to null.

Each `objects` entry stores `type`, `path`, and `objectDigest`. The `type` is `record` or `artifact`. `objectDigest` hashes the complete immutable inventory object. Every immutable inventory object has exactly one matching authority object across the complete chain.

Batch type and object provenance must agree:

| Batch type | Record requirement | Artifact requirement |
| --- | --- | --- |
| `genesis-adoption` | `provenance: "adopted"` | `provenance: "adopted"` |
| `incremental-adoption` | `provenance: "adopted"` | `provenance: "adopted"` |
| `native-append` | `provenance: "native"`; `introducedIndexHead` equals batch `sourceHead`; the path has no history through that source | Same constraints as the record object. |
| `v2-migration` | Preserve the existing valid record object. | Preserve the existing artifact object without adding provenance. |

A provenance-less artifact is valid only under `v2-migration`. Any other batch/provenance mismatch blocks authority validation. With complete history, each non-genesis source precedes its batch-introduction commit. A native object's exact path has no history through that source and appears first in the commit that records its batch.

The first non-empty v2 authority mutation emits a receipted `v2-migration` batch before the requested batch. It preserves existing record, artifact, citation, and genesis receipt objects. A first v3 inventory may use this type only after an observed committed v2 predecessor. Empty operations leave v2 unchanged.

The authority-batch chain never carries curation state. The curation ledger never proves inventory membership. The two chains share mutation serialization but retain separate predecessors and digests.

With complete history, post-adoption checks require:

- exact stage-0 Git-index blob bytes, no semantic index-to-worktree divergence, and exact classification;
- a 32 MiB maximum for each individual collection blob;
- consistent stored risk labels;
- current-risk rationale coverage;
- non-increasing risk counts;
- exact reviewed-candidate coverage within each applicable batch; and
- exact-once authority coverage across all immutable objects.

Incomplete history warns during ordinary checks. Strict verification treats it as infrastructure failure. Commit rewrites may change locator fields without invalidating authority. `sourceHead` never selects a verification mode. Protected repository review is the trust root for the unkeyed digest.

Failure ordering protects existing evidence first. Commands validate mode, clean state, complete history, and the existing baseline before candidate intake. They acquire the shared lock, then revalidate generated cleanliness, optimistic bindings, review, and history.

Commands build the complete mutation in memory after validation. They atomically replace generated files, verify the result, and roll back every replacement on failure. They release only the lock token that they acquired. A release anomaly cannot replace the original mutation error or turn durable success into a retry-triggering failure.

The clone-wide lock lives at `<git-common-dir>/code-ops-record-locks/<collectionUuid>.lock/owner.json`. Its owner stores `pid`, `token`, and `acquiredAt`. A live or recent owner fails with `collection mutation lock is held`. A dead owner at least ten minutes old is recoverable.

Adopted entries store `introducedCommit` for exact-path provenance. Inventory v2 and v3 add `baselineCommit` for citation resolution. Inventory v1 keeps `introducedCommit` and must not carry `baselineCommit`. Version 1 remains a readable legacy format without a review receipt. Protected review or an external anchor must distinguish a genuine grandfathered inventory from a newly authored downgrade.

Native records require YAML frontmatter containing `recordSchema: 1` and `supersedes: [...]`. The supersession value is a JSON array of full `REC-` IDs. Native append accepts only staged paths with no reachable exact-path history. Historically present records and newly immutable artifacts use reviewed incremental admission after genesis. Adopted records retain their original bytes and do not gain this schema.
