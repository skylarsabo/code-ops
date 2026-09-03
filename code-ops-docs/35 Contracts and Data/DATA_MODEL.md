---
type: reference
status: current
updated: 2026-09-01
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
| Host capabilities | SHA-256 file digest | Names host evidence and one state per runtime capability. |
| Runtime receipt | `sequence`, SHA-256 `receiptSha256` | Binds runtime inputs to the preceding receipt. |
| Local review plan | SHA-256 `planSha256` | Binds one feature-branch diff and its two required gates. |
| Local review receipt | `sequence`, SHA-256 `receiptSha256` | Binds one gate report to a local review plan. |
| Judgment-eval plan | SHA-256 `planSha256` | Binds fixtures, inputs, model arms, execution availability, and findings paths. |
| Judgment-eval receipt | SHA-256 `receiptSha256` | Binds deterministic score and capability evidence to one eval plan. |
| Dispatch ledger row | `D-NNN` | Mirrors one planned unit and records its status. |
| Acceptance row | criterion and attempt | Supplies proof and an authorized verdict. |

The identifier formats, ordered quality criteria, and unit dependency rules are validated by `run-contract.mjs`. Evidence: `scripts/run-contract.mjs:67-140`.

## Runtime records

A v3 contract's `runtime` object names the capability descriptor and JSONL receipt path,
the ordered `stablePrefix`, `maxStablePrefixBytes`, and capability policy. Its receipt
binding captures the contract-file digest, head, snapshot identity and receipt digest,
host descriptor digest, capability states and outcomes, and compiled-prefix metadata. Raw
descriptor labels and observation time stay outside the runtime chain. The descriptor writer
requires an ignored path without linked components. Head is an exact full Git object ID.
Capability and receipt paths are distinct under portable case folding and
cannot alias one physical file. Evidence:
`scripts/runtime-lib.mjs:26-37`, `scripts/runtime-lib.mjs:173-218`.

The stable-prefix metadata contains its digest, total bytes, and ordered entries. Each
entry contains an exact repository-relative path, source-file digest, and byte count.
Sources must be regular stage-0 index files without linked components. Evidence:
`scripts/context-index-lib.mjs:82-110`, `scripts/runtime-lib.mjs:148-172`, and
`scripts/runtime-lib.mjs:258-270`.

Each runtime receipt stores version, sequence, kind, UTC timestamp, predecessor digest,
binding, references, observation, and receipt digest. References can name a ledger and its
journal, an acceptance ledger, a handoff, bundles, and artifacts. File references retain
their repository-relative paths and digests. Evidence: `scripts/runtime-lib.mjs:27-38` and
`scripts/runtime-lib.mjs:228-289`.

An observation has observability, ordered unique cache events, source, and nullable
nonnegative token counters. It is evidence supplied by provider usage, host telemetry, or
an operator. It is not inferred from a capability state or model name. Evidence:
`scripts/runtime-lib.mjs:291-304`.

## Local judgment records

A local review plan stores version, branch, base reference and SHA, head SHA, binary diff
digest, sorted changed paths, ignored receipt path, fixed gate names, creation time, and
plan digest. Its two gate names are `local-deep-review` and `local-opsec-gate`. Hidden
`assume-unchanged` or `skip-worktree` index state invalidates preparation and replay. Evidence:
`scripts/local-review-gate.mjs:35-43`, `scripts/local-review-gate.mjs:141-185`, and
`scripts/local-review-gate.mjs:357-383`.

A local review receipt stores version, sequence, gate, verdict, timestamp, reviewer and
model label, tier, effort, plan digest, report path/digest/bytes, finding counts,
predecessor digest, and receipt digest. Reviewer and model labels are attestations. The
schema validates their syntax and declared routing values but does not authenticate the
person or model with hardware-backed identity. Evidence:
`scripts/local-review-gate.mjs:194-269` and `scripts/local-review-gate.mjs:384-436`.

The receipt chain has one report per required gate. It is valid only when every report is
ignored, byte-identical to its receipt reference, bound to the current plan, and linked by
the prior receipt digest. Ignored authority paths cannot portably alias tracked Git paths.
Reviewer IDs and physical report files must also be distinct.
Device and inode identity remains full-width instead of passing through JavaScript numbers.
Optional GitHub statuses are external projections of passing receipts, not part of the local
data model. Evidence:
`scripts/local-review-gate.mjs:184-259` and `scripts/local-review-gate.mjs:274-468`.

A judgment-eval plan stores its mode, execution policy, current head, matrix receipt,
selected model IDs, generated units, creation time, and digest. Each worker unit names a
fixture, tier, arm, replication, target, skill documents, and ignored findings path; it does
not expose the answer key. Ambiguous Git index flags invalidate planning and replay. Ignored
authority paths reject linked components or portable aliases to tracked Git paths. A score
output cannot physically alias the plan or a findings file. A score receipt stores the plan,
head, execution policy, completion totals,
per-unit findings and score digests, and its own digest. Evidence:
`scripts/judgment-evals.mjs:121-186` and `scripts/judgment-evals.mjs:188-329`.

## Structural cache

The context cache is content addressed by `snapshotId`. Snapshot preparation and replay
reject hidden Git-index flags before observing worktree state. Each entry contains
`REPO_MAP.md`, `IMPORT_GRAPH.md`, `ATLAS_STATE.txt`, and `META.json`, with SHA-256 values
recorded for every payload. Evidence: `scripts/context-snapshot.mjs:81-124` and
`scripts/context-index-lib.mjs:67-110`, `scripts/context-index-lib.mjs:225-277`.

The cache can be reused only when its identifier, generator identity, and payload digests verify. A corrupt target is retained with an `.invalid-<timestamp>` suffix before replacement. Evidence: `scripts/context-snapshot.mjs:81-124`.

## Atlas data

An Atlas has a `MANIFEST.json` with versioned sections, scope declarations, and freshness state. `atlas-check.mjs` rejects missing or malformed manifests. Evidence: `scripts/atlas-check.mjs:350-418` and `scripts/atlas-check.mjs:494-708`.

A section may also carry `claims`, one entry per `path:line` citation in its prose. Each entry has a repository-relative `file`, a positive `line`, and an optional `anchor` copied verbatim from that line at stamp time: backtick-free, at most 80 characters. A credential-shaped line records the `<REDACTED-LINE>` sentinel instead of its own text, and a line yielding no usable substring records no anchor and is checked for existence only. `stamp` is the only writer, and a malformed entry fails the manifest closed. Evidence: `scripts/atlas-check.mjs:255-288` and `scripts/atlas-check.mjs:404-414`.

Only fresh Atlas sections can contribute prose to a context bundle. A stale section contributes metadata, not an authoritative excerpt. Evidence: `scripts/context-bundle.mjs:58-74`.

## Session receipts

A session receipt is one JSON line, version `1`, with `ts`, `sessionId`, `cwd`, `reason`, `durationMs`, `models`, `turns`, `toolCalls`, `toolResultChars`, `contextAtEnd` (the tokens the last assistant message carried in), `arms` (`digest`, `ladderCard`, and `index`, each a boolean read from the same switch the hook reads), `files`, `skipped`, and `tokens` split into `main` and `subagents`, each with `input`, `cacheRead`, `cacheCreate`, `output`, `thinking`, and `total`. Usage is deduplicated by message id because the host writes one assistant message as several transcript lines that repeat the same usage block. Evidence: `plugins/code-ops-suite/hooks/session-receipt.mjs:54-68` and `scripts/transcript-lib.mjs:141-156`.

The ledger lives outside the repository, at `~/.claude/code-ops/session-receipts.jsonl` or `$CODE_OPS_RECEIPTS`, so by default it is never inside a repository. Setting `CODE_OPS_RECEIPTS=off` disables the hook. Rows carry the working directory path and no transcript content.

## Digest receipts

A digest receipt is one JSON line, version `1`, with `ts`, `cwd`, `argv`, `exit`, `shape`,
`bytesIn`, `bytesOut`, `linesIn`, `linesOut`, `sha256`, and `raw`. `argv` holds the command
tokens exactly as the caller gave them. `sha256` covers the raw file named by `raw`, which holds
the command's stdout, then a `----- stderr -----` separator and its stderr when stderr is not
empty. `linesIn` counts that whole file; `linesOut` counts what the digest printed, including its
trailer. Evidence: `scripts/digest.mjs:254-269` and `scripts/digest.mjs:230-233`.

A row's `cwd` is the directory the command ran in, which under `--cwd` is the target the caller named, while the store it is filed under follows the directory the digest started in. The store lives outside the repository, at `~/.claude/code-ops/digest/<project slug of cwd>/`,
unless `--store` or `$CODE_OPS_DIGEST_DIR` names another directory, and `--no-store` or
`CODE_OPS_DIGEST_STORE=off` outranks both and stores nothing. Raw files sit under
`<store>/<ISO date>/`; the ledger is `<store>/DIGEST_RECEIPTS.jsonl`. Both writes fail open, so a
run whose store is unwritable still prints a correct digest with no raw path. Rows carry the
working directory and the command, never the output. Evidence: `scripts/digest.mjs:166-195`.

## Symbol index

The index is one JSON document, version `1`, with `root`, `excludes`, `builtAt`, `head`, and
`files`. Each file entry carries `sha` and `size`, a `defs` list of `{name, kind, line, end,
sig}`, a `calls` list of `{name, line, member, from}`, and an `imports` list of `{spec, target,
names}` where `names` pairs a local binding with the exported name. A file over 512 KB or holding
a NUL byte keeps only its `sha`, `size`, and a `skipped` reason. The index holds no file body: a
signature is one trimmed line capped at 120 characters. Evidence: `scripts/context-query.mjs:94-103`
and `scripts/symbol-lib.mjs:46-64`.

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

Each authority batch links `previousBatchDigest` and binds the authority state before and after the operation. A non-genesis batch's `baseBindings.authorityBatchHead` equals that predecessor digest. Complete-history verification re-derives the source state and the manifest digest at the batch-introduction commit. A reachable adoption source also binds the exact reviewed candidates and their complete history profiles. Its batch type is `genesis-adoption`, `incremental-adoption`, `native-append`, or `v2-migration`.

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

Each reviewed batch keeps its exact candidate set. Authority coverage across batches remains exact once. Reachable review sources must contain those candidate bytes and the bound manifest. Incomplete history cannot prove candidate history or risk. Receipt digests provide integrity, not reviewer authentication. Total-history replacement needs an external trust anchor.
