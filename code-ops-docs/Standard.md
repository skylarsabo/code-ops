---
type: standard
status: current
updated: 2026-08-28
standard-version: 4
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
| `00 Inbox/` | Unsorted observations; file or delete promptly. |
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

`98 System/DOCS_MANIFEST.json` is the only topic-to-document and topic-to-source registry. It explicitly owns architecture, contracts, data models, engineering standards, API reference, CI and delivery, infrastructure, observability, performance, design system, guides, atlas, and registered record collections. A domain is `current` or `not-applicable`; the latter requires concrete evidence.

Run `node scripts/docs-manifest.mjs check` before trusting the hub. A matching source digest proves that the declared evidence paths have not moved since the document was reviewed. It does not prove coverage beyond those declared paths. Atlas prose is trusted only when `atlas-check.mjs` reports the section FRESH.

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

## Runs and Git

`80 Runs/` is gitignored. A run is a dated folder holding its contract, context receipts, bundles, ledgers, reports, and proof. Commit notes, templates, authoritative reference docs, and the shared Obsidian configuration. Do not commit machine-specific workspace state, caches, or trash.

## Profile

### Code-ops profile

All domain folders listed above are active. `60 Experience/DESIGN_SYSTEM.md` records a manifest-backed not-applicable verdict because this marketplace has no product UI. Published ADRs live in `20 Decisions/ADRs/`. The atlas lives in `98 System/Atlas/`. Record indexes live in `98 System/Records/` when a manifest v2 collection exists. The hub contains both working judgment and shipped reference material; the manifest distinguishes the latter from ordinary notes.
