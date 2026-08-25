---
name: repo-docs
description: "Use when repository documentation must be extracted, refreshed, or proven current from one manifest-owned documentation hub."
---

# REPO DOCS — Manifest-Governed Documentation Extraction

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:repo-docs`.** First read `<plugin-root>/CONVENTIONS.md` and its orchestration, evidence, and documentation sections.
**Mode:** DOCUMENT · **Produces:** updated manifest-owned documents, an extraction plan, and freshness proof.

Keep `<repo>-docs/` as the only authored documentation hub. Treat code, schemas, workflows, and configuration as behavioral evidence. Registered immutable records remain governed evidence at permanent paths. The hub's `98 System/DOCS_MANIFEST.json` owns domains, record collections, legacy paths, and run tracking.

## Phase 0 — Establish exact context

Locate the repository contract and documentation hub. Run `docs-manifest.mjs check`; do not trust a malformed registry. Prepare one exact context snapshot with `context-snapshot.mjs`. Reuse its content-addressed repo map, import graph, and freshness-gated atlas payload. Do not regenerate a repo map per operative.

Run `docs-extract.mjs plan`. It intersects the current delta with domain sources and registered collections. A domain absent from the plan receives no dispatch. An unchanged collection contributes no context. An affected collection contributes only its semantic index and inventory; fetch a record body by ID only when the task needs it.

## Phase 1 — Extract bounded domains

Compile one context bundle per affected domain or tightly coupled domain group. If the compiler reports `BROAD_CONTEXT_REQUIRED`, give that operative the full structural index. If it reports `BUDGET_EXCEEDED`, split the scope or raise the declared budget in a new run-contract revision; never accept truncation.

Dispatch affected domains in bounded, conflict-free waves. Each brief names exactly one manifest target, its changed evidence paths, the allowed edit path, and the applicable quality criteria. Architecture, contracts, data, engineering standards, CI, infrastructure, observability, design system, guides, and the atlas remain explicit domains even when some are not applicable.

## Phase 2 — Reconcile and prove

Verify claims against current source, installed tooling, and cited record IDs. Remove duplicate authored explanations outside the hub. Keep only manifest-declared generated pointers with qualifying evidence. Never let manifest sync rewrite record inventories, citation baselines, curation ledgers, or tombstones. Run the manifest, records, links, vault, lint, and relevant eval gates.

## Done when

The manifest owns every domain and registered collection. Only affected domains were dispatched. Record context stayed semantic and ID-addressed. Every current claim is grounded. No substantive authored documentation remains outside the hub. Manifest, records, link, vault, lint, and extraction gates pass. The lead reviewed the diff and proof.
