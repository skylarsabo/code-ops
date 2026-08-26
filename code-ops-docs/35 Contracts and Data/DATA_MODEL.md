---
type: reference
status: current
updated: 2026-08-25
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
| Citation | Record ID, source line, raw and normalized targets | Regenerable Git locator fields. |
| Curation event | Sequence and event digest | None after merge; corrections append replacement state. |
| Semantic index | Generator version and semantic digest | Rendering may change without changing semantics. |

The ID namespace hashes the collection UUID and normalized Git-index path. Collection labels do not affect identity. A split creates a new UUID for future records; a presentation merge preserves original namespaces.

The curation ledger is ordered JSONL. Every event links the prior global event and the prior event for its record. The event contains complete metadata state, not a patch.

`targetSha256` is authoritative for mutable evidence. Object format, blob OID, commit OID, and path are locators that may be regenerated after repository hash migration.

Collection classification has an independent version. Version 1 uses one glob pattern per scope. Version 2 gives each scope a stable ID, glob selectors, and exact-path selectors. This version never changes record identity.

An adoption history profile contains the exact-path admission commit, baseline commit, rename lineage, content-transition count, prior-incarnation count, current SHA-256, and `historyDigest`. Admission remains anchored to the current path while readiness follows earlier promoted paths. The review plan binds those fields to `HEAD` and the manifest digest. Inventory v2 stores the candidate profiles, completed reviewed dispositions, and canonical receipt digest.
