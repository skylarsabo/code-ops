---
type: standard
status: current
updated: 2026-09-28
standard-version: 5
tags:
  - meta
  - standard
---

# Repository documentation standard

`code-ops-docs/` is this repository's only authored documentation hub and its Obsidian vault. Code, schemas, workflows, plugin manifests, and skill files remain canonical for executable behavior. They are evidence sources, not alternate documentation trees.

The shared standard lives at `code-ops-docs/40 Engineering/Techniques/vault-standard.md`. This conformance copy specializes it for code-ops. Update both files together.

## Layout

| Folder | Authority |
| --- | --- |
| `00 Inbox/` | Unsorted observations. File or delete promptly. |
| `10 Design/` | Working designs and specifications. |
| `20 Decisions/` | Working decisions and published ADRs. |
| `30 Architecture/` | Current system architecture. |
| `35 Contracts and Data/` | Public contracts and data models. |
| `40 Engineering/` | Engineering standards, handbook, and techniques. |
| `50 Platform/` | CI, delivery, and infrastructure. |
| `55 Operations/` | Observability and operational guidance. |
| `60 Experience/` | Design-system status and user-experience contracts. |
| `70 Guides/` | Task-oriented guides. |
| `80 Runs/` | Local dated run artifacts. |
| `90 Templates/` | New-note templates. |
| `95 Attachments/` | Linked images and exports. |
| `98 System/` | The documentation manifest, atlas, and system indexes. |
| `99 Archive/` | Superseded material with a forward pointer. |

## Registry and trust

`98 System/DOCS_MANIFEST.json` is the only topic-to-document and topic-to-source registry. It runs at manifest version 2 and owns sixteen domains: decisions, architecture, contracts, data model, engineering standards, handbook, techniques, API reference, CI and delivery, infrastructure, observability, performance, measurements, design system, guides, and atlas. A domain is `current` or `not-applicable`. The `not-applicable` status requires concrete evidence.

Version 2 also declares `recordCollections`, `legacyPaths`, and explicit `runs.tracking`. This repository registers no record collection today, so `recordCollections` is empty and the record checks have nothing to gate.

Manifest version 3 requires standard version 5 and adds three profile blocks:

- **`runs`** holds `tracking` and `retain`. `tracking` is `tracked`, `closeout`, or `ignored`. Under `closeout`, program folders and each `CLOSEOUT.md` are committed, and dated run folders are ignored except the `retain` globs. `retain` must be empty under the other two values.
- **`drafts`** holds `maxAgeDays` and `statuses`. This list replaces draft statuses declared in profile prose.
- **`state`** maps each hub-relative state surface to its `budgetWords`.

Version 3 also adds two `legacyPaths` dispositions beside `pointer` and `tombstone`. `relocated` names a moved root and its target, which must exist. `removed` names a root that must not exist on disk, and it carries no target. A version 2 manifest keeps its version 2 rules, so an upgrade adds no failure until the repository opts in. This repository stays at manifest version 2.

Run `node scripts/docs-manifest.mjs check` before trusting the hub. A matching source digest proves that the declared evidence paths have not moved since the document was reviewed. It does not prove coverage beyond those declared paths.

Atlas prose is trusted only when `atlas-check.mjs` reports the section FRESH. Freshness now reaches claim granularity: `atlas-check.mjs stamp` records one claim per `path:line` citation, and `check` classifies each claim through the same rules a findings register uses. Add `--claims-gate` to exit non-zero on any claim the classifier did not call FRESH. [The atlas](40 Engineering/Techniques/atlas.md) owns the trust doctrine.

## State and history

The hub has two layers:

| Layer | Contents | Mutability |
| --- | --- | --- |
| State | `00 Home.md`, `20 Decisions/REGISTER.md`, `10 Design/INDEX.md`, `80 Runs/INDEX.md`, `98 System/TRIAGE.md`, and synthesis pages that declare their sources | Rewritten in place, mostly generated |
| History | Record collections, dated run folders, `PROGRAM.archive.md`, closed drafts, and `99 Archive/` | Append-only. Record bytes never change |

A session reaches history through a state link. The manifest declares each state surface and its word budget.

The register holds rules, not evidence. Four clauses bind it:

1. Every decision in force has one register line.
2. Every register line cites one history source: a record id, and a run or program id when it came from a run.
3. Every program-ledger decision carries a disposition within one hop of being made.
4. No two in-force register lines claim the same topic key without a `supersedes` or `amends` link.

A topic key has the form `<domain>/<subject>`, such as `records/relocation`. The domain is the `id` of a manifest domain. The subject is a kebab-case slug of one to five words. A `decision` or `amendment` record carries a key, and other record kinds do not. An amendment carries the key of the record it amends. Clause 4 compares keys as exact strings.

A decision has one of four statuses:

| Status | Meaning |
| --- | --- |
| `in-force` | The rule applies as written. |
| `amended` | The rule applies with later amendments. |
| `superseded` | A later record replaces the rule. |
| `historical` | Evidence or a report, not a rule. |

A status change is a curation event. Record bytes never change, so a write-once record can still read as amended in the register.

## Where new work goes

| Work | Destination |
| --- | --- |
| Architecture or shipped contract | The owning manifest domain. |
| Open design | `10 Design/`. |
| Locked choice | `20 Decisions/`. |
| Run evidence | `80 Runs/YYYY-MM-DD slug/`. |
| Atlas judgment | `98 System/Atlas/`. |
| Unsure | `00 Inbox/`, then route promptly. |

Agents do not create a second docs tree. A host-required legacy location may contain one short pointer, never substantive duplicate prose. Registered historical records may remain at stable paths as governed evidence. Their authority remains in this hub.

## Notes and generated references

Working notes carry `type`, `status`, `updated`, and `tags` frontmatter. Status is one of `draft`, `current`, `accepted`, or `superseded`. Manifest-owned reference trees and generated record indexes use their existing published Markdown shape. The manifest and record checks gate them instead.

Use wikilinks within working vault notes. Use Markdown links in published reference material. Cite code with repository-relative paths and symbols. Never copy secrets or personal data.

Every collection linked from inside the hub has an explicit Markdown index note. Hub-internal links target notes or files, never bare directories. Local Markdown heading fragments resolve to headings in their target notes.

## Durable collection intake

Record collections remain open after genesis adoption. Each admitted authority object remains irreversible. Committed immutable paths use reviewed incremental admission. New staged native records use native append.

Inventory v3 records authority membership in a separate hash-chained batch history. Its batch types are `genesis-adoption`, `incremental-adoption`, `native-append`, and `v2-migration`. Every authority object belongs to exactly one batch, and complete-history checks re-derive each non-genesis predecessor binding.

Genesis and incremental batches contain only `adopted` records and artifacts. Native batches contain only `native` records and artifacts. Each native object's `introducedIndexHead` equals its batch `sourceHead`. The exact path has no history through that source and first appears with the committed batch.

Only `v2-migration` may cover an artifact without provenance. It preserves the complete v2 object and never manufactures provenance.

The authority-batch chain records membership and provenance. The curation ledger records status and supersession. Never combine these chains or rewrite an accepted object in either chain.

An adopted `_archive` path freezes in place. Move current authority through curation and a canonical hub document. Never archive a governed record by moving it.

Admitted bytes stay irreversible, but a collection root may move. [[D-004 collection roots may relocate]] records this change. Each move is a `relocate-root` curation event. Every record keeps its bytes and its path relative to the root. A root may move more than once, and each move is one prefix swap. Until the record tooling records `relocate-root` events, no root moves.

## Runs and Git

`80 Runs/` is gitignored. A run is a dated folder holding its contract, context receipts, bundles, ledgers, reports, and proof. Commit notes, templates, authoritative reference docs, and the shared Obsidian configuration. Do not commit machine-specific workspace state, caches, or trash.

## Profile

### Code-ops profile

All domain folders listed above are active. `60 Experience/DESIGN_SYSTEM.md` records a manifest-backed not-applicable verdict because this marketplace has no product UI. Published ADRs live in `20 Decisions/ADRs/`. The atlas lives in `98 System/Atlas/`. Record indexes live in `98 System/Records/` when a manifest v2 collection exists. The hub contains both working judgment and shipped reference material. The manifest is what separates the shipped reference material from an ordinary note.
