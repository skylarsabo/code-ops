---
description: "Use when a long run must survive a context limit, session end, or operator change: capture the run's true state (decisions, dead ends, in-flight boundaries, register pointers) as a verifiable HANDOFF.md — or resume from one, re-verifying every claim first."
disable-model-invocation: true
---

# HANDOFF — State a Fresh Session Can Verify, Not Instructions to Trust

**Invoked as `/code-ops-suite:handoff`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin — it defines the interaction protocol, safety rails, evidence standard, and shared-artifact conventions this skill extends to session state.
**Mode:** DOCUMENT · **Produces / Consumes:** `HANDOFF.md` in the run's dated artifact folder (`§12`).

## Two directions — pick one at the start
- **Write** — the current session is near a context limit, is ending, or is handing the run to another session/operator: capture state.
- **Resume** — a fresh session picks up a `HANDOFF.md`: verify it, then continue the run.

## Write — state, not instructions
Describe what **is true**, never what the next session should do: "the leak gate is implemented; the register sweep is not started" — not "implement the sweep next". A plan re-derived from verified state beats one inherited on trust. Sections, each held to the evidence standard (`§9`):
- **Goal & state of play** — the run's objective, which phases are complete / in-flight / not started, the automation level in force, and any steering the operator gave (`§3`).
- **Registers & artifacts** — the path of every register/log/report the run produced, each stamped `Verified-at: <sha>` (`§12`). Point at evidence; never re-paste what a register already holds.
- **Decisions made** — each with its why and the options rejected. Decisions and rejected approaches are the most valuable and least recoverable session state.
- **Traps & dead ends** — approaches already tried that FAILED, and the things the next session will be tempted to do wrong. This section is what saves the successor from repeating expensive mistakes.
- **In-flight boundaries** — branch names, uncommitted work, the exact done/not-done line, and the load-bearing `file:line` pointers, each carrying a verbatim **Anchor** (`§9`) so the successor can check them mechanically.
Secrets/PII are redacted (`§4`) — a handoff travels further than a register. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/scan-redaction.mjs HANDOFF.md` before handing it over — the mechanical floor under that rule.

## Resume — verify, then continue
Treat every claim in the handoff as **context to verify against the tree, not fact to trust**: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root .` on every register it names and re-triage non-FRESH items (`§12`); check the anchored pointers (a `DRIFTED` pointer marks stale state, not an instruction); re-run the deterministic baseline if the tree moved. Then re-plan from what verified: the traps & dead-ends section prunes the search space, and recorded decisions carry forward unless current code contradicts them — surface the contradiction at a checkpoint (`§3`) instead of silently re-deciding.

## Done when
Write: `HANDOFF.md` states the goal, decisions with their rejected alternatives, traps/dead ends, in-flight boundaries with anchored `file:line` pointers, and every register path with a `Verified-at` stamp — state throughout, no instructions, nothing secret. Resume: every consumed claim was re-verified against the current tree (registers revalidated, anchors checked) before any work continued, and contradictions were surfaced rather than silently resolved.
