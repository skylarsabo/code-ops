---
name: data-model
description: "Use when you need a clear data-model reference for a codebase, generated from the real schema and migrations."
---

# DATA-MODEL — Entities, Relationships, Invariants

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:data-model`.** First read the `<plugin-root>/CONVENTIONS.md` — especially the **documentation quality standard (`§13`)**. For this DOCUMENT-mode skill the binding sections are §2 (tools/in-house docs lookup), §3 (interaction), §4 (safety rails), §12 (SSOT/registers), and §13 (doc standard) — read those five; the fan-out/fix machinery (§1, §5–§8, §11) does not apply here.
**Mode:** DOCUMENT. **Produces:** `DATA-MODEL.md` in the repo's docs location.

## Phase 0 — Detect the schema  *(checkpoint)*
Find the source of truth for data: SQL migrations, ORM models, a schema file, or NoSQL document shapes. If there's no persistent data model, say so and stop. Confirm scope + docs location.

## Phase 1 — The map
A Mermaid **erDiagram** of the entities and their relationships (cardinality, FK direction). Keep it legible — split into domain clusters if large.

## Phase 2 — Per-entity reference
For each entity (from the schema, cited): fields + types, keys/indexes, constraints, relationships, and the **invariants the code relies on** (uniqueness, soft-delete, ownership, retention) that the raw schema doesn't show.

## Phase 3 — Evolution & lifecycle
How the schema has evolved (migration history), the data lifecycle (creation, mutation, retention/deletion), and any denormalization or derived data + why.

## Assemble (per `§13`)
Exec summary (the core entities + the one diagram), then the reference. Cite the schema/migration `file:line`; mark inferred invariants `UNVERIFIED`; stamp the SHA.

## Done when
Every entity/field/relationship maps to the real schema/migrations (cited), the ER diagram renders and matches it, the non-obvious invariants are stated, and an engineer could safely write a query or a migration from this doc.
