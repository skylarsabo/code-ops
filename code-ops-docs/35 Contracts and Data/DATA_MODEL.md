---
type: reference
status: current
updated: 2026-08-28
---

# Data Model

## Repository data

The marketplace stores text, JSON, and Markdown artifacts in Git. It has no application database, service-owned persistence layer, or runtime migration directory. This is a repository inspection finding, not a claim about downstream projects.

Canonical package metadata is JSON in `plugins/*/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. Generated marketplace metadata is a projection of that source. Evidence: `AGENTS.md:108-117`.

## Orchestration records

| Record | Identity | Required relationships |
| --- | --- | --- |
| Run contract | `runId`, `revision`, `head` | Contains quality criteria and ordered work units. |
| Work unit | `D-NNN` | References quality criteria and earlier dependencies. |
| Snapshot receipt | SHA-256 `snapshotId` | Binds the visible repository state and index generator. |
| Context bundle | SHA-256 `bundleId` | Binds one unit to one contract revision and snapshot. |
| Dispatch ledger row | `D-NNN` | Mirrors one planned unit and records its status. |
| Acceptance row | criterion and attempt | Supplies proof and an authorized verdict. |

The identifier formats, ordered quality criteria, and unit dependency rules are validated by `run-contract.mjs`. Evidence: `scripts/run-contract.mjs:67-140`.

## Structural cache

The context cache is content addressed by `snapshotId`. Each entry contains `REPO_MAP.md`, `IMPORT_GRAPH.md`, `ATLAS_STATE.txt`, and `META.json`, with SHA-256 values recorded for every payload. Evidence: `scripts/context-snapshot.mjs:81-124` and `scripts/context-index-lib.mjs:187-205`.

The cache can be reused only when its identifier, generator identity, and payload digests verify. A corrupt target is retained with an `.invalid-<timestamp>` suffix before replacement. Evidence: `scripts/context-snapshot.mjs:81-124`.

## Atlas data

An Atlas has a `MANIFEST.json` with versioned sections, scope declarations, and freshness state. `atlas-check.mjs` rejects missing or malformed manifests. Evidence: `scripts/atlas-check.mjs:174-224` and `scripts/atlas-check.mjs:301-437`.

Only fresh Atlas sections can contribute prose to a context bundle. A stale section contributes metadata, not an authoritative excerpt. Evidence: `scripts/context-bundle.mjs:58-74`.

## Retention and sensitivity

Run artifacts are repository-local working evidence. Do not put secrets, tokens, or personal data in a contract, cache, bundle, ledger, or documentation record. The repository has no modeled personal-data entity.

## Documentation records

| Record | Permanent identity | Mutable fields |
| --- | --- | --- |
| Collection | `collectionUuid` | Human `id` and presentation grouping. |
| Adopted record | Deterministic full `REC-` ID, indexed Git path, SHA-256 | External curation state only. |
| Native record | Deterministic full `REC-` ID, staged Git path, SHA-256 | External curation state only. |
| Authority batch | Sequence and `batchDigest` | None after acceptance; new authority appends a batch. |
| Citation | Record ID, source line, raw and normalized targets | Regenerable Git locator fields. |
| Curation event | Sequence and event digest | None after merge; corrections append replacement state. |
| Semantic index | Generator version and semantic digest | Rendering may change without changing semantics. |

The ID namespace hashes the collection UUID and normalized Git-index path. Collection labels do not affect identity. A split creates a new UUID for future records; a presentation merge preserves original namespaces.

Inventory v3 keeps one `authorityBatches` array. The singular `adoptionReview` remains genesis evidence and supports v2 migration. It is not a second growing chain.

Each authority batch links `previousBatchDigest` and binds the authority state before and after the operation. A non-genesis batch's `baseBindings.authorityBatchHead` equals that predecessor digest. Complete-history verification re-derives the source state. Its batch type is `genesis-adoption`, `incremental-adoption`, `native-append`, or `v2-migration`.

Incremental batches embed their complete receipt in `review`. Genesis and v2 migration bind the singular genesis receipt by `reviewReceiptDigest`. Native append carries no review payload.

Each batch contains complete object references shaped as `{type, path, objectDigest}`. Object type is `record` or `artifact`. The union of all batches covers every immutable inventory object exactly once.

The batch type constrains each referenced inventory object's provenance. Genesis and incremental objects use `adopted`. Native objects use `native`. Every native object binds `introducedIndexHead` to the batch `sourceHead`. Its exact path has no history through that source and first appears with the committed batch.

Existing v2 records retain their valid provenance during migration. Existing v2 artifacts retain their exact provenance-less shape. Only `v2-migration` may cover such an artifact, migration cannot manufacture provenance, and a committed v2 predecessor must exist.

The authority-batch chain records membership and provenance. The curation ledger records status and supersession. It is ordered JSONL, and every event links the prior global event and prior event for its record. A curation event contains complete metadata state, not a patch.

`targetSha256` is authoritative for mutable evidence. Object format, blob OID, commit OID, and path are locators that may be regenerated after repository hash migration.

Collection classification has an independent version. Version 1 uses one glob pattern per scope. Version 2 gives each scope a stable ID, glob selectors, and exact-path selectors. This version never changes record identity.

An adoption history profile stores:

- exact-path admission and content-baseline commits;
- lineage bounds in `firstRelevantCommit` and `lastRelevantCommit`;
- content-transition and prior-incarnation counts;
- current SHA-256; and
- `historyDigest`.

The digest uses SHA-256 content identities and paths instead of Git object IDs. Admission stays anchored to the current path. Readiness also follows earlier promoted paths. Every review plan binds the profile to `HEAD` and the manifest digest. An incremental review plan also binds current authority state.

Complete-history checks keep stage-0 Git-index blob bytes and classification exact. A content-aware Git comparison rejects semantic worktree divergence without treating checkout transformations as drift. Stored labels must agree with stored counts. Current risk retains review coverage, and counts cannot increase.

Each reviewed batch keeps its exact candidate set. Authority coverage across batches remains exact once. Incomplete history cannot prove candidate history or risk. Receipt digests provide integrity, not reviewer authentication. Total-history replacement needs an external trust anchor.
