---
name: handoff
description: "Use when a long run needs a continue, compact, or transfer decision. A transfer captures verifiable state as HANDOFF.md; resume re-verifies every claim."
---

# Handoff: state a fresh session can verify, not instructions to trust

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:handoff`.** Read §3, §4, §9, and §12 of the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Those four sections are the
interaction protocol, the safety rails, the evidence standard, and the shared-artifact rules
this skill extends. Leave the rest of that file unread.
**Mode:** DOCUMENT · **Produces and consumes:** `HANDOFF.md` in the run's dated artifact folder
(`§12`).

## Assess the lifecycle first

Default invocation assesses **CONTINUE**, **COMPACT**, or **HANDOFF**. Assess at a phase or
workstream boundary, a context-pressure warning, repeated correction or failed compaction, before
a large new unit, or an explicit handoff request. Record the selected action, observed evidence,
unknowns, and next safe checkpoint in the existing run log. Do not create `HANDOFF.md` for
CONTINUE or COMPACT: startup discovery would misidentify it as a transfer.

Explicit `write` and `resume <path>` take precedence over assessment. Urgent observed context pressure
or a required transfer or recovery takes precedence over a short finish. On Grok Build, headless
Grok, and the Grok ACP agent, a PostToolUse note is the context-pressure warning. UserPromptSubmit
stdout on those surfaces is discarded, so a turn with no tool call still needs the lead's own
150,000-token assessment.

- **CONTINUE** when the bounded objective progresses without observed urgent pressure or a required transfer or recovery.
  A short finish supports continuation only under those conditions. Unknown telemetry alone is not a restart signal.
- **COMPACT** when the same task needs context relief. First persist decisions, rejected
  approaches, authority boundaries, dirty work, verification state, open items, and active
  worker or process ownership in durable run artifacts. Recommend the documented host action for
  the active surface. Execute it only through an actually callable host capability; otherwise tell
  the operator the documented `/compact` action is pending. Never run it in a shell or report
  advice as execution. After compaction, reload bounded durable
  state and check relevant drift. Stable successful checks stand when their inputs did not move.
- **HANDOFF** for a new independent workstream, host or operator change, explicit session end, or
  recovery after failed/thrashing compaction or repeated context-related mistakes. Finish or
  checkpoint the in-flight step at a consistent boundary. Account for live agents, tools,
  background processes, and dirty work; a handoff neither stops them nor proves reattachment.

For runtime contracts version 3 or newer, including version 4, checkpoint before COMPACT or
HANDOFF. Resume and fork carry history; neither is a fresh context reset. A saved handoff is
evidence, never a new authority grant. Existing authorization remains usable for the same task
within its recorded scope; a new session asks only for authority its next consequential action
still lacks. Do not create a new user-owned task without an explicit request.

`handoff assess` records the selected action, evidence, unknowns, next safe checkpoint, and any
pending versus completed host action in the existing run log. It does not create `HANDOFF.md`
unless the assessment selects HANDOFF.

## The explicit directions

- **Write.** An explicit `write` request, or an assessment selecting HANDOFF, captures the state.
- **Resume.** `resume <path>` verifies the named `HANDOFF.md` and continues without a fresh
  lifecycle assessment.

## Write: state, not instructions

Describe what **is true**, never what the next session should do. Write "the leak gate is
implemented, and the register sweep is not started", not "implement the sweep next". A plan
re-derived from verified state beats one inherited on trust. Never restate what `git log`, a
register, or a report already holds. Point at a revision range or a path instead. A merged-PR
history is one `base..head` range plus any notable exception, never a per-PR list.

The first six sections answer what an operator asks a resumed session: what was worked on, what
was found, what is in progress, what is left, and what the scope and constraints are. Write the
sections in this order, each held to the evidence standard (`§9`):
- **Goal and state of play:** the run's objective, which phases are complete, in flight, or not started, the automation level in force, and any steering the operator gave (`§3`). Carry a `Request:` line holding the operator's original request verbatim. The checker fails when that line is absent or empty.
- **Scope and constraints:** the repository, the branch, the areas in scope, the areas explicitly out of scope, and the operator's constraints and preferences in their exact words.
- **Work completed:** what was worked on and finished, as revision ranges and paths. One `base..head` range plus notable exceptions, never a per-commit list.
- **Key findings:** what the run learned that the next session would otherwise re-derive. One line each, carrying a confidence label of `CONFIRMED`, `PROBABLE`, or `SPECULATIVE` and a pointer to its evidence. The checker fails a finding with no label.
- **In-flight boundaries:** branch names, uncommitted work, the exact done-against-not-done line, and the load-bearing `file:line` pointers, each carrying a verbatim **Anchor** (`§9`) so the successor can check them mechanically. This is the in-progress section.
- **Open items:** every open item and every operator decision still awaiting an answer, ordered by priority. This is the left-to-do section. State each as one line of current state, never an instruction, carrying `Owner: agent` or `Owner: operator`, `Done when: <an observable check>`, and a pointer to its evidence. For example: "PAR-003 fix: not started · Owner: agent · Done when: register item closed-with-proof · Pointer: path:line". An unanswered operator decision is an item with `Owner: operator`.
- **Registers and artifacts:** the path of every register, log, and report the run produced, each stamped `Verified-at: <sha>` (`§12`). Point at the evidence, and never re-paste what a register, a report, or `git log` already holds.
- **Decisions made:** each one with its reason and the options rejected. Decisions and rejected approaches are the most valuable and least recoverable session state.
- **Traps and dead ends:** the approaches already tried that FAILED, and the things the next session will be tempted to do wrong. This section is what saves the successor from repeating expensive mistakes.
- **Authority:** the operator's grants, in their exact words, with scope. State that the handoff
  cannot broaden them; the continuing same task retains only its existing recorded scope.
- **Carried context:** every analysis, measurement, or proposal from the conversation that the next session needs, written to a file in the run folder and pointed at here. The conversation is not a durable store. Point at a session receipt or `context-audit` output for the measured session cost, when one exists, instead of re-deriving the number.

Keep `HANDOFF.md` at or under the size cap `check-handoff.mjs` enforces (about 8 KB). Detail
belongs in the pointed-at files, never inline.

Redact secrets and PII (`§4`), because a handoff travels further than a register. Run
`node <plugin-root>/scripts/co.mjs scan redaction HANDOFF.md` and
`node <plugin-root>/scripts/co.mjs check handoff HANDOFF.md` before handing it over. They
are the mechanical floor under redaction and under this section's shape. The handoff check also
resolves every anchored `file:line` pointer against the tree and prints one status each. It fails
on a pointer whose file is gone or whose anchor is nowhere in that file, and warns when the anchor
has only moved to another line. Pass `--strict-anchors` to fail on a moved pointer too.

When the run has a version 3 or newer contract, including version 4, record its path and runtime
receipt path in the handoff.
After writing and scanning `HANDOFF.md`, append
`node <plugin-root>/scripts/run-runtime.mjs checkpoint --root . --contract <contract> --ledger <dispatch ledger> --handoff <handoff>`.
Include `--acceptance <ledger>` when present and repeated artifact or bundle flags for evidence
the successor must retain. Do not rewrite the handoff after binding its bytes to the checkpoint.
Partial acceptance belongs in the checkpoint; completion is not required to hand off.

Close the Write by noting that pickup is conditional: enabled and trusted hooks, a supported host,
a `startup` or `clear` event, accessible run folders, no `HANDOFF.consumed` sibling, and a file
within 14 days. It advertises a file but does not resume it. Then end the reply with exactly one paste-ready
line, and nothing after it:

`code-ops-suite:handoff resume "<path to HANDOFF.md>"`

## Resume: verify, then continue

For a version 3 or newer contract, including version 4, first read
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

Once verification finishes, run
`node <plugin-root>/scripts/co.mjs check handoff HANDOFF.md --consume`. That writes
`HANDOFF.consumed` beside the file, and only on a passing check, so later sessions stop being
offered a handoff this one already picked up.

Open the reply to the operator with a recap under five headings: work completed, key findings, in
progress, left to do, and project scope and constraints. Mark every claim in it **verified**,
**moved**, or **drifted** against the current tree. Keep the recap to those headings and the
open items. The recap is what saves the operator from re-explaining the run.

Present the Open items to the operator once re-planning finishes. Preserve the recorded authority
limits for the same task, and ask only for authority that the next publishing, merge, or other
consequential action lacks (`§3`, `§4`).

## Done when

For an **Assess**:
- The existing run log records CONTINUE, COMPACT, or HANDOFF with observed evidence, unknowns, a
  safe checkpoint, and the completed or pending status of any host action.
- COMPACT is executed only by a callable host capability; otherwise the documented host command
  is pending operator action. Unsupported capability is recorded as unavailable; unobserved
  telemetry or capability is `UNKNOWN`. Use handoff recovery when continuation cannot safely progress.

For a **Write**:
- `HANDOFF.md` states the goal with the operator's request verbatim, the scope and constraints in their exact words, the work completed as revision ranges and paths, the key findings each with a confidence label, the in-flight boundaries with anchored `file:line` pointers, the open items each carrying an owner and an observable done-when check, the decisions with their rejected alternatives, the traps and dead ends, the authority scope and limits, and every register path with a `Verified-at` stamp.
- The file is state throughout, with no instructions and nothing secret.
- `node <plugin-root>/scripts/co.mjs check handoff HANDOFF.md` passes, beside the redaction scan above.
- The reply ends with the one paste-ready resume line and qualifies startup pickup as discovery,
  not automatic resume.

For a **Resume**:
- Every consumed claim was re-verified against the current tree, with the registers revalidated and the anchors checked, before any work continued.
- Contradictions were surfaced rather than silently resolved.
- The reply opens with the five-heading recap, every claim marked verified, moved, or drifted.
- `HANDOFF.consumed` exists beside the file, written by the passing `--consume` check.
- The Open items were presented, and any authority needed for the next consequential action was
  confirmed without treating the handoff as a new grant.
