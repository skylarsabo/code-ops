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

A record collection preserves durable evidence that must retain its existing location. The hub remains the only authored authority. A registered historical record may remain at its stable path as governed evidence. Adoption preserves its bytes and path, then supersedes authority through generated metadata and a canonical vault document.

Adoption is irreversible. Do not rewrite adopted bytes, paths, inventory entries, curation events, or generated baselines. A future authority may supersede them through a new canonical document, generated metadata, or an ADR. Do not create a second documentation tree or a wholesale compatibility tree.

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

Every tracked file beneath a collection root matches exactly one scope. Zero or multiple matches fail. Exact paths and globs have no implicit precedence. Classify unknown files in the same diff. Classification may report candidates but never choose policy.

Scopes distinguish immutable append-only records, mutable artifacts, frozen artifacts or executables, superseded artifacts or executables, and forbidden files. Mutable scopes remain classified and owned but are excluded from immutability hashing. Forbidden files, including tracked `.pyc`, block adoption.

Git index paths and casing are authoritative. Adoption uses `git ls-files`. Native records stage before append. Untracked files may be reported but never receive IDs. Normalize a Git path with POSIX separators, Unicode NFC, exact index casing, and no dot segments.

Record IDs use `REC-<base32(first-128-bits(sha256("code-ops-record-v1\\0" + collectionUuid + "\\0" + normalizedGitPath)))>`. Store `identityVersion: 1` on each collection and inventory entry. Collisions fail. IDs never renumber, change, or get reused.

Human prose may show a globally unambiguous prefix of at least eight ID characters. Machine links use full IDs and Markdown links to generated full-ID anchors. Prefix ambiguity blocks.

Adopted records pin existing paths and bytes without a modern body schema. Native records use YAML frontmatter with exact `recordSchema: 1` and `supersedes: [...]` fields. `supersedes` is a JSON array of full record IDs and may be empty. A future schema change never invalidates an adopted record.

```yaml
---
recordSchema: 1
supersedes: ["REC-ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
---
```

### Curation, citations, and historical evidence

Adopted record supersession uses an external append-only curation ledger. Each event stores a global sequence, previous event digest, record ID, previous event for that record, complete metadata state, informational `curatedAt`, and event digest. Sequence starts at one and follows file order. Global and per-record predecessor chains validate. The highest valid sequence wins. Corrections append complete replacement events.

The ledger has one writer and uses a repository-local lock containing its process and acquisition time. A live or recent lock fails closed. The tool may recover a lock only after ten minutes when its recorded local process is gone. Parallel branch tails cannot merge mechanically. The losing branch rebases and regenerates only its unmerged tail. CI rejects forks, duplicate sequences, broken hashes, and changed merged events.

The citation inventory stores every outbound Markdown citation with record ID, use-site source line, raw target, normalized target, ordered `resolvedVia`, state, and target metadata. It resolves inline links and images plus full, collapsed, and shortcut reference forms. Fenced, indented, and inline code is not citation syntax. Try the complete candidate as an exact path first. Then remove recognized suffixes in the applied order: accessors, line or range suffixes, symbols, fragments, and globs. Support repeated accessors.

`resolvedVia` is an ordered list of `exact`, `accessor-stripped`, `range-stripped`, `symbol-stripped`, `fragment-stripped`, and `glob-expanded`. Preserve each applied step. A literal bracket filename remains eligible for the exact-first resolution.

Citation states are `resolved-immutable`, `resolved-mutable`, `mutable-drifted`, `dead-at-adoption`, `ambiguous`, `external`, `glob`, `redirected`, `tombstoned`, `history-unavailable`, `evidence-lost`, and `digest-mismatch`. Baseline dead citations remain visible debt. A later resolved-to-dead transition blocks. Native records cannot introduce dead or ambiguous targets. Baseline debt must later receive a history pointer, tombstone, or explicit unresolved disposition.

An immutable record that cites a mutable artifact stores authoritative `targetSha256`. Git object IDs are regenerable locators only: object format, blob OID, commit OID, and path. Adoption resolves historical content at the record introduction commit. Native append resolves the staged record and target snapshot. Reindex locators only after bytes match `targetSha256`. A Git hash-algorithm migration changes locators, not evidence identity.

Present pinned historical content by default. Present the current path separately. Make drift visible. With complete history, missing digest content is `evidence-lost`.

Adoption refuses before writing in a shallow, partial, promisor-backed repository, or when required objects are missing. Append and curation also require complete history because they extend immutable authority. No shallow write fallback exists. Ordinary checks warn `history-unavailable`. `verify-history --strict` fails as infrastructure configuration, not evidence corruption. Use `evidence-lost` only with complete history. GitHub Actions adopters use `fetch-depth: 0` and `filter: ""`. Ambiguous historical resolution requires an explicit reviewed disposition. Never use current-state fallback. Historical verification follows the manifest and generated authority across a hub rename; a move cannot reset an immutable baseline.

### Projections, pointers, and transactions

Generated record indexes are semantic projections. They store generator version, canonical semantic digest, sorted IDs, normalized metadata, and full-ID anchors. Compare semantic digests, not formatting. Make renderer upgrades explicit. Record bodies are exempt from vault-note frontmatter.

A legacy pointer is eligible only when a registered immutable record mechanically cites it, a commit message on reachable refs cites it, or an external host or package requires it. Diffs, unreachable commits, and reflogs do not qualify. Generate exact bounded pointer files without authored prose. Mark a pointer stale after its last qualifying citation disappears. Require explicit adoption for tombstones. Manifest sync cannot rewrite immutable baselines or create tombstones.

The canonical tool provides `classify`, `adopt`, `curate`, `append`, `render`, `check`, `verify-history --strict`, and `reindex-locators`. By default, `append` stages the record and artifact snapshot, validates the staged state, atomically writes inventory, citations, and index, stages only those generated paths, runs staged-tree checks, and prints staged paths. `--no-stage` is an advanced override.

Reject append when the record is unstaged, staged and working trees diverge, generated files contain unrelated edits, classification is incomplete, or a mutable target lacks its digest.

### Context and migration

One exact repository snapshot and repo map serve one run. Reuse the content-addressed cache. Ordinary context includes inventories and semantic indexes, never full record bodies. Fetch a body by record ID only when the domain requires it. Exclude mutable bodies unless requested. Atlas prose cites record IDs instead of copying evidence. An unchanged collection receives no dispatch or context.

Migrate in this order:

1. Require clean state and full history.
2. Build read-only file and citation inventories.
3. Classify every tracked file.
4. Remove forbidden files.
5. Assign permanent UUIDs.
6. Adopt before moving files.
7. Generate citation and history locators.
8. Perform separate human curation.
9. Generate semantic indexes.
10. Migrate authored documents in slices.
11. Add eligible pointers and explicit tombstones.
12. Add CI gates, stamp version 4, and run full verification.

Required proof covers compatibility, deterministic identity and casing, label changes, splits, prefix ambiguity, scope failures, policy conflicts, forbidden files, adopted and native records, staged append, ledger correction and forks, semantic rendering, citation resolution, debt regression, mutable drift, history recovery, locator regeneration, pointers, tombstones, and run tracking. Use synthetic fixtures only. Never copy private repository contents into fixtures or documentation examples.

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
