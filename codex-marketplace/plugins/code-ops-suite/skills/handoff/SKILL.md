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
A line may also carry `· Blocks: F<n>`, which names the finish-line check the item blocks.

`PROGRAM.md` is the durable program ledger that every handoff in one program shares. It lives
beside the dated run folders, at `<runs root>/programs/<slug>/PROGRAM.md`, never inside one. Its
sections are Program goal, Request history (append-only, each request verbatim with a leading
`YYYY-MM-DD`), Scope documents (one bullet per design doc, spec, ADR, or register: a backticked
path, `Status:`, and `Role:`), Decisions ledger (append-only; mark superseded entries, never
delete them), and Closed items (id, how closed, pointer). Its cap is 32 KB.

**Program convergence.** `PROGRAM.md` may hold a `## Finish line` section. Each bullet is
`- F<n> <check>`: one observable check that ends the program. A program with a finish line keeps at
most 12 active items, and each names the check it blocks with `· Blocks: F<n>`. Every other item
lives in `programs/<slug>/BACKLOG.md`, beside `PROGRAM.md`. Never close or renumber an item to make
room. A new finding goes to the backlog unless it blocks a check. Resume prints a burn-down line:
finish-line checks met out of total, and active items against the cap of 12.

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
The first hop may instead keep the name of a session the operator already named, with no `HO`
suffix; the next draft appends ` HO 2` to that name.

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
a turn with no tool call still needs the lead to checkpoint before the host compact. The host
compacts near 184,000 tokens.

- **CONTINUE** when the bounded objective progresses with no observed urgent pressure and no
  required transfer or recovery. Unknown telemetry alone is not a restart signal. CONTINUE is
  also right when the remaining work fits in about 100,000 more tokens of context. A handoff
  costs several million tokens to write and resume.
- **COMPACT** when the same task needs context relief. On Claude and Codex, this is the answer to
  token pressure. First persist decisions, rejected approaches, authority boundaries, dirty work,
  verification state, and worker or process ownership in run artifacts, with open items in
  `TASKS.md` and the log in `RUN_LOG.md`. Execute the host action only through a callable host
  capability; otherwise report the documented `/compact` as pending, or let the host
  auto-compact. Never run it in a shell or report advice as execution. Afterwards reload durable
  state and check drift; stable checks stand when their inputs did not move.
- **HANDOFF** only to start new work, or to move to a clean session that loads updated code-ops
  plugins or contracts. A host change, a failed compaction, or repeated context mistakes also need
  one. A long session keeps its agents and peers reachable, so the operator never repeats context.
  Checkpoint the in-flight step at
  a consistent boundary and account for live agents, background processes, and dirty work; a
  handoff neither stops them nor proves reattachment.

On Claude and Codex, context size alone never selects HANDOFF. Codex compacts itself near the
size in `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (250000 recommended); Codex compacts natively. The
handoff card names that setting when it is unset on Claude. A handoff cycle costs about 10.8M
billed tokens, orphans running background agents, and grew the open items at every hop, so the
quality and transfer triggers in the HANDOFF bullet select HANDOFF at any size. On Claude and
Codex, the 150,000-token band asks the lead to checkpoint (`TASKS.md` current, a `Next:` line in
`RUN_LOG.md`), not to assess or hand off. The 300,000-token ceiling forces an assessment on a
session that chose CONTINUE and overran. Keep `TASKS.md` and `RUN_LOG.md` current before any
compaction, and tag the `RUN_LOG.md` lines the compaction snapshot carries. `co snapshot --fields`
prints them from `CARRIED_FIELDS` in `scripts/compact-snapshot.mjs`, the one list that maps each
handoff field below to its snapshot section. A compaction then keeps what a handoff keeps. After
one, the routing card names the snapshot and lists the open `TASKS.md` lines when it is stale.
It also lists under `Pending agents:` each background agent the session launched that has not reported.

On Grok, the host compacts near 184,000 tokens. That is 72 percent of the 256,000-token window, before the 200,000-token price line. Grok 4.7 bills double above that line. Checkpoint first. Keep `TASKS.md` current and append a `Next:` line to `RUN_LOG.md`. Stay on the 256,000-token window.

After the compact, read the newest compaction segment before the host summary. The segment holds the earlier work. A later climb toward 184,000 tokens is a new session pointed at that segment. Another compact summarizes a summary. A token count does not select a handoff. Hand off only when a compact has failed, the next step is new work, plugins or contracts must reload, or the host changes.

Only Grok has a price-line card and a `Continue-until:` bound. An assessment that returns CONTINUE past that line records the bound in the run log, as `Continue-until: <N> tokens` or `Continue-until: <N> turns`. The latest such line wins, and a malformed one sets no bound. The card stays quiet while the bound holds, then fires again.

On Grok, a session with no operator prompt since the last card runs autonomously. There the card says to checkpoint and stop so the operator can run `/compact`. It does not say to write a handoff for the token count.

A typed prompt past 200,000 tokens is blocked until `/compact`, a handoff command, or a live `Continue-until:` bound. That block means the host compact did not run. The record unlocks later prompts in the same ceiling band. The next 150,000-token band blocks again. A host compact records the same assessment. Claude and Codex cards follow a prompt, so they never say this.

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
resumed session writes into its own successor run folder. It also refuses while an agent this
session launched has not reported: wait for it, settle a lost one with
`co agents settle <id> --failed --reason <text>`, or pass `--pending-agents-ok` to record it under
In-flight boundaries. It carries the predecessor's decisions,
traps, and carried-context bullets as `[FILL: confirm still true]` lines: keep each one that still
holds and delete the rest. Replace each `[FILL: ...]` placeholder with judgment, held to `§9`:
- **Program:** added first, above Goal, because it points at the context every other section sits
  in. It holds `Program: <path to PROGRAM.md>`, `Predecessor: <path to prior HANDOFF.md | none>`,
  `Session: <base name> HO <n>` (the first hop may keep an existing session name), and `Hop: <n>`.
- **Goal and state of play:** a `Request:` line with the operator's request verbatim, the phases complete, in flight, and not started, the automation level, and any steering (`§3`).
- **Scope and constraints:** areas in and out of scope, and the operator's constraints in their exact words.
- **Key findings:** one line each with `CONFIRMED`, `PROBABLE`, or `SPECULATIVE` and a pointer to its evidence.
- **In-flight boundaries:** the done-against-not-done line and the load-bearing `file:line` pointers, each with a verbatim **Anchor** (`§9`).
- **Decisions made:** each with its reason and the options rejected, the least recoverable session state. Under ledger grammar 2, the reason and rejected options go in the `PROGRAM.md` Decisions ledger, and this section lists each decision as `- DEC-<n> <one clause>`. To promote a decision to the register, run `co decide promote DEC-<n> --program <slug>`. It stages the record, sets the ledger disposition, and renders the register in one step.
- **Traps and dead ends:** approaches that failed, and what the successor will be tempted to do wrong.
- **Authority:** the operator's grants in their exact words, with scope, stating the handoff cannot broaden them.
- **Carried context:** conversation analysis the successor needs, written to a run-folder file and pointed at, plus any session receipt for measured cost.

With `--out`, and the Program ledger resolves, draft also writes `SCOPE_DIGESTS.md` beside the
handoff, outside its cap: for each
`PROGRAM.md` scope document, a sha256 of its bytes, `Verified-at:`, and a digest. A document
unchanged since the predecessor keeps its digest. Replace each `[FILL: digest]` with one paragraph
on what that document now holds.

A `PROGRAM.md` with a `Grammar: 2` line opts in to ledger grammar 2. The ledger gains an Open
items section, and it holds each decision and open item once. Each decision carries `DEC-<n>`,
`Hop: <n>`, and `Disposition: pending|local|dropped|promoted:<record id>`. Each pointer carries an
`Anchor:`. An item whose owner or done-when changes carries `Revised: hop <n> · <reason>`. Draft
then fills each pointer's anchor from its cited line. It shows a carried open item as id and title,
keeps the full line for an item changed this hop, and writes that line back to the ledger. It
lists each pending decision from an earlier hop as `[FILL: disposition]`, which you settle in the
ledger. A decision made this hop may stay `pending` for one hop. For a first hop, pass
`--program <PROGRAM.md>` so draft can write scope digests. When the ledger nears its 32 KB cap, run
`node <plugin-root>/scripts/co.mjs program archive <slug>`. It moves closed items, settled
decisions, and all but the first and last ten requests to `PROGRAM.archive.md`.

Open items stay one line of current state each, never an instruction; an unanswered operator
decision is an item with `Owner: operator`. Keep `HANDOFF.md` under the checker's 8 KB cap, with
detail in pointed-at files. The unfilled skeleton fails the check by design.

Redact secrets and PII (`§4`). Run `node <plugin-root>/scripts/co.mjs scan redaction HANDOFF.md`
and `node <plugin-root>/scripts/co.mjs check handoff HANDOFF.md`. The check enforces the
shape and resolves each anchored pointer: `GONE` or `DRIFTED` fails, `MOVED` warns
(`--strict-anchors` fails it). It also checks the lineage: every scope-document path exists, both
requests sit in Request history, and each predecessor open-item id stays open or is closed. Under
grammar 2 it also runs checks 11 to 13 and 15 to 18, and a bare pointer fails instead of warning.

With a version 3 or newer contract, then run
`node <plugin-root>/scripts/run-runtime.mjs checkpoint --root . --contract <contract> --ledger <dispatch ledger> --handoff <handoff>`,
adding `--acceptance <ledger>` when present and artifact or bundle flags for evidence the successor
must retain. Never rewrite the handoff after the checkpoint binds its bytes. Partial acceptance
belongs in the checkpoint.

Close by noting that pickup is conditional: enabled and trusted hooks, a supported host, a
`startup` or `clear` event, accessible run folders, no `HANDOFF.consumed` sibling, and a file within
14 days. Pickup advertises a file; it does not resume it. End the reply with exactly one line:

`code-ops-suite:handoff resume "<Session name>"`

Use the path to `HANDOFF.md` in place of the name when another unconsumed handoff has the same
`Session:` line.

## Resume: verify, then continue

Treat every claim as **context to verify against the tree, not fact to trust.** Read the goal
and scope-document index of the handoff's `PROGRAM.md` before the handoff itself: they show the
whole program, not only the last session. Read its request history only when the tree moved. Run
`node <plugin-root>/scripts/co.mjs handoff resume <HANDOFF.md or session name> --root .` as
the single verification step, adding `--host-session <id>` in the Claude desktop app. It runs the redaction scan, revalidates every named register, runs
`run-runtime.mjs status` and `resume` for a version 3 or newer contract, checks every anchor, and
writes `HANDOFF.consumed` only when every step passes. Its summary gives the same-tree flag, anchor
counts with each non-FRESH pointer, non-FRESH register items, then open items with operator-owned
ones first. When the handoff has `SCOPE_DIGESTS.md`, resume fails while it holds `[FILL: digest]`,
and the summary marks each scope document `unchanged`, `changed`, or `missing`. Read the digest of
an `unchanged` document instead of the document; read a `changed` or `missing` one in full.
A non-zero exit leaves the handoff unconsumed. A pass also creates this session's
successor run folder, seeded with the open items, and prints `session name:` and
`successor run:`, a `links:` block, and last a `set title: "<name>"` line. Work and the next
handoff go in that folder. Set the session title to that name exactly, where the host allows it.
Read the `program overlap:` block if resume prints one. Ask the operator before you continue when another live program lists the same scope document.
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
- `SCOPE_DIGESTS.md`, when draft wrote it, holds a filled digest for every scope document.
- `node <plugin-root>/scripts/co.mjs check handoff HANDOFF.md` passes, beside the redaction scan above.
- The `## Program` section carries the successor's `Session:` name and its `Hop:`. The first hop may keep an existing session name with no `HO` suffix.
- The reply ends with the one paste-ready resume line, by session name when that name is unique,
  and qualifies startup pickup as discovery, not automatic resume.

For a **Resume**:
- `co.mjs handoff resume` passed before any work continued: registers revalidated, anchors checked, runtime status and resume run for a version 3 or newer contract, and `HANDOFF.consumed` written by that passing run.
- Work continues in the successor run folder that resume printed, under the printed session name, set as the session title where the host allows it.
- Contradictions were surfaced rather than silently resolved.
- `PROGRAM.md` was read before the handoff, and each `unchanged` scope document through its digest only.
- The reply opens with the program goal and linked scope documents, then every open item linked with its owner and done-when, operator-blocked first, then the five-heading recap and the next actions, every claim marked verified, moved, or drifted.
- Authority needed for the next consequential action was confirmed without treating the handoff as a new grant.
