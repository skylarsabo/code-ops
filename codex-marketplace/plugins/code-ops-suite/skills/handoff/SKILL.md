---
name: handoff
description: "Use when a long run needs a continue, compact, or transfer decision. A transfer captures verifiable state as HANDOFF.md; resume re-verifies every claim."
---

# Handoff: state a fresh session can verify, not instructions to trust

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:handoff`.** Read §3, §4, §9, §12, and §14 of the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin: the interaction protocol, the
safety rails, the evidence standard, the shared-artifact rules, and the writing standard. Leave the rest of that file unread.
**Mode:** DOCUMENT · **Produces and consumes:** `HANDOFF.md` in the run's dated artifact folder
(`§12`), beside the live checklist `TASKS.md`.

`TASKS.md` holds one line per item, `- [x]` once done:
`- [ ] OI-<n> <current state> · Owner: agent|operator · Done when: <observable check> · Pointer: <path[:line]>`.
Keep it current through the run. It survives compaction and becomes the handoff's Open items. The
`OI-<n>` id stays stable across every hop, so the checker can diff open items between handoffs.

`PROGRAM.md` is the durable program ledger that every handoff in one program shares. It lives
beside the dated run folders, at `<runs root>/programs/<slug>/PROGRAM.md`, never inside one. Its
sections are Program goal, Request history (append-only, each request verbatim with a leading
`YYYY-MM-DD`), Scope documents (one bullet per design doc, spec, ADR, or register: a backticked
path, `Status:`, and `Role:`), Decisions ledger (append-only; mark superseded entries, never
delete them), and Closed items (id, how closed, pointer). Its cap is 32 KB.

## Assess the lifecycle first

Default invocation assesses **CONTINUE**, **COMPACT**, or **HANDOFF** at a phase boundary, a
context-pressure warning, repeated correction or failed compaction, before a large new unit, or on
request. Record the selected action, observed evidence, unknowns, the next safe checkpoint, and any
pending versus completed host action in the existing run log. Create `HANDOFF.md` only for
HANDOFF: startup discovery would misidentify it as a transfer. Invoking `handoff assess` also
unlocks the dispatch guard's context ceiling (300,000 tokens by default, re-armed each further
150,000-token band; `CODE_OPS_CONTEXT_CEILING` overrides or disables it).

Explicit `write` and `resume <path>` skip assessment. Urgent observed context pressure or a required
transfer or recovery outranks a short finish. On Grok Build, headless Grok, and the Grok ACP agent,
a PostToolUse note is the context-pressure warning; UserPromptSubmit stdout is discarded there, so
a turn with no tool call still needs the lead's own 150,000-token assessment.

- **CONTINUE** when the bounded objective progresses with no observed urgent pressure and no
  required transfer or recovery. Unknown telemetry alone is not a restart signal.
- **COMPACT** when the same task needs context relief. First persist decisions, rejected
  approaches, authority boundaries, dirty work, verification state, and worker or process
  ownership in run artifacts, with open items in `TASKS.md`. Execute the host action only through
  a callable host capability; otherwise report the documented `/compact` as pending. Never run it
  in a shell or report advice as execution. Afterwards reload durable state and check drift;
  stable checks stand when their inputs did not move.
- **HANDOFF** for a new independent workstream, a host or operator change, session end, or
  recovery after failed compaction or repeated context mistakes. Checkpoint the in-flight step at
  a consistent boundary and account for live agents, background processes, and dirty work; a
  handoff neither stops them nor proves reattachment.

For a version 3 or newer runtime contract, checkpoint before COMPACT or HANDOFF. Resume and fork
carry history; neither is a fresh context reset. A saved handoff is evidence, never a new
authority grant: the same task keeps its recorded scope, and a new session asks only for
authority its next consequential action lacks. Never create a new user-owned task unasked.

## Write: state, not instructions

Describe what **is true**, never what the next session should do: "the leak gate is implemented,
and the register sweep is not started". Point at a revision range or a path rather than restate
`git log`, a register, or a report.

Update `PROGRAM.md` first, creating it on the first hop: append this session's request, refresh
the scope-document index and the decisions ledger, and move each open item closed this session
into Closed items. Then write the handoff.

Run `node <plugin-root>/scripts/co.mjs handoff draft --run <run dir> --base <ref> --out <run dir>/HANDOFF.md`.
It fills every mechanical fact: `Verified-at`, branch, dirty paths, the `base..HEAD` range, Open
items from the unchecked `TASKS.md` lines, each artifact stamped `Verified-at`, and the contract
and receipt paths. Replace each `[FILL: ...]` placeholder with judgment, held to `§9`:
- **Program:** added first, above Goal, because it points at the context every other section sits
  in. It holds `Program: <path to PROGRAM.md>` and `Predecessor: <path to prior HANDOFF.md | none>`.
- **Goal and state of play:** a `Request:` line with the operator's request verbatim, the phases complete, in flight, and not started, the automation level, and any steering (`§3`).
- **Scope and constraints:** areas in and out of scope, and the operator's constraints in their exact words.
- **Key findings:** one line each with `CONFIRMED`, `PROBABLE`, or `SPECULATIVE` and a pointer to its evidence.
- **In-flight boundaries:** the done-against-not-done line and the load-bearing `file:line` pointers, each with a verbatim **Anchor** (`§9`).
- **Decisions made:** each with its reason and the options rejected, the least recoverable session state.
- **Traps and dead ends:** approaches that failed, and what the successor will be tempted to do wrong.
- **Authority:** the operator's grants in their exact words, with scope, stating the handoff cannot broaden them.
- **Carried context:** conversation analysis the successor needs, written to a run-folder file and pointed at, plus any session receipt for measured cost.

Open items stay one line of current state each, never an instruction; an unanswered operator
decision is an item with `Owner: operator`. Keep `HANDOFF.md` under the checker's 8 KB cap, with
detail in pointed-at files. The unfilled skeleton fails the check by design.

Redact secrets and PII (`§4`). Run `node <plugin-root>/scripts/co.mjs scan redaction HANDOFF.md`
and `node <plugin-root>/scripts/co.mjs check handoff HANDOFF.md`. The check enforces the
shape and resolves each anchored pointer: `GONE` or `DRIFTED` fails, `MOVED` warns
(`--strict-anchors` fails it). It also checks the lineage: every scope-document path exists, both
requests sit in Request history, and each predecessor open-item id stays open or is closed.

With a version 3 or newer contract, then run
`node <plugin-root>/scripts/run-runtime.mjs checkpoint --root . --contract <contract> --ledger <dispatch ledger> --handoff <handoff>`,
adding `--acceptance <ledger>` when present and artifact or bundle flags for evidence the successor
must retain. Never rewrite the handoff after the checkpoint binds its bytes. Partial acceptance
belongs in the checkpoint.

Close by noting that pickup is conditional: enabled and trusted hooks, a supported host, a
`startup` or `clear` event, accessible run folders, no `HANDOFF.consumed` sibling, and a file within
14 days. Pickup advertises a file; it does not resume it. End the reply with exactly one line:

`code-ops-suite:handoff resume "<path to HANDOFF.md>"`

## Resume: verify, then continue

Treat every claim as **context to verify against the tree, not fact to trust.** Read the
handoff's `PROGRAM.md` before the handoff itself: the goal, the request history, and the scope
documents show the whole program, not only the last session. Run
`node <plugin-root>/scripts/co.mjs handoff resume <HANDOFF.md> --root .` as the single
verification step. It runs the redaction scan, revalidates every named register, runs
`run-runtime.mjs status` and `resume` for a version 3 or newer contract, checks every anchor, and
writes `HANDOFF.consumed` only when every step passes. Its summary gives the same-tree flag, anchor
counts with each non-FRESH pointer, non-FRESH register items, then open items with operator-owned
ones first. A non-zero exit leaves the handoff unconsumed.

Read the summary as state. `DRIFTED` marks stale state and `MOVED` names the anchor's current line.
Runtime drift requires a revised contract and `run-runtime.mjs replan`, never a bypass. Re-triage
non-FRESH register items (`§12`) and re-run the deterministic baseline when the tree moved. On
`same-tree: yes`, accept FRESH anchors without re-reading and keep the handoff's plan; still verify
every claim it marks unverified. Otherwise re-plan from what verified: traps prune the search, and
decisions carry forward unless current code contradicts them. Surface each contradiction at a
checkpoint (`§3`) instead of silently re-deciding.

Open the reply with the program goal and the scope-document list from `PROGRAM.md`, then the
**Blocked on operator** items, then a recap under five headings: work
completed, key findings, in progress, left to do, and project scope and constraints. Mark each
claim **verified**, **moved**, or **drifted**. Preserve the recorded authority limits and ask only
for authority the next consequential action lacks (`§3`, `§4`).

## Done when

For an **Assess**:
- The existing run log records CONTINUE, COMPACT, or HANDOFF with observed evidence, unknowns, a
  safe checkpoint, and the completed or pending status of any host action.
- COMPACT is executed only by a callable host capability; otherwise the documented host command
  is pending operator action. Unsupported capability is recorded as unavailable; unobserved
  telemetry or capability is `UNKNOWN`. Use handoff recovery when continuation cannot safely progress.

For a **Write**:
- `PROGRAM.md` was updated before the handoff: this request appended, the scope-document index and decisions current, and closed items moved.
- The `## Program` section names the ledger and the predecessor handoff, or `none` on the first hop.
- `HANDOFF.md`, drafted by `co.mjs handoff draft`, states the goal with the operator's request verbatim, the scope and constraints in their exact words, the work completed as revision ranges and paths, the key findings each with a confidence label, the in-flight boundaries with anchored `file:line` pointers, the open items each carrying an owner and an observable done-when check, the decisions with their rejected alternatives, the traps and dead ends, the authority scope and limits, and every register path with a `Verified-at` stamp.
- The file is state throughout, with no instructions, no `[FILL: ...]` placeholder, and nothing secret.
- `node <plugin-root>/scripts/co.mjs check handoff HANDOFF.md` passes, beside the redaction scan above.
- The reply ends with the one paste-ready resume line and qualifies startup pickup as discovery,
  not automatic resume.

For a **Resume**:
- `co.mjs handoff resume` passed before any work continued: registers revalidated, anchors checked, runtime status and resume run for a version 3 or newer contract, and `HANDOFF.consumed` written by that passing run.
- Contradictions were surfaced rather than silently resolved.
- `PROGRAM.md` was read before the handoff.
- The reply opens with the program goal and scope documents, then the operator-blocked items, then the five-heading recap, every claim marked verified, moved, or drifted.
- Authority needed for the next consequential action was confirmed without treating the handoff as a new grant.
