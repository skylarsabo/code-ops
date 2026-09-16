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
re-derived from verified state beats one inherited on trust. Never restate what `git log`, a
register, or a report already holds. Point at a revision range or a path instead. A merged-PR
history is one `base..head` range plus any notable exception, never a per-PR list. Write these
sections, each held to the evidence standard (`§9`):
- **Goal and state of play:** the run's objective, which phases are complete, in flight, or not started, the automation level in force, and any steering the operator gave (`§3`).
- **Registers and artifacts:** the path of every register, log, and report the run produced, each stamped `Verified-at: <sha>` (`§12`). Point at the evidence, and never re-paste what a register, a report, or `git log` already holds.
- **Decisions made:** each one with its reason and the options rejected. Decisions and rejected approaches are the most valuable and least recoverable session state.
- **Traps and dead ends:** the approaches already tried that FAILED, and the things the next session will be tempted to do wrong. This section is what saves the successor from repeating expensive mistakes.
- **In-flight boundaries:** branch names, uncommitted work, the exact done-against-not-done line, and the load-bearing `file:line` pointers, each carrying a verbatim **Anchor** (`§9`) so the successor can check them mechanically.
- **Open items:** every open item and every operator decision still awaiting an answer, ordered by priority. State each as one line of current state, never an instruction, carrying `Owner: agent` or `Owner: operator`, `Done when: <an observable check>`, and a pointer to its evidence. For example: "PAR-003 fix: not started · Owner: agent · Done when: register item closed-with-proof · Pointer: path:line". An unanswered operator decision is an item with `Owner: operator`.
- **Authority:** the operator's grants, in their exact words, with scope. State that none of them carries into the resumed session until the operator re-grants it there.
- **Carried context:** every analysis, measurement, or proposal from the conversation that the next session needs, written to a file in the run folder and pointed at here. The conversation is not a durable store. Point at a session receipt or `context-audit` output for the measured session cost, when one exists, instead of re-deriving the number.

Keep `HANDOFF.md` at or under the size cap `check-handoff.mjs` enforces (about 6 KB). Detail
belongs in the pointed-at files, never inline.

Redact secrets and PII (`§4`), because a handoff travels further than a register. Run
`node <plugin-root>/scripts/co.mjs scan redaction HANDOFF.md` and
`node <plugin-root>/scripts/co.mjs check handoff HANDOFF.md` before handing it over. They
are the mechanical floor under redaction and under this section's shape. The handoff check also
resolves every anchored `file:line` pointer against the tree and prints one status each. It fails
on a pointer whose file is gone or whose anchor is nowhere in that file, and warns when the anchor
has only moved to another line. Pass `--strict-anchors` to fail on a moved pointer too.

When the run has a version 3 contract, record its path and runtime receipt path in the handoff.
After writing and scanning `HANDOFF.md`, append
`node <plugin-root>/scripts/run-runtime.mjs checkpoint --root . --contract <contract> --ledger <dispatch ledger> --handoff <handoff>`.
Include `--acceptance <ledger>` when present and repeated artifact or bundle flags for evidence
the successor must retain. Do not rewrite the handoff after binding its bytes to the checkpoint.
Partial acceptance belongs in the checkpoint; completion is not required to hand off.

## Resume: verify, then continue

For a version 3 contract, first read
`node <plugin-root>/scripts/run-runtime.mjs status --root . --contract <contract>`.
Its bounded pointers identify pending dispatches, unresolved criteria, and drift. Then run
`run-runtime.mjs resume --root . --contract <contract>` to verify the checkpoint and append a
resume receipt. Drift requires a revised contract and `run-runtime.mjs replan`, never a bypass.
Version 1 or 2 runs continue through the artifact verification below.

Treat every claim in the handoff as **context to verify against the tree, not fact to trust.**
Run `node <plugin-root>/scripts/revalidate-register.mjs <register> --root .` on every
register the handoff names, and re-triage the non-FRESH items (`§12`). Run
`node <plugin-root>/scripts/co.mjs check handoff HANDOFF.md` for the mechanical anchor
check over the handoff's own pointers, then read what it reports. A `DRIFTED` pointer marks stale
state, not an instruction, and a `MOVED` one names the line the anchor sits on now. Re-run the
deterministic baseline when the tree moved.

Then re-plan from what verified. The traps-and-dead-ends section prunes the search space.
Recorded decisions carry forward unless current code contradicts them. Surface a contradiction at
a checkpoint (`§3`) instead of silently re-deciding.

Present the Open items to the operator once re-planning finishes. Authority the handoff recorded
does not carry into this session. Ask the operator to re-grant the scope it names before any
publishing, merge, or other consequential action (`§3`, `§4`).

## Done when

For a **Write**:
- `HANDOFF.md` states the goal, the decisions with their rejected alternatives, the developer's constraints and preferences in their exact words, the traps and dead ends, the in-flight boundaries with anchored `file:line` pointers, the open items each carrying an owner and an observable done-when check, the authority grants and their expiry, and every register path with a `Verified-at` stamp.
- The file is state throughout, with no instructions and nothing secret.
- `node <plugin-root>/scripts/co.mjs check handoff HANDOFF.md` passes, beside the redaction scan above.

For a **Resume**:
- Every consumed claim was re-verified against the current tree, with the registers revalidated and the anchors checked, before any work continued.
- Contradictions were surfaced rather than silently resolved.
- The Open items were presented, and the operator re-granted any authority the handoff recorded before it was used.
