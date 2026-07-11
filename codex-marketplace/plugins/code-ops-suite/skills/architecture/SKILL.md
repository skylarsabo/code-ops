---
name: architecture
description: "Use when you need a deep, diagram-rich architecture reference for a codebase, written for a senior engineer and grounded in the actual code."
---

# ARCHITECTURE — The System, Explained for a Senior Engineer

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:architecture`.** First read the `<plugin-root>/CONVENTIONS.md` — operating model, quality lenses, the **documentation quality standard (`§13`)** this doc obeys, and the SSOT/freshness rules (`§12`). For this DOCUMENT-mode skill the binding sections are §2 (tools/in-house docs lookup), §3 (interaction), §4 (safety rails), §12 (SSOT/registers), and §13 (doc standard) — read those five; the fan-out/fix machinery (§1, §5–§8, §11) does not apply here.
**Mode:** DOCUMENT (writes docs only; log any code issue as a finding, don't fix it here). **Produces:** `ARCHITECTURE.md` in the repo's docs location — diagram-rich and code-grounded.

## Phase 0 — Inventory  *(checkpoint)*
Detect the stack; build the real inventory — deployable units, modules, entrypoints, public surfaces, external systems, datastores, deployment topology. Pick the **3–5 runtime flows** that matter most to document. Confirm scope + the docs location.

## Phase 1 — C4 ascent
Write three layers, each a Mermaid diagram + narrative explaining responsibilities, boundaries, and **why it's split this way**:
- **System Context** — the system as one box among external actors/systems.
- **Containers** — the deployable/runnable units, their responsibilities, and how they communicate (protocols, sync vs async).
- **Components** — the key internals of each significant container.

## Phase 2 — Critical flows
For each chosen flow, a Mermaid **sequence diagram** + step narrative: what happens, why, the invariants that hold it together, and how it fails and recovers.

## Phase 3 — Cross-cutting concerns
Data flow, auth/trust boundaries, error/failure handling, concurrency/ordering, configuration, observability — and the **load-bearing invariants** a change must not break.

## Phase 4 — Decisions
The handful of architectural decisions that shaped the system, with their trade-offs and consequences (seed/link `adr` for the full records).

## Assemble (per `§13`)
Lead with a ≤1-page exec summary + one orienting diagram, then the deep-dives. Cite `file:line` throughout; mark inferences `UNVERIFIED`; stamp the generated-at SHA.

## Done when
Every container/component/flow/decision in the doc maps to real code (cited) and the diagrams render; the exec summary stands alone; a senior engineer new to the system could navigate and safely change it from this document; nothing is invented; the freshness stamp is set.
