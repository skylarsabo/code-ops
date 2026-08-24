# Documentation doctrine

Charter: the canonical `code-ops-docs/` hub, its manifest, its reference records, and its working vault material. This section excludes plugin runtime doctrine, which belongs in each plugin `CONVENTIONS.md`.

## Authority

`code-ops-docs/98 System/DOCS_MANIFEST.json` is the only registry that maps a documentation domain to its canonical target and source patterns. `docs-manifest.mjs check` verifies the manifest shape, target presence, and source and content digests. A digest proves alignment only for the sources that the domain declares.

The hub contains authored reference material. Code, schemas, workflows, and configuration remain behavior evidence. Host distributions remain generated projections of canonical packages.

## Documentation gates

`check-doc-citations.mjs` reads the manifest and scans Markdown only in `current` domain targets. It preserves path-and-line syntax checks and skips fenced examples. A `not-applicable` record must provide concrete evidence and does not add a scanned target.

`check-vault-standard.mjs` verifies vault layout and working-note frontmatter. Manifest-owned reference targets have their own validation path. The Atlas checker evaluates this section against the hub outside the Atlas directory, preventing the Atlas from self-invalidating its own refresh.

## Change discipline

Update the canonical target when its declared source changes. Run `docs-manifest.mjs sync` only after review. Do not recreate substantive authored Markdown under the retired `docs/` tree. Keep a legacy pointer only where an external host requires one.

Atlas freshness is evidence, not permission to repeat an old claim. This section is stale until its `verifiedAt` commit includes a review of the hub scope. The scope intentionally names `code-ops-docs`, rather than the removed `docs` tree, so a moved documentation record cannot remain falsely fresh.
