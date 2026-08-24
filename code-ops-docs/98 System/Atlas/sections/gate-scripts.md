# Gate scripts and hooks

Charter: repository gates, renderers, orchestration compilers, and hook behavior. Excludes workflow scheduling and eval fixtures.

The default posture is fail closed. Usage errors, malformed configuration, drifted generated output, untrusted documentation records, and invalid receipts fail. Process-risk advisories remain explicit exceptions. Atlas ambiguity is fail-safe: the checker calls a section stale rather than treating uncertain judgment as current.

The run contract turns multi-agent work into a bounded artifact. It validates routing floors, dependency order, parallel write separation, retry limits, acceptance ownership, and final proof. Version 2 binds the contract to an exact context snapshot and rejects drift or an untracked-policy mismatch before work proceeds.

The context compiler separates reusable structural indexing from unit context. A snapshot hashes visible Git state and generator identities, then caches the repository map, import graph, and optional Atlas report by content address. A bundle selects scoped files, import neighbors, visible changes, and fresh Atlas excerpts. An empty scope, broad scope, and byte overflow each fail with an explicit marker instead of producing a misleading ready bundle or silently truncating context.

Documentation tooling discovers one `<hub>/98 System/DOCS_MANIFEST.json` rather than assuming a repository name. It hashes declared source and target records, plans only affected domains, and routes citation checks through every manifest-owned Markdown target. A plan may tolerate digest drift but rejects structural manifest errors; citation parsing accepts bracketed paths and interior directory spaces without swallowing ordinary prose. `sync-vendored` and both renderers remain derived-output boundaries; the pre-commit hook is a convenience layer and CI is the final backstop.
