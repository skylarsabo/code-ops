---
name: code-ops-suite-distill
description: "Use to cut a program ledger down to its finish line, at most 12 active items, live decisions, and a backlog. Program mode only; vault mode is not built."
---

# Distill: one program ledger, down to what still decides the finish

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-distill`, or by the model through the `skill` tool as `code-ops-suite-distill`.**

**OpenCode runtime note:** Traceless publishing, model-floor enforcement, digest rewrite, index refresh, routing guidance, compaction preservation, the lifecycle plugin, and local documentation MCP registration run automatically. The lifecycle plugin keeps a stable system prefix and writes the cost ledger. Handoff and dispatch notes ride on the next tool result or user turn. Program mode takes `program <slug>`. Read §3, §4, §9, §12, and §14 of the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin: the interaction protocol, the
safety rails, the evidence standard, the shared-artifact rules, and the writing standard.
Leave the rest of that file unread. Then read the `handoff` skill's sections on `PROGRAM.md` and ledger
grammar 2, because this skill rewrites that ledger and never defines its own grammar.
**Mode:** DOCUMENT · **Consumes:** `<runs root>/programs/<slug>/PROGRAM.md`, its `BACKLOG.md` and
`PROGRAM.archive.md`, and the `TASKS.md` of the program's newest run folder · **Produces:** the
rewritten ledger, and `LEDGER_DIFF.md` in this run's dated artifact folder (`§12`).

## Modes

Distill has two modes. Only program mode exists today.

- **Program mode** (`program <slug>`) rewrites one ledger. It is phase 6 of the design.
- **Vault mode** is the eight-phase backfill of a whole docs vault, and a maintain pass after it.
  It is not available yet. When the operator asks for it, or for any phase other than the ledger
  rewrite, say that vault mode is not built, name program mode as the only option, and stop. Do not
  run part of it, and do not describe it as working.

The design is in `code-ops-docs/10 Design/Agent state machine and host parity 2026-09.md` in the
code-ops repository, section "Distill".

## The five rules

1. **Nothing is deleted.** Every line that leaves the live ledger lands in `PROGRAM.archive.md`
   or `BACKLOG.md`, verbatim. A line the skill edits beyond adding fields is copied first, as
   described in step 6.
2. **Items keep their ids.** Never renumber an item or close one to make room. Closing needs proof.
3. **A ruling keeps its words.** The skill adds an id, `Hop:`, `Disposition:`, and `Supersedes:` to a
   decision. It never rewrites what the decision says. The one exception is a restated superseded
   ruling, which step 4 cuts and step 6 records.
4. **Dispositions are rulings.** A worker may draft one. The lead reads every disposition against
   its source before the run is done, and asks the operator when the source does not settle it.
5. **Existing tools do the moving.** `co program archive`, `co decide promote`, `co burndown`, and
   `co check handoff` carry the mechanics. The skill supplies the judgment they cannot.

## Program mode

Run these steps in order. Stop at each checkpoint that names a decision (`§3`).

1. **Inventory.** Print the starting counts with
   `node <plugin-root>/scripts/co.mjs burndown --program <slug>`. Read `PROGRAM.md`,
   `BACKLOG.md`, `PROGRAM.archive.md`, and the run's `TASKS.md`. Copy the four files to
   `<run dir>/distill-before/`. The copy is the baseline for the diff and the no-loss check.
   Refuse a ledger with no `Grammar: 2` line: its decisions carry no disposition to rewrite. Tell
   the operator to adopt grammar 2 through the `handoff` skill first.
2. **Finish line.** Read `## Finish line`. Each bullet is `- F<n> <check>`, and each check is
   observable. When the ledger has none, draft F1 to Fn from the Program goal and the open items'
   `Done when:` text, and ask the operator to confirm the set. The finish line is the operator's
   ruling. A bullet that no command or observation can settle is not a check: rewrite it as one
   with the operator, or report it.
3. **Open items.** Triage every bullet of `## Open items` and every unchecked `TASKS.md` line.
   - An item that is `- [x]` in `TASKS.md`, or whose done-when check already holds, is a closed item
     listed as open. Verify the proof, then move it to `## Closed items` with its id, how it closed,
     and a pointer. Without proof, keep it open and report it.
   - An item that blocks a finish-line check keeps its line and gains `· Blocks: F<n>`. A missing or
     unknown `Blocks:` target is never invented. The item moves to the backlog instead.
   - An item that blocks no check moves to `BACKLOG.md`, verbatim and with its id.
   - Count the active items. The cap is 12. When more than 12 block a check, rank them by how many
     checks they unblock, keep 12, and ask the operator about the order. Never merge items to fit.
4. **Decisions.** Read every bullet of `## Decisions ledger` and `PROGRAM.archive.md`.
   - Take the next free id across both files. An archived id is taken.
   - A decision with no id gets `DEC-<n>`. One with no `Hop:` gets the hop of the run that made it,
     read from the handoffs and run dates. When no source gives the hop, ask the operator.
   - Each decision gets `Disposition: pending|local|dropped|promoted:<id>`. A decision still
     waiting on a ruling stays `pending`. A decision from before the newest hop may not stay
     pending: settle it or ask. A decision that deserves a register record is promoted with
     `node <plugin-root>/scripts/co.mjs decide promote DEC-<n> --program <slug>`. That
     command writes a record, so ask the operator before each run of it.
   - A superseded decision links to its successor. The successor gains `· Supersedes: DEC-<n>`
     before its `Disposition:`. The older decision gets `Disposition: dropped`. Where the
     successor restates the older ruling, the restatement is removed and its text survives in the
     older line and the trail of step 6. The successor never repeats what the link already says.
5. **Archive.** Run `node <plugin-root>/scripts/co.mjs program archive <slug>`. It moves each
   closed item, each settled decision, and all but the first and last ten requests into
   `PROGRAM.archive.md`. A pending decision stays live. It moves nothing else. A settled decision
   that still guides open work stays reachable in the archive by its `DEC` id.
6. **Trail.** For each live line that step 3 or 4 edited beyond adding fields, append the original
   line, verbatim, under `## Distill trail` at the end of `PROGRAM.archive.md`, as a plain line
   that starts with `Before <date> distill:`. Create the heading when it is missing. Never edit or
   delete an existing archive line.
7. **Verify.** Run `node <plugin-root>/scripts/co.mjs burndown --program <slug>`. It must
   print `active N/12` with N at most 12, and no `missing Blocks`, `OVER CAP`, or `GROWING`. When the
   program has a handoff, run `co check handoff <HANDOFF.md>`: checks 11, 18, and 19 read this
   ledger. The no-loss check for program mode is manual. Diff each file against
   `distill-before/`. Every removed line must have an exact counterpart in the archive, the
   backlog, or Closed items. Any line without one is a loss: restore it before you report.
8. **Ledger diff.** Write `LEDGER_DIFF.md`. It holds the before and after counts of items and
   decisions, one row per moved or edited line (`from -> to`, with the reason), a table of every
   decision with its `DEC` id and disposition, the open questions, and the burn-down line. This is
   the checkpoint artifact. Present it to the operator, and do not finish until the lead has read
   every disposition in it.

Redact secrets and PII before you write any file (`§4`).

## Done when

- The operator asked for program mode on a named ledger. A request for vault mode got a plain "not
  available yet" and no work.
- `PROGRAM.md` has a `## Finish line` with F1 to Fn, each an observable check, confirmed by the operator.
- `## Open items` holds at most 12 bullets, and each carries `Blocks: F<n>` naming a real finish-line item.
- Every other open item sits in `BACKLOG.md` under its original id. Every closed item sits in
  `## Closed items` or the archive, with proof.
- Every live decision carries `DEC-<n>`, `Hop:`, and `Disposition:`. Every superseded decision is
  linked from its successor by `Supersedes:` and is not restated.
- Each removed line appears verbatim in `PROGRAM.archive.md`, `BACKLOG.md`, or `## Closed items`,
  and the diff against `distill-before/` shows no loss.
- `co burndown --program <slug>` prints `active N/12` with N at most 12 and no warning flags.
  `co check handoff` passes when the program has a handoff.
- `LEDGER_DIFF.md` exists, and the lead has read every disposition in it.
