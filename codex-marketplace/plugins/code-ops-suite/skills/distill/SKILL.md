---
name: distill
description: "Use to cut a program ledger to its finish line, or back-fill a docs vault with a no-loss check, baseline, gate, and maintain pass."
---

# Distill: a program ledger down to its finish line, or a docs vault into standard order

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Codex routing rule:** When you spawn an agent, set `model` and `reasoning_effort` from the brief's `Tier:` and `Effort:` lines, and pass `fork_turns: "none"`. The spawn tool honors `model` and `reasoning_effort` only then. Rung map: light `gpt-6-luna`, mid `gpt-6.1-sol`, strong `gpt-6.1-sol`, premium `gpt-6-astra`, frontier `gpt-6.1-sol`.

**Invoke in Codex by naming `code-ops-suite:distill`.** Program mode takes `program <slug>`. Vault mode takes `vault <hub>`.
Read §3, §4, §9, §12, and §14 of the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin: the interaction protocol, the
safety rails, the evidence standard, the shared-artifact rules, and the writing standard.
Vault mode also reads §1 and §16, for the brief fields and the Workflow fan-out. Leave the rest of that file unread. Then read the `handoff` skill's sections on `PROGRAM.md` and ledger
grammar 2, because this skill rewrites that ledger and never defines its own grammar.
**Mode:** DOCUMENT · **Consumes:** program mode, `<runs root>/programs/<slug>/PROGRAM.md`, its `BACKLOG.md`
and `PROGRAM.archive.md`, and the `TASKS.md` of the program's newest run folder; vault mode, the
hub and each legacy tree the relocate plan names · **Produces:** program mode, the rewritten ledger
and `LEDGER_DIFF.md` in this run's dated artifact folder (`§12`); vault mode, the run's `state.json`,
one artifact per phase, the edited notes, and the hub's `98 System/DISTILL_BASELINE.json`.

## Modes

Distill has two modes.

- **Program mode** (`program <slug>`) rewrites one ledger. It is phase 6 of the design.
- **Vault mode** (`vault <hub>`) is the eight-phase backfill of a whole docs vault, then a maintain
  pass. Phase 6 is program mode, run once per program ledger. Phase 8 writes the baseline, and the
  gate holds the tree to it. The maintain pass works down the baseline and the triage queue within a
  round budget. `conform` routes drift in a state surface to this mode.

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

## Vault mode

Every command below is `node <plugin-root>/scripts/co.mjs docs distill <verb>`, written
`distill <verb>`. The verbs are `inventory`, `no-loss`, `findability`, `baseline`, `gate`, and `state`. Relocation uses
`co docs relocate`.

**The no-loss rules.** They hold in every phase.

1. **Bytes stay.** `git mv` moves a file, and a classifier adds metadata. Nothing rewrites a body.
2. **Old paths resolve.** `FORWARDING.json` maps every moved path to its new path.
3. **Archives are untouched.** An archived file moves whole, and an archive note links its old path.
4. **Runs stay committed.** Distill never prunes `80 Runs`.
5. **The lead reads every ruling.** A decision or an amendment is checked against its source.

A worker never sees an `ANSWER_KEY` or any file under `evals/`. Hand it the batch, the standard, and
the rules above, and nothing else.

**State.** The run keeps `<run dir>/distill/state.json`. Create it once:

```
distill state init --state <run dir>/distill/state.json --hub <hub> --inventory <run dir>/distill/inventory-<tree>.json ...
```

Each phase is `pending`, `running`, `checkpointed`, or `done`. Move it only with the verbs. Never edit
the file by hand.

- `state start N`, then the work, then `state checkpoint N --artifact <file>...`. The artifacts must exist.
- Stop at the checkpoint. The lead does the review in the table, then runs
  `state done N --review "<what the lead read>"`. `state reopen N` sends a failed review back to running.
- A refusal exits 1 and names its cause. Fix the cause. A phase never starts before the one before it is done,
  and a skipped verb is a skipped phase.
- **Resume.** After a compaction or a handoff, run `state show` and continue at its `next:` line. A
  running phase has no checkpoint, so redo it from its start and keep any artifact already on disk.
  A checkpointed phase waits for its review. A done phase stays done.

**Phases.** Run them in order.

| Phase | Work | Checkpoint artifacts | Lead reads before done |
| --- | --- | --- | --- |
| 1 Inventory | Size every tree. List the hub and every legacy tree that moves with `distill inventory --hub <tree> --out <file>`. A tree the register holds by pointer is sized, not listed. Run `co docs relocate plan --run <run dir>/distill`. | the plan files | the totals |
| 2 Relocate | The operator approves the plan first (`§3`). Then `co docs relocate apply --plan <json> --wave <legacy root>`, one wave at a time. | `FORWARDING.json` | the plan, as approved |
| 3 Classify | Workers fill `title`, `topic`, `kind`, `key`, and `decides`, in batches of 25. | per-batch metadata | every decision and amendment line, and each batch sample |
| 4 Chain | Link each amendment, erratum, and supersession. Set `status`. | chain report | every chain edge |
| 5 Drafts | Triage each draft to current, superseded with a link, or archive. | triage list | every archive choice |
| 6 Ledgers | Program mode, once per program ledger. | each `LEDGER_DIFF.md` | every disposition |
| 7 Synthesis | Add `sources:` to each synthesis page. Mark a page stale when a source is superseded or archived. | page list | a sample |
| 8 Install | Write the baseline with `distill baseline --hub <hub> --inventory <file>...`. | the baseline file and the inventory copies in the hub | inputs equal accounted, zero unreachable, and the triage count |

**1 Inventory.** Count files and bytes per tree, and keep the counts for the lead. The inventories are the
input of every later no-loss check, so write them before any file moves. Checkpoint with the relocate plan
as the artifact.

Bring the hub to manifest version 3 before you plan. `relocate plan` and `apply` refuse any other
version, and phase 8 needs the generated triage queue. `Standard.md`, section "Manifest version 3", states
the blocks. Do these steps in order:

1. Set `version` to 3 in `98 System/DOCS_MANIFEST.json`, and add its `runs`, `drafts`, and `state` blocks.
2. Stamp `standard-version: 5` in the hub's `Standard.md`.
3. List every status the vault uses in `drafts.statuses`. The list is the whole vocabulary, so it holds
   `draft`, `current`, and `superseded`, plus `amended` for phase 4 and `stale` for phase 7.
4. Run `node <plugin-root>/scripts/co.mjs check vault <hub> --render`. It writes
   `10 Design/INDEX.md` and `98 System/TRIAGE.md`.

**2 Relocate.** Show the operator the plan totals, the runtime reads, and the unresolved and conflict
counts, and wait for approval. `apply` refuses a dirty tree and never commits. It prints a commit
message for the wave. Give that message to the operator, or commit it when the operator granted commits
for this run, so each wave lands as one commit. The next wave waits for a clean tree. Checkpoint with
the `RELOCATION_PLAN.json` that `plan` wrote and `98 System/FORWARDING.json` as artifacts. `state done 2`
refuses until every row of that plan is applied: its source is gone, or forwarded to a file that exists.
A plan with no rows passes. `done 2` then runs the no-loss check over every inventory and refuses on a loss, an ambiguity, or a count mismatch. A path that moved without a
forwarding entry is a loss. Add the entry and run `done` again.

**3 Classify.** Write the worklist, one repo-relative path per line, and run
`state plan 3 --paths <worklist>`. The plan sorts the paths into batches and picks the sample of each
batch, one path in ten and at least one. Read the plan with `state show --json`. When the vault holds no
page for the phase, run `state plan <n> --none` instead, and `done` accepts the empty plan.

- A worker takes one batch: `state assign 3 --batch <id> --worker <name>`. The worker adds the five fields
  to each note's frontmatter and keeps a field already set. It never edits a body. It fills `decides` from
  the note's decision line, the sentence that states what was chosen, as one line. It never builds `decides`
  from keywords, and it leaves the field out when the note records no decision. State this rule in every
  worker brief. It returns a table of path, fields, and a one-line reason for each `decides`. A note with no
  recoverable key is reported.
- The lead reads every decision and amendment line in the batch against its note, and every sample path. Then
  `state result 3 --batch <id> --defects <n>`. With `n` above 0, the batch goes to full review. The lead
  reads every note in it and runs `state review 3 --batch <id>`. A second pass by a different worker is the
  other way out, and the sample repeats. A worker never classifies its own batch twice, and `assign` refuses it.
- `state done 3` refuses while a batch is unresolved. Checkpoint with the per-batch tables as artifacts.
  A checkpoint with a batch unresolved is a pause. The batch verbs refuse until `state reopen 3`.

**4 Chain.** For each amendment, erratum, or supersession, add `amends:` or `supersedes:` to the later
note, with the path of the earlier one. Set `status` on both: `current`, `amended`, or `superseded`. The
checker rejects a status that `drafts.statuses` does not list, so finish step 3 of phase 1 first. A
superseded note links to its successor. An amendment carries the key of the record it amends. Write the
chain report with one row per edge: from, to, kind, and the sentence in each note that shows it. The lead reads
every row against both notes. An edge the notes do not settle goes to the operator.

**5 Drafts.** Each draft becomes one of three. A draft still in work stays where it is as `current`. A draft
a later note replaces gets `status: superseded` and a link to the successor. A draft with no value moves
whole to `99 Archive`, gets a line in an archive note that links its old path, and gets a forwarding
entry. List every item in `98 System/TRIAGE.md`, sorted, one line each: path, rule, and entry date. The
lead reads every archive choice. `state done 5` runs no-loss again, and it also records the findability
count. Add `--require-findable` once the generated indexes exist, so an unreachable note blocks the phase.

**6 Ledgers.** Run program mode for each program ledger, then record it with `state start 6`,
`state checkpoint 6 --artifact <LEDGER_DIFF.md>...`, and `state done 6`. Program mode refuses a ledger
with no `Grammar: 2` line. Adopt grammar 2 for it through the `handoff` skill first, or list it as skipped
in the checkpoint artifact with that reason. A vault whose ledgers are all legacy finishes phase 6 with that
list as its artifact.

**7 Synthesis.** Plan batches as in phase 3 over every synthesis page, with `state plan 7`. A worker adds
`sources:`, an array of repository-root globs (for example `scripts/**`), not hub-relative paths. The globs
must match tracked files. The worker sets `status: stale` on a page whose source is superseded or archived,
and `stale` must be in `drafts.statuses` (step 3 of phase 1). A page it cannot source is reported and left
alone. The checker fails a page with `sources:` and no `sourceDigest:`. After the lead reads the batch,
record each digest with `node <plugin-root>/scripts/co.mjs check vault <hub> --stamp "<page>"`,
and stamp again after any source changes. The lead reads each batch sample and records `state result 7`,
with the same full-review rule. Checkpoint with the page list.

**Fan-out.** On Claude, phases 3 and 7 fan out through a Workflow as `§16` allows when a batch holds three or more independent units. An operator-invoked distill is the opt-in,
so ask no extra question at the checkpoint. A distill the lead loaded on its own is not, so dispatch with
the host's tool. On every other host, dispatch the same batches as parallel operatives with the host's dispatch tool.
Write the phase plan to the run folder first: each batch, its suite agent (the implementer subagent), its effort, and its artifact path. Register each batch in the dispatch ledger
before dispatch, and `state assign` it. The lead writes each batch report from the returned results.

**8 Install.** Run `state start 8`. Run `distill baseline --hub <hub> --inventory <file>...` once for the
whole set. It writes `<hub>/98 System/DISTILL_BASELINE.json`: each inventory's counts and digest, the
findability count, and the triage queue pointer. It holds no date, so a rerun on the same tree yields
the same bytes. It refuses and writes nothing while a path is lost or ambiguous, while inputs differ
from accounted, while any note is unreachable, or while `98 System/TRIAGE.md` is missing. On success it
copies each inventory into `<hub>/98 System/DISTILL_INVENTORIES/` and cites the copy, so the gate runs
in a fresh clone that lacks the gitignored run folder. Fix the
cause and run it again. Then run `state checkpoint 8 --artifact <baseline>`. The lead reads the counts.
`state done 8` runs the same checks again, always with findability required, and writes the baseline
again. A tree that changed since the checkpoint cannot install.

**The gate.** `distill gate --hub <hub>` compares the tree to the baseline and writes nothing. It exits 1
on a new loss, a new unreachable note, an inventory that differs from its baseline digest, or a moved
triage pointer. `conform` and CI will run it. Run it by hand to check a tree, and never wire it in from
this skill.

**Maintain pass.** The pass starts after phase 8 is done. Run `state maintain-start --budget <n>`. Work
down the baseline and the triage queue, and run `state maintain-round --item <path or entry>` after each
item. An item counts once per pass. Work an item by its rule: link the note from a generated index,
archive a draft with its link and forwarding entry, or settle a status. The round that reaches the
budget stops the pass at a checkpoint, and later rounds exit 1. Report the worked items and the
queue that remains, then stop. `state maintain-start` resumes a checkpointed pass with a fresh round
count. `state maintain-checkpoint` stops a pass early. `state maintain-done --review "<what the lead read>"`
ends the pass on the gate check, which is no-loss over the baseline inventories plus findability. It
refuses on a loss or an unreachable note, and the pass stays open. The lead reads every item worked.

**Verify.** After phases 2 and 5, run `distill no-loss --inventory <file> --hub <hub>` for each inventory and
`distill findability --hub <hub>`. `state done` runs both for those phases, so a pass there is the proof.
Phase 8 and the end of a maintain pass run both through the baseline checks. Report the counts: inputs,
accounted, lost, and unreachable.

**Stop.** Stop at each checkpoint for the lead's review. After phase 8, `state show` prints `next: none` until a
maintain pass opens. A running pass prints `next: maintain-round`, and a pass stopped at its budget prints
`next: maintain-start`. Report the state and stop at the budget. Never start a pass without the
operator's budget.

## Done when

- The operator asked for program mode on a named ledger, or for vault mode on a named hub.
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
- Vault mode: `state show` lists phases 1 to 5, 7, and 8 as `done`, each with a review note. Phase 6 is `done`
  with a `LEDGER_DIFF.md` per ledger, or the operator named a hub with no ledger.
- Vault mode: the end of phases 2, 5, and 8 ran the no-loss check and passed, so every inventory path is in place,
  moved with a forwarding entry, or archived with a link. The findability count was recorded.
- Vault mode: the lead read every decision, amendment, chain edge, and archive choice, and each batch sample.
  No batch is unresolved. Every classified note kept its body byte for byte.
- Vault mode: `98 System/DISTILL_BASELINE.json` exists, and `distill gate --hub <hub>` exits 0 on the tree.
- Vault mode, when a maintain pass ran: it ended with `maintain-done` on a passing gate check, or it stopped at its
  declared budget with a checkpoint that lists the worked items.
