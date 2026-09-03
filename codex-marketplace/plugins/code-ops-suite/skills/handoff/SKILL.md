---
name: handoff
description: "Use when a long run must survive a context limit, session end, or operator change. It captures the run's true state as a verifiable HANDOFF.md, or resumes from one after re-verifying every claim."
---

# Handoff: state a fresh session can verify, not instructions to trust

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:handoff`.** First read the `<plugin-root>/CONVENTIONS.md`
bundled with this plugin. It defines the interaction protocol, the safety rails, the evidence
standard, and the shared-artifact conventions this skill extends to session state.
**Mode:** DOCUMENT · **Produces and consumes:** `HANDOFF.md` in the run's dated artifact folder
(`§12`).

## The two directions, picked at the start

- **Write.** The current session is near a context limit, is ending, or is handing the run to another session or operator. Capture the state.
- **Resume.** A fresh session picks up a `HANDOFF.md`. Verify it, then continue the run.

## Write: state, not instructions

Describe what **is true**, never what the next session should do. Write "the leak gate is
implemented, and the register sweep is not started", not "implement the sweep next". A plan
re-derived from verified state beats one inherited on trust. Write these sections, each held to
the evidence standard (`§9`):
- **Goal and state of play:** the run's objective, which phases are complete, in flight, or not started, the automation level in force, and any steering the operator gave (`§3`).
- **Registers and artifacts:** the path of every register, log, and report the run produced, each stamped `Verified-at: <sha>` (`§12`). Point at the evidence, and never re-paste what a register already holds.
- **Decisions made:** each one with its reason and the options rejected. Decisions and rejected approaches are the most valuable and least recoverable session state.
- **Traps and dead ends:** the approaches already tried that FAILED, and the things the next session will be tempted to do wrong. This section is what saves the successor from repeating expensive mistakes.
- **In-flight boundaries:** branch names, uncommitted work, the exact done-against-not-done line, and the load-bearing `file:line` pointers, each carrying a verbatim **Anchor** (`§9`) so the successor can check them mechanically.

Redact secrets and PII (`§4`), because a handoff travels further than a register. Run
`node <plugin-root>/scripts/co.mjs scan redaction HANDOFF.md` before handing it over. It
is the mechanical floor under that rule.

## Resume: verify, then continue

Treat every claim in the handoff as **context to verify against the tree, not fact to trust.**
Run `node <plugin-root>/scripts/revalidate-register.mjs <register> --root .` on every
register the handoff names, and re-triage the non-FRESH items (`§12`). Check the anchored
pointers. A `DRIFTED` pointer marks stale state, not an instruction. Re-run the deterministic
baseline when the tree moved.

Then re-plan from what verified. The traps-and-dead-ends section prunes the search space.
Recorded decisions carry forward unless current code contradicts them. Surface a contradiction at
a checkpoint (`§3`) instead of silently re-deciding.

## Done when

For a **Write**:
- `HANDOFF.md` states the goal, the decisions with their rejected alternatives, the developer's constraints and preferences in their exact words, the traps and dead ends, the in-flight boundaries with anchored `file:line` pointers, every open item or promise, and every register path with a `Verified-at` stamp.
- The file is state throughout, with no instructions and nothing secret.

For a **Resume**:
- Every consumed claim was re-verified against the current tree, with the registers revalidated and the anchors checked, before any work continued.
- Contradictions were surfaced rather than silently resolved.
