---
description: "Use when you need to capture the WHY behind a codebase's architecture as decision records — backfilling load-bearing past decisions or authoring an ADR for a current one."
disable-model-invocation: true
---

# ADR — Architecture Decision Records

**Invoked as `/code-ops-suite:adr`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — especially the **documentation quality standard (`§13`)**.
**Mode:** DOCUMENT. **Produces:** numbered ADRs in `docs/adr/` (match an existing ADR convention if one is present).

## Two modes — confirm which at the start
- **Backfill** — mine the code, VCS history, and existing docs for the **load-bearing decisions already made** (the "why is it this way?" choices a newcomer hits). Write an ADR for each that clears the admission gate below, grounded in evidence.
- **New** — author an ADR for a decision being made now, with options and a recommendation.

**Admission gate (both modes).** A decision earns an ADR only when all three hold: (1) **hard to reverse** — changing it later carries real cost; (2) **surprising without context** — a future reader would ask "why is it this way?"; (3) **a real trade-off** — genuine alternatives existed and one was chosen for specific reasons. A candidate failing any prong is not an ADR — record it where it belongs and name the destination: a code comment at the decision point, the repo's existing docs surface (match its structure, `§12`), or a CHANGELOG line. In Backfill mode this gate filters which mined decisions get written up at all.

## Each ADR (standard form)
`NNNN-title` · **Status** (proposed / accepted / superseded) · **Context** (the forces + constraints) · **Options considered** (with honest trade-offs) · **Decision** · **Consequences** (what it costs and enables, what it precludes). Cite the code/commits that embody the decision. One ADR per choice — keep it to the decision.

## Assemble (per `§13`)
Maintain a `docs/adr/README.md` index. For backfill, rank by how load-bearing the decision is and surface the riskiest / most-questioned first. Mark reconstructed rationale `UNVERIFIED` where the history is silent.

## Done when
Each ADR states a real decision with its true context, the options actually weighed, and honest consequences — traceable to the code that implements it; the index lists every ADR; every ADR passes the three-prong admission gate, and rejected candidates were routed to a named destination rather than written up; a senior engineer understands *why* the system is the way it is, not just what it is.
