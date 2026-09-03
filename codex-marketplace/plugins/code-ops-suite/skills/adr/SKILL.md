---
name: adr
description: "Use when you need to capture the reasons behind a codebase's architecture as decision records, either backfilling load-bearing past decisions or authoring an ADR for a current one."
---

# ADR: Architecture Decision Records

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:adr`.** First read the `<plugin-root>/CONVENTIONS.md`, and
especially the **documentation quality standard (`§13`)**.
**Mode:** DOCUMENT. **Produces:** numbered ADRs in `code-ops-docs/20 Decisions/ADRs/`. Match an
existing ADR convention when the repo already has one.

## The two modes, confirmed at the start

- **Backfill.** Dispatch an `explorer` operative to mine the code, the version-control history, and the existing docs for the **load-bearing decisions already made**, the choices a newcomer hits and asks about. Write an ADR for each one that clears the admission gate below, grounded in evidence.
- **New.** Author an ADR for a decision being made now, with its options and a recommendation.

**The admission gate, in both modes.** A decision earns an ADR only when all three prongs hold:
1. **Hard to reverse.** Changing it later carries real cost.
2. **Surprising without context.** A future reader would ask why the system is this way.
3. **A real trade-off.** Genuine alternatives existed, and one was chosen for specific reasons.

A candidate that fails any prong is not an ADR. Record it where it belongs and name the
destination: a code comment at the decision point, the repo's existing docs surface matching its
structure (`§12`), or a CHANGELOG line. In Backfill mode the gate decides which mined decisions
get written up at all.

## The standard form of one ADR

`NNNN-title` · **Status** (proposed, accepted, or superseded) · **Context** (the forces and
constraints) · **Options considered** (with honest trade-offs) · **Decision** · **Consequences**
(what it costs, what it enables, and what it precludes). Cite the code and commits that embody
the decision. Write one ADR per choice, and keep it to that decision.

## The assembly, per `§13`

Maintain a `code-ops-docs/20 Decisions/ADRs/README.md` index. For a backfill, rank by how
load-bearing each decision is, and surface the riskiest and most-questioned first. Mark
reconstructed rationale `UNVERIFIED` where the history is silent.

## Done when

- Each ADR states a real decision with its true context, the options actually weighed, and honest consequences, traceable to the code that implements it.
- The index lists every ADR.
- Every ADR passes the three-prong admission gate, and every rejected candidate was routed to a named destination rather than written up.
- A senior engineer understands why the system is the way it is, not only what it is.
