---
type: reference
status: current
updated: 2026-09-01
---

# Contracts

## Run contract

`RUN_CONTRACT.json` is the machine-checked plan for an orchestrated run.
`run-contract.mjs` supports versions 1, 2, and 3. Version 2 adds a required context
binding. Version 3 adds a required runtime binding and `runtime-drift` to the canonical
replan triggers. Evidence: `scripts/run-contract.mjs:11-27` and
`scripts/run-contract.mjs:75-114`.

Each contract declares these top-level concerns:

- `quality` defines ordered criteria, proof, oracle, owner, and blocking status.
- `budget` limits dispatches, concurrent work, and retries per unit.
- `units` define scope, artifact, dependencies, routing, and quality criteria.
- `context` binds version 2 work to a snapshot, bundle location, untracked-file policy, and byte budgets.
- `runtime` binds version 3 work to host-capability evidence, runtime receipts, a stable
  prompt prefix, a prefix byte budget, and one policy per capability.

The validator requires the lead to use a strong-or-frontier model at high effort. Execution, judgment, and review units have separate tier and effort floors. Evidence: `scripts/run-contract.mjs:84-125`.

## Snapshot receipt

`CONTEXT_SNAPSHOT.json` identifies one visible repository state. Its identifier covers Git
head, staged state, unstaged state, untracked-file policy, and generator digests. Ignored
content is excluded by policy. Snapshot preparation and replay reject `assume-unchanged`,
`skip-worktree`, and unresolved index states before hashing worktree bytes. Evidence:
`scripts/context-index-lib.mjs:67-110`, `scripts/context-index-lib.mjs:225-277`, and
`scripts/context-snapshot.mjs:108-170`.

The snapshot command can generate a delta only when it receives both a previous receipt and a delta output. A changed snapshot requires a new contract revision and affected bundles. Evidence: `scripts/context-snapshot.mjs:30-35`, `scripts/context-snapshot.mjs:123-170`, and `scripts/run-contract.mjs:57-65`.

## Context bundle

`CONTEXT_BUNDLE.json` binds one work unit to a version 2 contract revision and snapshot identifier. It contains scoped repository-map entries, direct import relations, scoped visible changes, an optional snapshot delta, and Atlas material. Evidence: `scripts/context-bundle.mjs:41-75` and `scripts/context-bundle.mjs:108-149`.

The bundle never silently falls back to broad context. It writes `BROAD_CONTEXT_REQUIRED` for high-risk or oversized scope. It writes `BUDGET_EXCEEDED` when the rendered bundle exceeds `maxBundleBytes`. Evidence: `scripts/context-bundle.mjs:52-55` and `scripts/context-bundle.mjs:117-162`.

Context bundles support both v2 and v3 contracts. A bundle still binds its run ID,
contract revision, work unit, snapshot, compiler digest, and bounded contents. Runtime
receipts reference a verified bundle by unit ID, bundle ID, path, and file digest.
Evidence: `scripts/context-bundle.mjs:44-54`, `scripts/context-bundle.mjs:160-214`, and
`scripts/run-runtime.mjs:177-183`.

## Host capabilities and policy

`HOST_CAPABILITIES.json` has version, host, provider, model, source, observation time,
and five named capability states: `promptCaching`, `compaction`, `contextEditing`,
`hostMemory`, and `taskBudget`. State is one of `controllable`, `managed-observable`,
`managed-unobservable`, `unsupported`, or `unknown`. The source is `operator`,
`host-probe`, or `provider-docs`. Evidence: `scripts/runtime-lib.mjs:17-22` and
`scripts/runtime-lib.mjs:100-127`.

Each v3 runtime policy is `off`, `prefer`, `require`, or `require-observable`. `require`
accepts only controllable or host-managed states. `require-observable` excludes
managed-unobservable states. `prefer` records `durable-fallback` for unavailable or unknown
features; `off` records `disabled`. Unsatisfied required policy fails contract validation.
Evidence: `scripts/runtime-lib.mjs:128-147` and `scripts/run-contract.mjs:60-72`.

## Stable prefix and runtime receipts

The stable prefix is an ordered list of regular stage-0 Git-index files. Compilation rejects
linked components and non-regular index modes before reading bytes. It frames each UTF-8
file in a deterministic payload and records its SHA-256 digest, byte count, and entries.
The payload must not exceed `maxStablePrefixBytes`. Evidence:
`scripts/context-index-lib.mjs:82-110` and `scripts/runtime-lib.mjs:148-172`.

`RUN_RUNTIME_RECEIPTS.jsonl` is an append-only hash chain. Every version-1 record has a
sequence, timestamp, predecessor digest, binding, references, optional observation, and
its own digest. The first record is `init`. Later records are `checkpoint`, `resume`,
`replan`, or `observation`. Replay rejects torn, blank, malformed, reordered, or
digest-invalid records. Evidence: `scripts/runtime-lib.mjs:24-38` and
`scripts/runtime-lib.mjs:310-340`.

The binding includes contract bytes, Git head, snapshot identity and receipt bytes, the host
descriptor digest, capability states and policy outcomes, and stable-prefix metadata. It
does not copy raw host, provider, model, source, or observation-time labels from the ignored
descriptor. An unchanged contract revision must retain this complete binding. A replan keeps
the run ID and increments the revision by one. Git heads are complete 40- or 64-digit object
IDs. Capability and receipt paths must differ portably and cannot share one physical file.
Evidence: `scripts/runtime-lib.mjs:173-218` and `scripts/runtime-lib.mjs:334-349`.

A checkpoint requires a strict dispatch-ledger reference and may bind acceptance, handoff,
bundle, and artifact files by digest. Resume replays and revalidates the latest checkpoint
references. Verification rejects any binding or referenced-file drift. Evidence:
`scripts/run-runtime.mjs:159-169`, `scripts/run-runtime.mjs:200-217`, and
`scripts/run-runtime.mjs:253-329`.

## Cache telemetry

An observation records cache observability as `observed`, `unobservable`, or `unsupported`.
It may record `hit`, `miss`, or `write` events and cache-read, cache-write, input, and
output token counts. Unobservable and unsupported observations cannot carry cache events or
token metrics. Provider-usage observations must carry at least one metric. The metrics view
reports normalized totals and event counts plus the minimized capability binding; raw host
provenance stays in the ignored descriptor. Elapsed time remains `UNKNOWN`. Evidence:
`scripts/runtime-lib.mjs:284-297`, `scripts/runtime-lib.mjs:352-386`, and
`scripts/run-runtime.mjs:293-317`.

## Local judgment gate

`local-review-gate.mjs` creates an ignored review plan for a clean non-default feature
branch. The plan binds `baseSha`, `headSha`, `diffSha256`, sorted `changedPaths`, its
receipt path, and the exact gate set: `local-deep-review` and `local-opsec-gate`. The base
must be an ancestor of head, and an empty diff is rejected. Evidence:
`scripts/context-index-lib.mjs:67-79`, `scripts/local-review-gate.mjs:83-185`, and
`scripts/local-review-gate.mjs:357-383`.

Each ignored JSONL receipt has a sequence, gate, verdict, timestamp, reviewer and model
label, tier, effort, plan digest, report reference, finding counts, predecessor digest,
and receipt digest. `PASS` requires zero blocking findings. A replay rejects report drift,
duplicate gates, foreign plans, missing final newlines, oversized chains, and invalid
sequence or predecessor links. A complete check requires exactly one passing receipt per
gate from a distinct reviewer identity. Authority files must not use linked components or
physical aliases. Evidence: `scripts/local-review-gate.mjs:35-43`,
`scripts/context-index-lib.mjs:55-79`, `scripts/local-review-gate.mjs:194-269`, and
`scripts/local-review-gate.mjs:384-436`.

The gate fails when a tracked or untracked worktree change, ambiguous Git index flag, branch
change, advanced base, changed head or diff, report drift, or receipt drift invalidates its plan. Prepare a new
plan after boundary drift. Reviewer and model fields are attestations. Their format is
validated, but the receipt chain does not provide hardware-backed identity. Evidence:
`scripts/local-review-gate.mjs:157-185` and `scripts/local-review-gate.mjs:194-269`.

`publish` is optional. After a passing local check, it can post one GitHub commit status
per receipt to the reviewed SHA. It verifies that SHA is remotely available. The caller
needs GitHub write authority for the status endpoint. A status is supplementary evidence;
publication failure does not alter the local pass or fail result. Evidence:
`scripts/local-review-gate.mjs:274-344` and `scripts/local-review-gate.mjs:441-468`.

## Judgment evals

`judgment-evals.mjs` plans provider-neutral local workers in `trend` or `floor` mode. It
binds the tracked matrix, fixture tree, answer key, relevant skill documents, selected
models, declared execution availability, and ignored findings paths to a lead-only plan.
Worker units omit answer-key paths. Planning and replay reject ambiguous Git index flags
before workers read fixtures. Floor mode rejects identical normalized model IDs. The
deterministic scorer binds each findings file, execution policy, and score output into a
receipt. Evidence: `scripts/judgment-evals.mjs:23-30`,
`scripts/judgment-evals.mjs:84-184`, and `scripts/judgment-evals.mjs:186-325`.

The matrix declares the fixture-to-answer-key and fixture-to-skill mapping. Its current
fixtures cover bug, leak, documentation-drift, normalization, and trap-focused review
work. Evidence: `evals/judgment-matrix.json:1-50`.

Hosted CI keeps deterministic validation. `validate.yml` runs the structural gate and
regression evals, including the local-review and judgment-orchestration fixture evals.
Provider action examples remain compatibility paths, not a substitute for local model
judgment. Evidence: `.github/workflows/validate.yml:23-67` and
`.github/workflows/validate.yml:147-159`.

## Acceptance and result

`ACCEPTANCE.md` is an append-only table. Every row names a quality criterion, attempt number, verdict, proof, actor, and reason. Evidence: `scripts/run-contract.mjs:24`, `scripts/run-contract.mjs:188-205`, and `scripts/run-contract.mjs:218-224`.

Finalization requires every planned dispatch to be reported and every blocking criterion to have a latest `PASS` verdict. It writes a `RUN_RESULT.json` receipt only after those checks pass. Evidence: `scripts/run-contract.mjs:226-230`.

## Compatibility

Version 1 contracts remain valid without `context` or `runtime`. Version 2 contracts
remain valid with `context` and without `runtime`. Version 3 requires both `context` and
`runtime`. Context bundles accept v2 and v3. The long-horizon runtime accepts v3 only.
Do not add context or runtime fields to a v1 contract, or runtime to a v2 contract.
Evidence: `scripts/run-contract.mjs:75-89`, `scripts/context-bundle.mjs:44-54`, and
`scripts/run-runtime.mjs:86-93`.

The local judgment gate is independent of Run Contract versions. It stores ignored review
plans and receipts rather than extending v1, v2, or v3 contracts. Evidence:
`scripts/local-review-gate.mjs:48-53` and `scripts/local-review-gate.mjs:248-468`.

## Documentation manifest

Manifest v1 contains `version`, `hub`, and `domains`. Manifest v2 retains those fields and adds `runs`, `recordCollections`, and `legacyPaths`. Version 2 requires vault standard v4. Version 1 remains valid under standards v3 and v4 when no collection is declared.

Each record collection declares `id`, permanent `collectionUuid`, `identityVersion`, repository-relative `root`, four hub-relative generated paths, and total classification `scopes`. Omitted `classificationVersion` selects v1 scopes containing exactly `pattern`, `kind`, and `policy`.

`classificationVersion: 2` selects scopes containing exactly `id`, `match`, `paths`, `kind`, and `policy`. Exact tracked `paths` outrank glob `match` selectors. The manifest gate rejects stale exact paths and case mismatches. Record classification rejects multiple exact owners, multiple surviving glob owners, and zero owners. The single-owner rule makes scope order non-authoritative.

Legacy paths contain `path`, `disposition`, hub-owned `target`, and qualifying `requiredBy` evidence. Manifest synchronization updates domain digests only. It never creates pointers, tombstones, inventories, citation baselines, or curation events.

## Record operations

`records.mjs` exposes `classify`, `plan-adoption`, `adopt`, `curate`, `append`, `render`, `check`, `verify-history --strict`, and `reindex-locators`. Every authority mutation is a fail-closed transaction. Strict history failure is infrastructure failure. Evidence loss requires complete history.

`classify` reports partition validity and historical adoption readiness. Invalid classification reports `classification-invalid` even when history is unavailable. Uncommitted index candidates report `pending-commit` without invalidating structural classification. An immutable path outside authority blocks `check` as `pending-admission`.

Genesis `plan-adoption` writes only to a repository-relative ignored path. Every record operation parses classification policy from canonical Git-index manifest bytes. Authority mutations revalidate that index snapshot before binding a batch and again after post-write verification. The plan binds `HEAD`, that manifest, candidate bytes, and path history. Historically revised immutable candidates require a `freeze-current` disposition and rationale. `adopt --review` recomputes every binding.

`plan-adoption --incremental` writes a version 2 plan with `mode: "incremental"`. Its `baseBindings` cover inventory, citations, curation, index, and the authority-batch head. `adopt` infers incremental mode only from this receipt.

An empty incremental delta prints `{"mode":"incremental","status":"no-op","reason":"no-pending-admission","candidates":0}` and writes nothing. `--require-delta` instead refuses with `incremental admission requires at least one pending immutable path`.

Inventory v3 preserves singular `adoptionReview` for genesis evidence and v2 compatibility. That slot requires receipt version 1. Its one growing `authorityBatches` chain records all immutable membership and provenance. Incremental batches require an embedded version 2 receipt and bind it through `reviewReceiptDigest`.

Each authority batch stores `version`, `sequence`, `type`, `previousBatchDigest`, `sourceHead`, `manifestSha256`, `priorAuthorityDigest`, `authorityDigest`, `baseBindings`, `objects`, `review`, `reviewReceiptDigest`, and `batchDigest`. Batch type is `genesis-adoption`, `incremental-adoption`, `native-append`, or `v2-migration`. Genesis has no prior generated state, so only non-genesis batches carry `baseBindings`. Their `authorityBatchHead` equals `previousBatchDigest`. Complete-history checks re-derive every predecessor binding and the manifest digest from the batch-introduction commit or an earlier batch in the same transaction. A reachable adoption source must contain every reviewed candidate and the bound manifest, and its candidate histories must equal the receipt profiles.

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

Commands build the complete mutation in memory after validation. One shared writer atomically replaces generated files, runs the complete semantic check, and rolls back every replacement on failure. The closing check includes the canonical manifest index snapshot, so shallow history cannot open a race. Commands prove the lock token and directory identity before authority writes and release.

Stale recovery quarantines the judged directory and compares its device and inode before deletion. A replacement lease is restored under an atomically reserved path and recovery fails. An ordinary release cleanup error preserves a durable success. Lost ownership exits 3 with a durable-mutation, do-not-retry message.

The clone-wide lock lives at `<git-common-dir>/code-ops-record-locks/<collectionUuid>.lock/owner.json`. Its owner stores `pid`, `token`, and `acquiredAt`. A live or recent owner fails with `collection mutation lock is held`. A dead owner at least ten minutes old is recoverable.

Adopted entries store `introducedCommit` for exact-path provenance. Inventory v2 and v3 add `baselineCommit` for citation resolution. Inventory v1 keeps `introducedCommit` and must not carry `baselineCommit`. Version 1 remains a readable legacy format without a review receipt. Protected review or an external anchor must distinguish a genuine grandfathered inventory from a newly authored downgrade.

Native records require YAML frontmatter containing `recordSchema: 1` and `supersedes: [...]`. The supersession value is a JSON array of full `REC-` IDs. Native append accepts only staged paths with no reachable exact-path history. Historically present records and newly immutable artifacts use reviewed incremental admission after genesis. Adopted records retain their original bytes and do not gain this schema.
