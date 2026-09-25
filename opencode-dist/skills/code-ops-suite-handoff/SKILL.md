---
name: code-ops-suite-handoff
description: "Use when a long run needs a continue, compact, or transfer decision. A transfer captures verifiable state as HANDOFF.md; resume re-verifies every claim."
---

# Handoff: state a fresh session can verify, not instructions to trust

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-handoff`, or by the model through the `skill` tool as `code-ops-suite-handoff`.**

**OpenCode runtime note:** Traceless publishing, model-floor enforcement, digest rewrite, index refresh, routing guidance, compaction preservation, the lifecycle plugin, and local documentation MCP registration run automatically. The lifecycle plugin keeps a stable system prefix and writes the cost ledger. Handoff and dispatch notes ride on the next tool result or user turn. Read §3, §4, §9, §12, and §14 of the
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

## Sessions and names

A new session is new work. It is not a handoff unless the operator resumes one. Each substantive
run opens its own folder, so simultaneous sessions never share one:
`node <plugin-root>/scripts/co.mjs run open <slug> --name "<program name>"`. One run folder
belongs to one session, which its `SESSION.json` records. In the Claude desktop app, the host
session id (`local_<uuid>`) differs from the session id. Add `--host-session <id>` to `run open` and
to `handoff resume` there, so peers can find the session by either id.

Each hop names the next session in sequence: `Ledger2 AMM`, then `Ledger2 AMM HO 1`, then
`Ledger2 AMM HO 2`. The handoff's `Session:` line holds the successor's name, and `Hop:` holds its
number. The base name keeps its recorded case and never changes to the `PROGRAM.md` title.

Peers address a program session by its name, never by a bare session id. Before messaging a peer,
resolve the live head with `node <plugin-root>/scripts/co.mjs handoff live "<name>"`: a
handed-off session is finished, and its successor holds the work. Record holds against the program
name.

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
  required transfer or recovery. Unknown telemetry alone is not a restart signal. CONTINUE is
  also right when the remaining work fits in about 100,000 more tokens of context. A handoff
  costs several million tokens to write and resume.
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

On context grounds alone, hand off at a phase boundary once context passes about 350,000 tokens.
Below that line, token pressure alone selects CONTINUE or COMPACT. The quality triggers in the
HANDOFF bullet select HANDOFF at any size. The 150,000-token band and the 300,000-token ceiling
force an assessment, not a handoff. On Grok the line is 200,000, because Grok 4.7 bills double
above it: assess at 150,000 and again before 200,000.

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
and receipt paths. It takes the predecessor from the run's `SESSION.json` and fills `Session:` and
`Hop:`. It refuses a folder that holds `HANDOFF.consumed` or belongs to another session, so a
resumed session writes into its own successor run folder. It carries the predecessor's decisions,
traps, and carried-context bullets as `[FILL: confirm still true]` lines: keep each one that still
holds and delete the rest. Replace each `[FILL: ...]` placeholder with judgment, held to `§9`:
- **Program:** added first, above Goal, because it points at the context every other section sits
  in. It holds `Program: <path to PROGRAM.md>`, `Predecessor: <path to prior HANDOFF.md | none>`,
  `Session: <base name> HO <n>`, and `Hop: <n>`.
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

`/code-ops-suite-handoff resume "<Session name>"`

Use the path to `HANDOFF.md` in place of the name when another unconsumed handoff has the same
`Session:` line.

## Resume: verify, then continue

Treat every claim as **context to verify against the tree, not fact to trust.** Read the goal
and scope documents of the handoff's `PROGRAM.md` before the handoff itself: they show the whole
program, not only the last session. Read its request history only when the tree moved. Run
`node <plugin-root>/scripts/co.mjs handoff resume <HANDOFF.md or session name> --root .` as
the single verification step, adding `--host-session <id>` in the Claude desktop app. It runs the redaction scan, revalidates every named register, runs
`run-runtime.mjs status` and `resume` for a version 3 or newer contract, checks every anchor, and
writes `HANDOFF.consumed` only when every step passes. Its summary gives the same-tree flag, anchor
counts with each non-FRESH pointer, non-FRESH register items, then open items with operator-owned
ones first. A non-zero exit leaves the handoff unconsumed. A pass also creates this session's
successor run folder, seeded with the open items, and prints `session name:` and
`successor run:`, a `links:` block, and last a `set title: "<name>"` line. Work and the next
handoff go in that folder. Set the session title to that name exactly, where the host allows it.
In the Claude desktop app, call `get_session("self")` first, then pass its `session_id` to
`set_session_title`; the call fails without it, and an untitled session gets an automatic title.

Read the summary as state. `DRIFTED` marks stale state and `MOVED` names the anchor's current line.
Runtime drift requires a revised contract and `run-runtime.mjs replan`, never a bypass. Re-triage
non-FRESH register items (`§12`) and re-run the deterministic baseline when the tree moved. On
`same-tree: yes` with a passing resume, the script summary replaces re-reading. Do not reopen a
file or anchor it reports FRESH. Do not re-run a gate the handoff records as passing at the same
HEAD. Keep the handoff's plan, and still verify every claim it marks unverified. Start the
first open item in the same round as the opening reply, unless it needs authority the handoff
lacks. Otherwise re-plan from what verified: traps prune the search, and decisions carry forward unless current code contradicts them. Surface each contradiction at a
checkpoint (`§3`) instead of silently re-deciding.

Open the reply with the program goal and the scope, plan, and design documents from `PROGRAM.md`,
each as a markdown link from the `links:` block. Then list every open item, never a summary, as a
link to its pointer with its owner and done-when, **Blocked on operator** items first. Then give a
recap under five headings: work completed, key findings, in progress, left to do, and project scope
and constraints. Close with the next actions. Mark each claim **verified**, **moved**, or
**drifted**. Preserve the recorded authority limits and ask only
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
- The `## Program` section carries the successor's `Session:` name and its `Hop:`.
- The reply ends with the one paste-ready resume line, by session name when that name is unique,
  and qualifies startup pickup as discovery, not automatic resume.

For a **Resume**:
- `co.mjs handoff resume` passed before any work continued: registers revalidated, anchors checked, runtime status and resume run for a version 3 or newer contract, and `HANDOFF.consumed` written by that passing run.
- Work continues in the successor run folder that resume printed, under the printed session name, set as the session title where the host allows it.
- Contradictions were surfaced rather than silently resolved.
- `PROGRAM.md` was read before the handoff.
- The reply opens with the program goal and linked scope documents, then every open item linked with its owner and done-when, operator-blocked first, then the five-heading recap and the next actions, every claim marked verified, moved, or drifted.
- Authority needed for the next consequential action was confirmed without treating the handoff as a new grant.
