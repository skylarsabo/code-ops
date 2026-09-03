---
description: "Use when you need a clear data-model reference for a codebase, generated from the real schema and migrations."
---

# DATA-MODEL: Entities, Relationships, Invariants

**Invoked as `/code-ops-suite:data-model`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`,
and especially the **documentation quality standard (`§13`)**. For this DOCUMENT-mode skill the
binding sections are §2 (tools and in-house docs lookup), §3 (interaction), §4 (safety rails),
§12 (SSOT and registers), and §13 (doc standard). Read those five. The fan-out and fix machinery
(§1, §5 to §8, §11) does not apply here.
**Mode:** DOCUMENT. **Produces:** `DATA-MODEL.md` in the repo's docs location.

## Phase 0: the schema source of truth  *(checkpoint)*

Dispatch an `explorer` operative to find the source of truth for data: SQL migrations, ORM
models, a schema file, or NoSQL document shapes. When there is no persistent data model, say so
and stop. Confirm the scope and the docs location.

## Phase 1: the map

Draw a Mermaid **erDiagram** of the entities and their relationships, with cardinality and
foreign-key direction. Keep it legible, and split it into domain clusters when it is large.

## Phase 2: the per-entity reference

For each entity, taken from the schema and cited, record the fields and types, the keys and
indexes, the constraints, the relationships, and the **invariants the code relies on** that the
raw schema does not show, such as uniqueness, soft-delete, ownership, and retention.

## Phase 3: evolution and lifecycle

Record how the schema has evolved through its migration history, the data lifecycle (creation,
mutation, retention, deletion), and any denormalization or derived data along with the reason
for it.

## The assembly, per `§13`

Lead with an executive summary naming the core entities and carrying the one diagram, then give
the reference. Cite the schema or migration `file:line`. Mark inferred invariants `UNVERIFIED`.
Stamp the SHA.

## Done when

- Every entity, field, and relationship maps to the real schema or migrations, cited.
- The ER diagram renders and matches the schema.
- The non-obvious invariants are stated.
- An engineer could write a query or a migration safely from this doc.
