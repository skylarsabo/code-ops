---
name: architecture
description: "Use when you need a deep, diagram-rich architecture reference for a codebase, written for a senior engineer and grounded in the actual code."
---

# Architecture: the system, explained for a senior engineer

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:architecture`.** First read the
`<plugin-root>/CONVENTIONS.md`: the operating model, the quality lenses, the
**documentation quality standard (`§13`)** this doc obeys, and the SSOT and freshness rules
(`§12`). For this DOCUMENT-mode skill the binding sections are §2 (tools and in-house docs
lookup), §3 (interaction), §4 (safety rails), §12 (SSOT and registers), and §13 (doc standard).
Read those five. The fan-out and fix machinery (§1, §5 to §8, §11) does not apply here.
**Mode:** DOCUMENT. This skill writes docs only. Log any code issue as a finding rather than
fixing it here. **Produces:** a diagram-rich, code-grounded `ARCHITECTURE.md` in the repo's docs
location.

## Phase 0: the inventory  *(checkpoint)*

Dispatch an `explorer` operative to detect the stack and build the real inventory: deployable
units, modules, entrypoints, public surfaces, external systems, datastores, and deployment
topology. Hand its summary onward. Pick the **3-5 runtime flows** that matter most to document.
Confirm the scope and the docs location.

## Phase 1: the C4 ascent

Write three layers. Give each one a Mermaid diagram plus a narrative explaining the
responsibilities, the boundaries, and **why the system is split this way**:
- **System context:** the system as one box among external actors and systems.
- **Containers:** the deployable or runnable units, their responsibilities, and how they communicate, including protocols and synchronous against asynchronous calls.
- **Components:** the key internals of each significant container.

## Phase 2: the critical flows

For each chosen flow, write a Mermaid **sequence diagram** plus a step narrative. Cover what
happens, why it happens, the invariants that hold it together, and how it fails and recovers.

## Phase 3: the cross-cutting concerns

Cover data flow, auth and trust boundaries, error and failure handling, concurrency and
ordering, configuration, and observability. Then name the **load-bearing invariants** a change
must not break.

## Phase 4: the decisions

Cover the handful of architectural decisions that shaped the system, with their trade-offs and
consequences. Seed or link `adr` for the full records.

## The assembly, per `§13`

Lead with an executive summary of one page or less plus one orienting diagram, then the
deep-dives. Cite `file:line` throughout. Mark inferences `UNVERIFIED`. Stamp the generated-at
SHA.

## Done when

- Every container, component, flow, and decision in the doc maps to real code, cited, and every diagram renders.
- The executive summary stands alone.
- A senior engineer new to the system could navigate it and change it safely from this document.
- Nothing is invented, and the freshness stamp is set.
