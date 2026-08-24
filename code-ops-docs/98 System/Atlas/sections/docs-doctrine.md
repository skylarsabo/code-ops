# Documentation doctrine

Charter: substantive authored records in the documentation hub and the scripts that validate them. Excludes Atlas bookkeeping, run scratch, and generated host output.

`code-ops-docs/` is the sole substantive hub. Its `<hub>/98 System/DOCS_MANIFEST.json` is the only topic-to-target and topic-to-source registry. It maps architecture, contracts, data, standards, API reference, delivery, infrastructure, operations, experience, guides, and Atlas records to canonical Markdown. A `not-applicable` domain needs concrete evidence. Code, workflows, schemas, and configuration remain evidence, not competing prose authorities.

`docs-manifest.mjs` discovers a generic hub by manifest location, validates content and source digests, rejects source globs with no repository evidence, and creates a delta-based plan. `docs-extract.mjs` invokes the sibling validator from its own installed directory. The extractor dispatches only affected domains, and a fresh digest proves only declared coverage.

Citation validation reads current and not-applicable manifest targets instead of a hard-coded list. Vault conformance protects working-note structure while the manifest owns reference-target completeness. Only manifest targets in published reference bands receive the frontmatter exemption. Markdown and Obsidian wikilinks both fail when their targets are absent, case-unsafe, or ambiguous; code examples remain inert. The guide domain lives directly at `70 Guides/`, not under a duplicate nesting level. ADR 0001 preserves the historical handbook placement decision as superseded; ADR 0002 is the current migration decision. The legacy scratch locations remain ignored for compatibility, not as alternative documentation homes.

This section deliberately scopes substantive domain folders and documentation scripts rather than the hub root. Manifest digest updates and Atlas bookkeeping therefore do not invalidate the record by themselves. A source or canonical-document change still does.
