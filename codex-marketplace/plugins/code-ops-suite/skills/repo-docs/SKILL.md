---
name: repo-docs
description: "Use when repository documentation must be extracted, refreshed, or proven current from one manifest-owned documentation hub."
---

# Repo docs: manifest-governed documentation extraction

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:repo-docs`.** First read `<plugin-root>/CONVENTIONS.md`,
and its orchestration, evidence, and documentation sections.
**Mode:** DOCUMENT · **Produces:** updated manifest-owned documents, an extraction plan, and
freshness proof.

Keep `<repo>-docs/` as the only authored documentation hub. Treat code, schemas, workflows, and
configuration as behavioral evidence. Registered immutable records remain governed evidence at
permanent paths. The hub's `98 System/DOCS_MANIFEST.json` owns the domains, the record
collections, the legacy paths, and the run tracking.

## Phase 0: the exact context

Locate the repository contract and the documentation hub. Run `docs-manifest.mjs check`, and do
not trust a malformed registry. Prepare one exact context snapshot with `context-snapshot.mjs`.
Reuse its content-addressed repo map, import graph, and freshness-gated atlas payload. Do not
regenerate a repo map per operative.

Run `docs-extract.mjs plan`. It intersects the current delta with the domain sources and the
registered collections. A domain absent from the plan receives no dispatch. An unchanged
collection contributes no context. An affected collection contributes only its semantic index
and inventory, so fetch a record body by ID only when the task needs it.

## Phase 1: the bounded domain extraction

Compile one context bundle per affected domain, or per tightly coupled domain group. When the
compiler reports `BROAD_CONTEXT_REQUIRED`, give that operative the full structural index. When it
reports `BUDGET_EXCEEDED`, split the scope or raise the declared budget in a new run-contract
revision. Never accept truncation.

Dispatch the affected domains in bounded, conflict-free waves. Each brief names exactly one
manifest target, its changed evidence paths, the allowed edit path, and the applicable quality
criteria. Architecture, contracts, data, engineering standards, CI, infrastructure,
observability, design system, guides, and the atlas remain explicit domains, even when some are
not applicable.

## Phase 2: the reconciliation and the proof

Verify the claims against the current source, the installed tooling, and the cited record IDs.
Remove duplicate authored explanations outside the hub. Keep only manifest-declared generated
pointers with qualifying evidence. Never let a manifest sync rewrite record inventories, citation
baselines, curation ledgers, or tombstones. Run the manifest, records, links, vault, lint, and
relevant eval gates.

## Done when

- The manifest owns every domain and registered collection.
- Only the affected domains were dispatched.
- The record context stayed semantic and ID-addressed.
- Every current claim is grounded.
- No substantive authored documentation remains outside the hub.
- The manifest, records, link, vault, lint, and extraction gates pass.
- The lead reviewed the diff and the proof.
