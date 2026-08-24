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

`98 System/DOCS_MANIFEST.json` is the sole registry for topic ownership and source coverage. It names each domain's canonical target, status, evidence paths, source digest, and content digest. `docs-manifest.mjs check` fails when required domains are absent, a target is missing, a digest is stale, or substantive authored Markdown remains under the legacy `docs/` tree.

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

Migration moves authored docs into the hub, updates references, installs the manifest and extraction gates, then removes substantive legacy copies. Do not keep a permanent compatibility tree. A bounded pointer may remain only when an external host requires that path.

`check-vault-standard.mjs` enforces layout and working-note frontmatter. When a documentation manifest exists, it also validates that the manifest belongs to the vault and exempts only its declared targets from note frontmatter. `docs-manifest.mjs` owns required-domain, legacy-tree, source-digest, and content-digest enforcement.

The current standard version is **3**.
