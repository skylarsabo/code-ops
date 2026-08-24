# 2. Repository documentation hub and manifest

- Status: Accepted
- Date: 2026-08-24
- Supersedes: [ADR 0001](0001-handbook-placement.md)

## Context

ADR 0001 established tracked, suite-wide documentation but placed it under `docs/`. The marketplace now needs one documented physical hub that also preserves working decisions, run evidence, architecture, contracts, platform guidance, and an Atlas cache. The move is hard to reverse because links, gates, host guidance, and contributor habits depend on it.

Documentation also needs a machine-readable ownership boundary. Without one, a new document can duplicate an existing authority, an old source path can silently drift, and an agent can spend context on unrelated documentation.

## Options considered

1. Keep the split `docs/` tree and add new reference folders beside it. This retains old links but preserves two competing locations.
2. Put all documentation in plugin packages. This helps isolated installs but duplicates cross-plugin guidance and makes the repository boundary unclear.
3. Adopt `code-ops-docs/` as the only authored hub and use one manifest for documentation ownership and source coverage.

## Decision

Adopt `code-ops-docs/` as the sole authored documentation hub. Place published ADRs in `20 Decisions/ADRs/`, task guides in `70 Guides/`, and run scratch in the ignored `80 Runs/` folder.

Use `98 System/DOCS_MANIFEST.json` as the only topic-to-target and topic-to-source registry. Documentation tooling discovers that manifest, computes source and content digests, and plans only affected domains. Code, workflows, schemas, and generated host projections remain behavioral evidence, not alternate documentation hubs.

Keep `docs/specs/`, `docs/superpowers/`, and `docs/code-ops-run/` ignored for local compatibility. They are not canonical documentation locations and must not regain substantive authored content.

## Consequences

The repository has one location to navigate and one registry to validate. A documentation change now requires updating its canonical target and manifest digest after review. The migration costs link maintenance and makes stale legacy references visible as gate failures.

Single-plugin installs still do not receive the repository hub. Plugin READMEs therefore remain the install-facing surface and point users toward the repository documentation when needed.

Implementation evidence: commit `622296053cab92326fabf3447a1248aba4f2ffe2`, `code-ops-docs/Standard.md`, and `code-ops-docs/98 System/DOCS_MANIFEST.json`.
