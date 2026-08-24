# 3. Durable record collections

- Status: Accepted
- Date: 2026-08-24
- Extends: [ADR 0002](0002-repository-documentation-hub.md)

## Context

ADR 0002 establishes `code-ops-docs/` as the only authored documentation hub. Some repositories also hold historical records whose stable paths and bytes are evidence. Moving or rewriting those records destroys the evidence that a documentation migration must preserve.

The repository needs a way to govern those records without creating a second documentation authority. It also needs permanent identity, historical provenance, recoverable mutable-target evidence, and generated navigation. Adoption changes the repository's evidence contract, so it must be irreversible.

## Decision

Use manifest v2 record collections under the v4 documentation standard. The hub remains the sole authored authority. Registered historical records remain at stable paths as governed evidence. Generated inventory, citations, curation, and semantic indexes connect them to canonical vault documents.

Give every collection an immutable UUID and every record a deterministic permanent ID from that UUID and the normalized Git index path. Permit label changes. Require a new UUID for a split. Preserve original namespaces when a presentation merges collections.

Adopt only from a clean, complete Git history. Adopted bytes, paths, identity, and merged ledger events never change. Keep mutable-target identity in `targetSha256`; treat Git object IDs as regenerable locators. Resolve citations exact-first and retain ordered `resolvedVia` steps.

Use one writer and a repository-local lock for the append-only curation ledger. Reject mechanical merges of parallel tails. Require the losing branch to rebase and regenerate only its unmerged tail. Generate semantic indexes and bounded eligible pointers. Do not use manifest sync to rewrite immutable baselines or create tombstones.

## Consequences

The repository gains durable evidence without a second documentation tree. Operators pay adoption and history-verification costs before any write. CI must enforce collection classification, identity, citation state, ledger chains, historical availability, semantic projections, and pointer eligibility.

The standard stays backward compatible during explicit adoption: v3 with manifest v1 remains valid, as does v4 with manifest v1 when no collections exist. Manifest v2 requires standard v4. Synthetic fixtures may exercise every boundary but must never copy private repository contents.

Recovery favors regeneration from staged or historical evidence over hand edits. A shallow checkout is an infrastructure failure, not evidence corruption. Missing historical bytes after strict verification are `evidence-lost`.
