# The repository documentation hub standard

Every product or research repository keeps one `<repo>-docs/` hub at its root. The hub is both the Obsidian vault and the only authored documentation tree. This removes the old split between a vault for design judgment and `docs/` for reference material.

## Base layout

Structural folders carry two-digit prefixes. `00` captures work; `10` through `79` hold domain content; `80` through `99` hold machinery.

| Folder | Holds |
| --- | --- |
| `00 Inbox/` | Unsorted observations. |
| `10 Design/` | Working architecture, designs, and specifications. |
| `20 Decisions/` | Decisions and ADRs. |
| `30 Architecture/` | Current architecture reference. |
| `35 Contracts and Data/` | Interfaces, contracts, and data models. |
| `40 Engineering/` | Code standards, handbook, and techniques. |
| `50 Platform/` | CI, delivery, and infrastructure. |
| `55 Operations/` | Runbooks and observability. |
| `60 Experience/` | Design system and experience contracts. |
| `70 Guides/` | Task-oriented guides. |
| `80 Runs/` | Dated run folders. |
| `90 Templates/` | Note and run templates. |
| `95 Attachments/` | Linked media and exports. |
| `98 System/` | `DOCS_MANIFEST.json`, atlas, indexes, and drift reports. |
| `99 Archive/` | Superseded material with forward links. |

A profile may add domain folders in the `10` through `79` band. It may declare a required domain not applicable only through the documentation manifest with concrete repository evidence. It never renumbers machinery.

## One documentation authority

Authored explanations, procedures, decisions, and references live in the hub. Source code, schemas, migrations, workflows, and configuration remain canonical for executable behavior. They feed documentation extraction but do not form a competing documentation tree. Host-required files such as `README.md`, `AGENTS.md`, and a package README may summarize or point into the hub.

`98 System/DOCS_MANIFEST.json` is the sole registry for topic ownership and source coverage. It names each domain's canonical target, status, evidence paths, source digest, and content digest. Manifest v2 also declares record collections, legacy paths, and explicit run tracking. `docs-manifest.mjs check` fails when required domains are absent, a target is missing, a digest is stale, or substantive authored Markdown remains under the legacy `docs/` tree without registered ownership.

## Durable record collections

A record collection preserves durable evidence that must retain its existing location. The hub remains the only authored authority. A registered historical record may remain at its stable path as governed evidence. Admission preserves its bytes and path. Curation and a canonical vault document can later supersede its authority.

A collection remains open after genesis adoption. Each admission is irreversible. Never rewrite admitted bytes, paths, inventory entry objects, authority batches, citation baselines, or curation events. Canonical aggregate files may append authority objects and regenerate semantic projections. Do not create a second documentation tree or a wholesale compatibility tree.

Use this compatibility matrix:

| Standard | Manifest | Result |
| --- | --- | --- |
| v3 | v1 | Valid. |
| v4 | v1 without collections | Valid. |
| v4 | v2 | Enables record collections. |
| v3 | v2 | Invalid. |

The checker accepts standard version 3 while v4 adoption remains explicit. Manifest v1 retains its existing grammar, including `domains`. Manifest v2 retains `domains` and adds `recordCollections`, `legacyPaths`, and explicit `runs.tracking`.

### Collection identity and classification

Each collection declares a permanent `collectionUuid`, mutable human `id`, `identityVersion`, root, inventory, citations, curation ledger, generated index, and scopes. All four generated paths live beneath `98 System/Records/` in the vault. A collection UUID never changes. A label may change. A split creates a new UUID for future records. A presentation merge preserves original UUID namespaces.

Every tracked file beneath a collection root receives one scope. Zero or ambiguous owners fail. Collections without `classificationVersion` use scope v1 objects containing exactly `pattern`, `kind`, and `policy`. V1 retains exact-one matching and has no precedence.

Scope v2 collections declare `classificationVersion: 2`. Each scope contains stable `id`, `match`, `paths`, `kind`, and `policy` fields. `match` and `paths` are arrays. Exact collection-relative `paths` outrank glob `match` selectors. Multiple exact owners fail. Without an exact owner, multiple glob owners fail. The single-owner rule makes selector and scope order non-authoritative. Exact paths must exist in the Git index with exact casing. Manifest synchronization never creates, reorders, or rewrites scopes.

Scopes distinguish immutable append-only records, mutable artifacts, frozen artifacts or executables, superseded artifacts or executables, and forbidden files. Mutable scopes remain classified and owned but are excluded from immutability hashing. Forbidden files, including tracked `.pyc`, block adoption.

Git index paths and casing are authoritative. Admission uses `git ls-files`. Native records stage before append and must have no reachable exact-path history. A historically present record or newly immutable artifact requires reviewed genesis or incremental admission. Untracked files may be reported but never receive IDs. Normalize a Git path with POSIX separators, Unicode NFC, exact index casing, and no dot segments.

Record IDs use `REC-<base32(first-128-bits(sha256("code-ops-record-v1\\0" + collectionUuid + "\\0" + normalizedGitPath)))>`. Store `identityVersion: 1` on each collection and inventory entry. Collisions fail. IDs never renumber, change, or get reused.

Human prose may show a globally unambiguous prefix of at least eight ID characters. Machine links use full IDs and Markdown links to generated full-ID anchors. Prefix ambiguity blocks.

Adopted records pin existing paths and bytes without a modern body schema. Native records use YAML frontmatter with exact `recordSchema: 1` and `supersedes: [...]` fields. `supersedes` is a JSON array of full record IDs and may be empty. A future schema change never invalidates an adopted record.

```yaml
---
recordSchema: 1
supersedes: ["REC-ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
---
```

### Authority membership and admission

Inventory v3 stores an append-only authority-batch chain. Authority batches prove membership and provenance. The curation ledger separately records status, supersession, and corrected metadata state. Never merge these chains.

Authority batch types are `genesis-adoption`, `incremental-adoption`, `native-append`, and `v2-migration`. Each batch has one sequence, prior batch digest, operation bindings, complete membership, review binding, and batch digest. Each non-genesis binding names the immediate prior batch head and is re-derived under complete history. Every immutable authority object belongs to exactly one batch. Missing, duplicate, forged, reordered, or broken membership fails.

`genesis-adoption` covers the initial reviewed candidate set. `incremental-adoption` covers committed immutable paths that arrive later. `native-append` covers staged native authority whose exact path has no history through the source commit and first appears with its batch. `v2-migration` preserves the complete existing v2 authority before its first non-empty v3 mutation and requires an observed committed v2 predecessor.

Batch type enforces provenance. Genesis and incremental batches cover only `adopted` records and artifacts. Native batches cover only `native` records and artifacts. Each native object binds `introducedIndexHead` to the batch `sourceHead`. The exact path has no history through that source and first appears with the committed batch.

Existing v2 records retain their valid provenance. V2 artifacts may lack provenance, and only `v2-migration` may cover that preserved shape. Migration never manufactures artifact provenance.

Incremental batches embed their complete version 2 review receipt. Genesis and v2 migration bind the singular version 1 `adoptionReview` by digest. Native append carries no review payload. A receipt never selects the schema of the slot that contains it.

Inventory v1 and v2 remain readable. Inventory v1 never gains authority-batch coverage; incremental admission requires inventory v2 or v3. The first non-empty authority mutation of inventory v2 writes a receipted `v2-migration` batch before the requested batch. An empty check, render, or incremental plan never changes the inventory version.

`plan-adoption --incremental --out <repo-relative-ignored-path>` requires inventory v2 or v3 and profiles only immutable Git-index paths absent from authority. The default empty delta exits zero, reports a machine-readable no-op, and writes nothing. Add `--require-delta` when automation must reject an empty delta.

Incremental plans bind the existing inventory, citations, semantic index, manifest, Git state, and authority-batch head. Adoption recomputes those bindings under the mutation lock before any write. Existing entries, citation baselines, and accepted receipts remain semantically unchanged.

Checks enforce exact-once authority coverage. An immutable tracked path without authority blocks as `pending-admission`. Existing evidence failures take precedence over intake status. History loss, immutable drift, broken receipts, and invalid authority must surface before `pending-admission`.

### Curation, citations, and historical evidence

Adopted record supersession uses an external append-only curation ledger. Each event stores a global sequence, previous event digest, record ID, previous event for that record, complete metadata state, informational `curatedAt`, and event digest. Sequence starts at one and follows file order. Global and per-record predecessor chains validate. The highest valid sequence wins. Corrections append complete replacement events.

All authority writers use one clone-wide collection mutation lock. Store the lock beneath Git's common directory and key it by collection UUID. This location serializes sibling worktrees. Writers prove the lock token and directory identity before authority writes and release. Optimistic authority bindings reject stale work from other clones.

The lock records its process and acquisition time. A live or recent lock fails closed. The tool may recover a lock only after ten minutes when its recorded local process is gone. Recovery quarantines the judged directory and deletes it only when device and inode still match. A replacement lease is restored under an atomically reserved path and recovery fails. Lost ownership after a durable mutation exits 3 and forbids automatic retry. Parallel curation tails cannot merge mechanically. The losing branch rebases and regenerates only its unmerged tail. CI rejects forks, duplicate sequences, broken hashes, and changed merged events.

The citation inventory stores every outbound Markdown citation with record ID, use-site source line, raw target, normalized target, ordered `resolvedVia`, state, and target metadata. It resolves inline links and images plus full, collapsed, and shortcut reference forms. Fenced, indented, and inline code is not citation syntax. Try the complete candidate as an exact path first. Then remove recognized suffixes in the applied order: accessors, line or range suffixes, symbols, fragments, and globs. Support repeated accessors.

`resolvedVia` is an ordered list of `exact`, `accessor-stripped`, `range-stripped`, `symbol-stripped`, `fragment-stripped`, and `glob-expanded`. Preserve each applied step. A literal bracket filename remains eligible for the exact-first resolution.

Citation states are `resolved-immutable`, `resolved-mutable`, `mutable-drifted`, `dead-at-adoption`, `ambiguous`, `external`, `glob`, `redirected`, `tombstoned`, `history-unavailable`, `evidence-lost`, and `digest-mismatch`. Baseline dead citations remain visible debt. A later resolved-to-dead transition blocks. Native records cannot introduce dead or ambiguous targets. Baseline debt must later receive a history pointer, tombstone, or explicit unresolved disposition.

An immutable record that cites a mutable artifact stores authoritative `targetSha256`. Git object IDs are regenerable locators only: object format, blob OID, commit OID, and path. Adoption resolves citations at the baseline commit where the adopted bytes last match the reviewed current bytes. It separately preserves the exact-path introduction commit. Native append resolves the staged record and target snapshot. Reindex locators only after bytes match `targetSha256`. A Git hash-algorithm migration changes locators, not evidence identity.

`classify` reports structural partition status and adoption readiness separately. A staged candidate without committed history remains partition-valid and reports `pending-commit`. Reviewed admission requires a clean, committed tree. Historical stability is a risk signal, never a safety claim. Path-bounded history queries profile every reviewed immutable candidate and follow its promotion lineage. A content transition or prior path incarnation requires review. Mutable artifacts remain outside this review.

`plan-adoption --out <repo-relative-ignored-path>` binds genesis review to `HEAD`, the manifest, current content, and canonical history. Historically revised candidates require `disposition: "freeze-current"` and a rationale. `adopt --review <repo-relative-ignored-path>` recomputes every binding before writing. Absolute paths are rejected because review receipts stay inside the repository's ignored run boundary.

With complete history, later checks require:

- exact-once authority-batch membership and exact candidate coverage within each reviewed batch;
- no immutable Git-index path outside authority;
- exact stage-0 Git-index blob bytes, no semantic index-to-worktree divergence, and exact classification;
- a 32 MiB maximum for each individual collection blob;
- internally consistent stored risk;
- a rationale for every currently risky candidate; and
- no increase in transition or prior-incarnation counts.

`sourceHead` is a pre-adoption binding and diagnostic locator. It never selects a weaker post-adoption check. Incomplete-history checks warn and cannot verify candidate risk. Strict verification fails that state as infrastructure. A warning or force flag cannot replace the adoption receipt.

`receiptDigest` is an unkeyed canonical checksum. It detects corruption and stale cross-field copies. It does not authenticate a reviewer or prove that unreachable receipt bytes survived. Protected repository review is the procedural trust root. Rewrite tolerance assumes the resulting tree preserves the receipt authority bytes. Total-history replacement requires an external signature or transparency log.

Inventory v1 remains readable for compatibility but has no adoption-review receipt and never migrates into the authority-batch chain. Inventory v2 has one genesis review without complete authority-batch coverage. Protected review must preserve the v2 boundary until a non-empty authority mutation performs the receipted v3 migration.

Present pinned historical content by default. Present the current path separately. Make drift visible. With complete history, missing digest content is `evidence-lost`.

Adoption refuses before writing in a shallow, partial, promisor-backed repository, or when required objects are missing. Append and curation also require complete history because they extend immutable authority. No shallow write fallback exists. Ordinary checks warn `history-unavailable`. `verify-history --strict` fails as infrastructure configuration, not evidence corruption. Use `evidence-lost` only with complete history. GitHub Actions adopters use `fetch-depth: 0` and `filter: ""`. Ambiguous historical resolution requires an explicit reviewed disposition. Never use current-state fallback. Historical verification follows the manifest and generated authority across a hub rename; a move cannot reset an immutable baseline.

### Projections, pointers, and transactions

Generated record indexes are semantic projections. They store generator version, canonical semantic digest, sorted IDs, normalized metadata, and full-ID anchors. Compare semantic digests, not formatting. Make renderer upgrades explicit. Record bodies are exempt from vault-note frontmatter.

A legacy pointer is eligible only when a registered immutable record mechanically cites it, a commit message on reachable refs cites it, or an external host or package requires it. Diffs, unreachable commits, and reflogs do not qualify. Generate exact bounded pointer files without authored prose. Mark a pointer stale after its last qualifying citation disappears. Require explicit admission for tombstones. Manifest sync cannot rewrite immutable baselines or create tombstones.

An `_archive` directory inside a record collection is not a relocation target. Classify its tracked content before admission. After admission, freeze each path in place. Use curation to supersede meaning without archival-by-move.

The canonical tool provides `classify`, `plan-adoption`, `adopt`, `curate`, `append`, `render`, `check`, `verify-history --strict`, and `reindex-locators`. Every authority writer uses the collection mutation lock and optimistic authority bindings. By default, `append` stages the record and artifact snapshot, validates the staged state, atomically writes inventory, citations, and index, stages only those generated paths, runs staged-tree checks, and prints staged paths. `--no-stage` is an advanced override.

Reject append when the record is unstaged, staged and working trees diverge, generated files contain unrelated edits, classification is incomplete, or a mutable target lacks its digest.

### Context and migration

One exact repository snapshot and repo map serve one run. Reuse the content-addressed cache. Ordinary context includes inventories and semantic indexes, never full record bodies. Fetch a body by record ID only when the domain requires it. Exclude mutable bodies unless requested. Atlas prose cites record IDs instead of copying evidence. An unchanged collection receives no dispatch or context.

Scheduled intake runs on a unique branch in an isolated per-run worktree. It never switches the shared checkout. The run verifies the base branch, strict history, collection state, and candidate delta before planning admission. A failure may push the recovery branch for review, but no automation merges it.

Use `commit-tree` only for an exceptional recovery with separately proven tree identity. It is not the scheduled default. When worktrees are unavailable, assert the shared branch before work and restore it in guaranteed cleanup.

Migrate in this order:

1. Require clean state and full history.
2. Build read-only file and citation inventories.
3. Classify every tracked file.
4. Remove forbidden files.
5. Assign permanent UUIDs.
6. Generate and review the digest-bound adoption plan.
7. Adopt before moving files.
8. Generate citation and history locators.
9. Perform separate human curation.
10. Generate semantic indexes.
11. Migrate authored documents in slices.
12. Add eligible pointers and explicit tombstones.
13. Add CI gates, stamp version 4, and run full verification.

Required proof covers:

- compatibility, deterministic identity, casing, label changes, splits, and prefix ambiguity;
- scope failures, exact-path precedence, forbidden files, and promotion history;
- genesis review, incremental review, stale receipts, empty deltas, and zero-output refusal;
- authority-batch forgery, exact-once coverage, v2 migration, stale bindings, and mutation locks;
- record and artifact provenance mismatches across every authority-batch type, including historical paths relabeled as native;
- adopted records, native records, staged append, isolated recovery, and curation forks; and
- semantic rendering, citations, history, locator repair, pointers, tombstones, and run tracking.

Use synthetic fixtures only. Never copy private repository contents into fixtures or documentation examples.

## Context-efficient extraction

One orchestration run prepares one exact repository snapshot. Its content-addressed cache holds the repo map, import graph, and atlas freshness report. Operatives receive unit-scoped bundles compiled from that cache. They do not regenerate the map. The extraction planner intersects changed source paths with manifest domains, so unchanged domains consume no model context.

The compiler never silently truncates. Broad scopes produce `BROAD_CONTEXT_REQUIRED`; byte overflow produces `BUDGET_EXCEEDED`. Either result requires a declared replan. A repository state change invalidates the snapshot and every bound bundle.

## Trust model

Trust code for behavior. Trust a manifest domain only when its source and content digests pass. Trust atlas prose only when its section is FRESH. Treat stale artifacts as leads. Treat ignored files as unknown unless the run explicitly brings them into scope.

Working notes use frontmatter: `type`, `status`, `updated`, and `tags`. Valid statuses are `draft`, `current`, `accepted`, and `superseded`, plus an explicitly declared profile status. Manifest-owned published references retain their reader-facing Markdown shape and use the manifest gate instead of note frontmatter.

## Artifact routing

Run contracts, context receipts, bundles, dispatch ledgers, findings registers, executive summaries, proof receipts, and handoffs live in `80 Runs/YYYY-MM-DD slug/`. Documentation alignment artifacts live in `98 System/`. Architecture, API, data, operations, and onboarding generators write to their manifest-owned targets. Decisions write to `20 Decisions/`.

## Navigable collections

Every collection linked from inside the hub has an explicit Markdown index note. Hub-internal links target notes or files, never bare directories. Local Markdown heading fragments resolve to headings in their target notes. These rules keep the same navigation valid in Obsidian, GitHub, and local Markdown renderers.

## Migration and conformance

Migration moves authored docs into the hub, updates references, installs the manifest and extraction gates, then removes substantive legacy copies. Do not keep a permanent compatibility tree. A bounded pointer may remain only when the eligibility rule permits it.

`check-vault-standard.mjs` enforces layout and working-note frontmatter. When a documentation manifest exists, it validates that the manifest belongs to the vault and exempts only declared reference targets and generated record indexes from note frontmatter. `docs-manifest.mjs` owns required-domain, legacy-tree, source-digest, and content-digest enforcement. Record tooling owns record classification, citation state, history, ledger, and semantic-index enforcement.

The current standard version is **4**.
