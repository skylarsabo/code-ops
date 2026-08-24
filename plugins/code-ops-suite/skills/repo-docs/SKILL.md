---
description: "Use when repository documentation must be extracted, refreshed, or proven current from one manifest-owned documentation hub."
---

# REPO DOCS — Manifest-Governed Documentation Extraction

**Invoked as `/code-ops-suite:repo-docs`.** First read `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` and its orchestration, evidence, and documentation sections.
**Mode:** DOCUMENT · **Produces:** updated manifest-owned documents, an extraction plan, and freshness proof.

Keep `<repo>-docs/` as the only authored documentation hub. Treat code, schemas, workflows, and configuration as behavioral evidence, not competing documentation locations. The hub's `98 System/DOCS_MANIFEST.json` is the only topic-to-document and topic-to-source registry.

## Phase 0 — Establish exact context

Locate the repository contract and documentation hub. Run `docs-manifest.mjs check`; do not trust a malformed registry. Prepare one exact context snapshot with `context-snapshot.mjs`. Reuse its content-addressed repo map, import graph, and freshness-gated atlas payload. Do not regenerate a repo map per operative.

Run `docs-extract.mjs plan`. It intersects the current repository delta with every manifest domain's source patterns. A domain absent from the plan receives no model dispatch. A `not-applicable` domain receives evidence revalidation, never invented content.

## Phase 1 — Extract bounded domains

Compile one context bundle per affected domain or tightly coupled domain group. If the compiler reports `BROAD_CONTEXT_REQUIRED`, give that operative the full structural index. If it reports `BUDGET_EXCEEDED`, split the scope or raise the declared budget in a new run-contract revision; never accept truncation.

Dispatch affected domains in bounded, conflict-free waves. Each brief names exactly one manifest target, its changed evidence paths, the allowed edit path, and the applicable quality criteria. Architecture, contracts, data, engineering standards, CI, infrastructure, observability, design system, guides, and the atlas remain explicit domains even when some are not applicable.

## Phase 2 — Reconcile and prove

Verify claims against current source and installed tooling. Remove duplicate authored explanations outside the hub; keep only short pointers where a host or external convention requires a legacy path. Run `docs-manifest.mjs sync` only after review, then run `docs-manifest.mjs check`. Run repository link, vault, lint, and relevant eval gates. A green digest proves alignment only for the source patterns declared in the manifest; report uncovered source areas honestly.

## Done when

The manifest owns every required documentation domain; only affected domains were dispatched; every current claim is source-grounded; every not-applicable claim has concrete evidence; no substantive authored documentation remains outside the hub; context bundles bind to the exact run snapshot; manifest, link, vault, lint, and extraction evals pass; and the lead reviewed the diff and proof.
