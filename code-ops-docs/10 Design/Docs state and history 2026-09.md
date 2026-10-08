---
type: design
status: superseded
superseded-by: "[[Program state handoffs and coordination 2026-09]]"
updated: 2026-09-27
tags:
  - design
  - vault
  - records
  - handoff
---

# Docs state and history 2026-09

> Superseded on 2026-09-27 by [[Program state handoffs and coordination 2026-09]], which merges this draft with its sibling. This file stays as evidence.

Source: a read-only review of the murmuration documentation on 2026-09-25, then a map of the code-ops record, manifest, vault, and handoff tooling. Seven explorers ran over disjoint slices. The lead verified every load-bearing claim with direct probes. Findings about murmuration name paths and counts only.

Verified-at: c204b17 (2026-09-25). Revisions 2 and 3 (hop 1) add measured murmuration data, a lead review, and a record-tooling trace. They also fold in an independent refutation. Evidence: `80 Runs/2026-09-25-docs-state-history-ho1/reports/`.

## Overview

An adopting repository loses decisions as its documentation grows. The cause is not size. Every layer that grows is append-only, and every layer that should distill it is manual and unchecked. When volume rises, the manual layers stop, and nothing reports it.

This design splits every vault into two layers:

- **History** is append-only and unbounded. It holds records, runs, closed drafts, and the archive. No session loads it by default.
- **State** is small, current, and mostly generated. It holds the decision register, the indexes, the synthesis pages, and the home note. Each surface has a word budget.

One invariant ties them together. Every decision in force has exactly one register line, and that line cites its history source. A decision that exists only in history fails the gate.

The design also removes the legacy `docs/` tree. Its files move into the vault once, with their bytes preserved and each move recorded. After the move, a gate and a write hook keep the tree from returning.

The feature ships as a new skill, `code-ops-suite:distill`, plus changes to the Standard, the record tooling, the vault checker, and the handoff lifecycle. The handoff changes are the core of the design. Program ledgers are where most decisions are made, so the promotion step lives there.

## Evidence from murmuration

Each line below was observed on the murmuration tree at `e9dbc182`.

| Observation | Measure | Label |
| --- | --- | --- |
| Corpus size | 2.5M words in the vault, 1.8M in `docs/` | CONFIRMED |
| Growth | 22 tracked Markdown files in mid-July, 2,691 on 2026-09-21 | CONFIRMED |
| Run share | `80 Runs/` holds 1.7M words and 5,404 tracked files. The hop-1 survey counted 5,409 at a later HEAD | CONFIRMED |
| Settled-record index | Last updated 2026-08-26. It omits 108 of the 223 records it should list, including all 90 from September. The 435 below counts every adopted record, a wider population | CONFIRMED |
| Decision home | The Standard routes decisions to `20 Decisions/`, which does not exist | CONFIRMED |
| Curation ledgers | All five `*-curation.jsonl` files are 0 bytes | CONFIRMED |
| Generated record catalog | Current, but it lists opaque record ids with no title, topic, or status | CONFIRMED |
| Draft status | 219 design notes say `draft`. At least 36 share a stem with a settled record | CONFIRMED |
| Draft metadata | 15 distinct status words. Some notes say `draft` while the body says SUPERSEDED | CONFIRMED |
| Amendments | 23 amendment files link to their original. No original links forward | PROBABLE |
| Synthesis pages | `50 Topics/` unchanged since 2026-09-03, against 439 docs commits in 14 days | CONFIRMED |
| Atlas | All seven sections STALE since 2026-09-08 | CONFIRMED |
| Run decisions | Most program-ledger decisions never leave the run folder | PROBABLE |
| CI | No docs, manifest, records, or vault check runs in CI | CONFIRMED |
| `docs/` references | 327 code files hold about 930 references to `docs/preliminary` and `docs/audit` | CONFIRMED |
| Record collections | 435 ready records in 5 collections: audit 228, preliminary 118, reference 52, superpowers 35, manifests 2 | CONFIRMED |
| Decision share | 51 records look like decisions or rulings by file name. 384 look like evidence or reports | PROBABLE |
| Program ledgers | 136 decision bullets across 4 ledgers and 1 overflow file, 34.5 words each. The largest ledger is 30,287 bytes, near the 32 KB cap | CONFIRMED |
| Synthesis size | `50 Topics/` holds 70,792 words in 19 pages. Two compendia hold 56,898 of them | CONFIRMED |
| Run kinds | 164 run folders. Slug keywords miss most research, and RESULTS or EVIDENCE files cluster in migration runs | CONFIRMED counts, PROBABLE kinds |
| Run citations | 112 of 164 run folders (68%) are cited from tracked files outside `80 Runs/` | CONFIRMED |
| Run markers | No run carries a kind or retention field. 21 carry `SESSION.json` | CONFIRMED |

Three gaps in code-ops explain these observations:

- Nothing installs the docs gates into an adopting repository's CI. Every manual index therefore decays silently.
- The program ledger has no close step and no decision ids. Decisions therefore stay in run folders.
- Curation state is a free-form object, and the inventory stores no title or topic. The generated catalog therefore cannot answer "what is decided now".

## Operator decisions

The operator accepted every recommendation of the review on 2026-09-25. The recorded constraints, in the operator's words:

- "essentially this 'fix' needs to be baked into code ops"
- "whichever would be the best long term solution, it may depend per project, so that comes into play in a way. standardaization and normalization are important"
- "no i dont ever open docs/ only if i have to and its frustruating when i have to"
- "needs to be designed into code ops as a feature that can cleanup this mess and standardize for the future so we can always maintain high quality outputs without loosing context"
- "ensure this will bake cleanly into handoffs so nothing gets messy"
- "id also like to have a docs folder to NOT exist. agents will still read that eventually or innevitably and leaves it open for error. so moving files"

- "what im afraid of is breaking things and want to avoid that. but need to have agents understanding whats going on"
- "for run retention profiles some of the info in murmuration runs are extremly important (research releated) so that is dependent"
- "murmuration specifically is a mix of research and busy work so it needs to be extremly well thought out"

The sixth constraint supersedes an earlier answer that preferred logical unification. The last three add the safety guarantees and per-run retention below.

Accepted recommendations:

| Question | Decision |
| --- | --- |
| Skill shape | A new skill, `code-ops-suite:distill`, with `backfill` and `maintain` modes |
| Default run profile | `closeout`, with `tracked` as an explicit per-project choice. Each run also carries its own retention class |
| Gate strength in adopters | Fail-closed, with a ratchet baseline for the existing backlog |
| `docs/audit` | Moved whole into history. Only its executive summaries enter the register |
| Legacy tree | Moved into the vault. The `docs/` folder stops existing |

## The model

### Layers

| Layer | Contents | Mutability | How a session reaches it |
| --- | --- | --- | --- |
| State | `00 Home.md`, `20 Decisions/REGISTER.md`, `10 Design/INDEX.md`, `80 Runs/INDEX.md`, `98 System/TRIAGE.md`, synthesis pages that declare sources | Rewritten in place, mostly generated | One link from the routing-card line |
| History | Record collections, dated run folders, `PROGRAM.archive.md`, closed drafts, `99 Archive/` | Append-only. Record bytes never change | Through a state link |

Nothing beyond the routing-card line loads by default. A budget therefore bounds the cost of one read, not a per-turn charge. The manifest declares each state surface and its word budget, and the gate fails a surface over budget. "State budgets" below sets the numbers from murmuration measurements.

The register holds rules, not evidence. `decision` and `amendment` records get a line in the rule table. Audit executive summaries get one line each in a short second table, as the operator accepted for `docs/audit`. Other evidence and reports stay in history and are reached through topic pages. A register over budget splits by topic into `20 Decisions/<topic>.md` files under one short `REGISTER.md`.

### The invariant

1. Every decision in force has one register line.
2. Every register line cites one history source: a record id, and a run or program id when it came from a run.
3. Every program-ledger decision carries a disposition within one hop of being made.
4. No two in-force register lines claim the same topic key without a `supersedes` or `amends` link.

The gate checks all four. Clause 4 surfaces conflicting decisions from parallel programs as a gate failure, not as silent drift.

**The topic key.** A key has the form `<domain>/<subject>`, such as `records/relocation`.

- `<domain>` is the `id` of a `domains` entry in the manifest. The manifest already holds this closed set, 16 ids in code-ops, so an unknown domain fails validation.
- `<subject>` is a kebab-case slug of one to five words, `[a-z0-9]+(-[a-z0-9]+){0,4}`.
- A `decision` or `amendment` record must carry a key. Other kinds must not.
- An amendment carries the key of the record it amends.

Clause 4 compares keys as exact strings. It cannot see two slugs that name one subject. `distill maintain` lists same-domain pairs that share a slug word as triage items, never as gate failures, because a fuzzy match must not block a merge.

### Decision status

Curation state becomes a closed set:

| Status | Meaning | Register shows |
| --- | --- | --- |
| `in-force` | The rule applies as written | The rule line |
| `amended` | The rule applies with later amendments | The rule line and each amendment id, in order |
| `superseded` | A later record replaces the rule | Nothing in the main table. The history section links it |
| `historical` | Evidence or a report, not a rule | Nothing, except a `summary` record, which gets a line in the summaries table. Others stay reachable through their topic page |

Status changes are curation events. Record bytes never change, so a write-once record still reads as amended in the register.

## Workstreams

### W1. Standard v5 and manifest v3

The Standard gains the two layers, the invariant, and three profile blocks in the manifest.

```json
{
  "runs": { "tracking": "closeout", "retain": ["2026-09-11-migration-execution/P4/**/RECEIPT*.md"] },
  "drafts": { "maxAgeDays": 21, "statuses": ["draft", "current", "accepted", "superseded"] },
  "state": { "REGISTER.md": { "budgetWords": 3000 }, "10 Design/INDEX.md": { "budgetWords": 3000 } }
}
```

- `runs.tracking` accepts `tracked`, `closeout`, or `ignored`. Under `closeout`, program folders and each `CLOSEOUT.md` are committed, and dated run folders are ignored except the `retain` globs. The default for a new adopter is `closeout`. No code reads `runs.tracking` today (`scripts/docs-manifest.mjs:76` only validates it), so the gate must enforce the tracked set itself. The v3 schema also admits the `closeout` value and the `retain` key.
- The project profile sets only the default. Each run also carries a retention class, because one repository can mix research evidence with routine work. See "Retention by run class" below.
- `drafts.statuses` replaces profile statuses declared in prose. The checker reads the list from the manifest.
- `legacyPaths` gains two dispositions beside `pointer` and `tombstone`. `relocated` names a moved root and its target. `removed` names a root that must not exist on disk.

**Doctrine change.** The Standard today makes adopted paths irreversible as well as adopted bytes. v5 keeps bytes irreversible and lets a collection root move. Each move is a `relocate-root` curation event, and every record keeps its bytes and its path relative to the root. This change needs its own decision note, `D-004 collection roots may relocate`, which supersedes the path clause and cites this design.

Revision 1 allowed one move per record path. Revision 2 allowed a chain of per-record moves. Revision 3 moves whole roots instead, because four path rules would drop a moved record from its collection (see W2). A root may move more than once. Each move folds one prefix swap.

### W2. Records carry meaning

`records.mjs` and `record-lib.mjs` change as follows:

- Inventory entries gain `title`, `topic`, `kind`, `key`, and `decides`. `kind` is one of `decision`, `amendment`, `erratum`, `evidence`, or `report`. `decides` is one line of at most 25 words, required for `decision` and `amendment` only.
- Records gain `amends` beside `supersedes`.
- Curation events gain a `type` field: `curate` or `relocate-root`. An event with no `type` reads as `curate`, so existing ledgers stay valid.
- A `curate` event's `state` becomes the closed status set above, validated on append.
- A `relocate-root` event records `{ fromRoot, toRoot }`. The validator rejects it when any record's bytes differ at the new root.
- `kind` gains `summary`, for an audit executive summary. A `summary` record gets one line in the register's summaries table.
- `records render` gains a `--register` target. It writes `20 Decisions/REGISTER.md` with one line per in-force or amended decision, grouped by topic: id, the `decides` line, date, source link, and amendment ids. It also writes `98 System/Records/state.json`, the lookup the hooks use.
- A new collection, `decisions`, rooted at `<hub>/20 Decisions/Records/native/`, receives every new decision. Moved legacy collections sit beside it under `20 Decisions/Records/<name>/`. The existing `D-NNN` notes in code-ops adopt into it by genesis adoption.

#### Identity survives a move

A record id is a hash of the collection UUID and the record's path (`recordId` at `scripts/record-lib.mjs:413`). Four rules pin a record to its path today:

- `check` fails a moved file with "immutable record deleted, renamed, or reclassified" (`scripts/records.mjs:1367`).
- Collection membership filters tracked paths by the collection root.
- Adopted-record history is profiled by current path (`scripts/records.mjs:1440`).
- Lineage skips rename events (`scripts/record-lib.mjs:800`).

So records move only as whole collections. Revision 2 split one legacy root across several targets, which would drop records from their collection.

- **A collection moves with its root.** A root relocation records `{ fromRoot, toRoot }` in the manifest and in one typed curation event. Every record keeps its path relative to the root.
- **Identity stays fixed.** The inventory keeps each adoption path as the identity path, and `identityVersion` stays 1. The current path is the identity path with the root prefix swapped.
- **Checks fold the root.** Membership, `check`, and history profiling use the folded path. Lineage follows the root rename as one step.
- **History verifies at its own commits.** `verify-history` checks each batch at its `sourceHead`, where the old root still holds the bytes.
- **Kind lives in metadata, not folders.** A legacy collection that mixes rulings and evidence moves whole. The `kind` field sorts its records, and the register reads `kind`.

Per-record relocation is out of scope. A later need gets its own decision note.

#### Intake and seal

Two chains would fork on parallel branches, not one. The curation ledger requires a gapless `sequence` and a digest chain (`scripts/record-lib.mjs:1256`). The inventory's authority batches chain the same way (`scripts/records.mjs:1210`).

A `native-append` batch has three more rules:

- Its `sourceHead` is the commit the record was admitted against. The path must have no history there (`scripts/records.mjs:610`, `:1239-1241`).
- An uncommitted batch must bind the current HEAD.
- `sourceHead` must stay reachable from HEAD (`scripts/records.mjs:1221`).

A squash or rebase merge rewrites branch commits. A batch written on a feature branch therefore breaks `verify-history` on the base branch.

Revision 1 answered the fork with `records rechain`, which rewrites events after a merge. Rechain cannot repair an unreachable `sourceHead`. Revision 2 sealed on the feature branch, which the rules above also refuse. Revision 3 keeps every branch write off both chains and seals only on the base head:

1. **Intake.** A branch writes the record body to `98 System/Records/intake/<collection>/`, outside the collection root. It adds one line to `98 System/Records/intake.jsonl`, naming the target path. The record id derives from the target path, so it is known at intake. A curation change also goes to intake.
2. **Seal.** `co docs seal` runs on a fresh branch cut from the current base head. In one commit, it moves each intake body to its target path. It also appends the authority batches and curation events, and it clears the sealed intake lines. The batch binds the base head, where the target path has no history. That commit stays reachable after any merge strategy, because it sits on the base branch.
3. **Serial seals.** Two seal branches bind the same base head, so the second fails `baseBindings` after the first merges. The seal holds nothing else, so the fix is to discard it and seal again from the new head. `distill maintain` and a post-merge step run seals. `integrate-branch.mjs` never seals, because a feature branch cannot.
4. **Render.** The register and `state.json` read sealed state plus intake, and they mark intake lines `pending seal`.
5. **Age.** The gate fails an intake line that stays unsealed on the base branch past 14 days. That line enters the ratchet like any other violation.

`records curate` writes the chain directly today (`scripts/records.mjs:1767`). Under a v3 manifest it refuses to run off the base head and routes the change to intake.

**Typed events.** The ledger validator requires a `state` object on every event (`scripts/record-lib.mjs:1258`), and the fold keeps the last `state` per record (`:1270`). A root relocation event therefore carries `type: relocate-root`, and the validator checks its own fields instead of `state`. The fold skips every type other than `curate`, so a relocation never overwrites a status.

**Two branches curate one record** (DSN-2). Each curation intake line names a `basis`: the per-record head digest it saw, or the id of an earlier intake line for the same record. The ledger already keeps that head as `previousRecordEventDigest`. The seal applies intake in file order. It refuses a line whose recorded head no longer matches and names both lines. A session that reads both writes one resolving intake line. Last-event-wins folding (`scripts/record-lib.mjs:1268`) would otherwise drop one branch's change without a trace.

### W3. Remove the legacy tree

A new command, `co docs relocate`, moves a legacy tree into the vault in two steps.

`plan` classifies every file and writes `RELOCATION_PLAN.md` and `RELOCATION_PLAN.json` in the run folder. Each row names the source, the target, the kind, and the reason. The default routing:

| Legacy content | Target | Layer |
| --- | --- | --- |
| A record collection that holds rulings, whole | `20 Decisions/Records/<collection>/` | History. Its `decision`, `amendment`, and `summary` records surface in the register |
| An audit record collection, whole | `99 Archive/Audit/`, subpaths preserved | History. Its `summary` records surface in the register |
| Live registers still named as scope by an open program | `99 Archive/Audit/`, flagged for promotion | History, with a triage item |
| References that a manifest domain owns | That domain's target folder | State |
| Specs and plans | `10 Design/Specs/` when current, else `99 Archive/Specs/` | By status |
| Machine-read manifests | `35 Contracts and Data/Manifests/` | State |

The plan also sorts each code reference as a runtime read or as prose. A runtime read is a path that code opens, such as a machine manifest. Runtime reads carry the breakage risk, so the operator reviews them as a separate list.

`apply` executes the reviewed plan in waves, one legacy root per wave, such as `docs/audit` and then `docs/preliminary`. Each wave is one commit:

1. `git mv` each file, so rename detection keeps blame.
2. Append one `relocate-root` event per moved collection. The wave branch is cut from the base head and holds no other chain write, so it follows the serial-seal rule in W2.
3. Update `98 System/FORWARDING.json`, the old-to-new path map.
4. Rewrite every reference in code, tests, workflows, `AGENTS.md`, and vault notes.
5. Set the wave's root to `removed` in the manifest.
6. Render the register and indexes.
7. Run the gate and the adopter's test command.

**Rehearsal.** Each wave runs first in a scratch worktree. The wave lands only when the gate and the adopter's tests pass there.

**What apply never rewrites.** Record bytes, anything under `80 Runs/`, and every `PROGRAM.md` and `HANDOFF.md` keep their old paths. They are history, and a live session may hold a ledger dirty. Murmuration held one at review time. These files resolve old paths through `FORWARDING.json`. The owning session's next `handoff draft` writes new paths into its own ledger.

**Preconditions.** `apply` refuses a dirty tree and a base older than the plan. Revision 1 also refused while any handoff was unconsumed. A repository with live programs rarely meets that, and murmuration had two. It is no longer needed, because apply leaves handoff bytes alone.

**Guards after the move:**

- The gate fails when a `removed` root exists on disk. It also fails when a tracked file outside history and `FORWARDING.json` references a relocated path.
- The `enforce-legacy-paths` PreToolUse hook denies a Write or Edit under a `removed` root. It is on by default, with an off switch like the other suite hooks.
- `integrate-branch.mjs` runs `co docs relocate forward` on a branch that predates a wave. It rewrites the branch's references through `FORWARDING.json`. It also moves each file the branch added under a removed root, through the plan's routing table. A missing route stops the step with the file named.

### W4. Vault checks

`check-vault-standard.mjs` adds these rules:

- Status must come from `drafts.statuses`.
- `superseded` requires a `superseded-by` link that resolves.
- A note whose status is `draft` and whose first 30 lines carry a PROMOTED or SUPERSEDED marker fails.
- A draft older than `drafts.maxAgeDays` needs a `next:` line, or it enters the triage queue.
- `10 Design/INDEX.md` is generated. It groups notes by status and lists each with its `updated` date and `next:` line.

The triage queue is `98 System/TRIAGE.md`, a generated state surface. Each line names the path, the rule, and the date the item entered. The gate renders it, and `distill maintain` works it down.

Atlas freshness becomes general. Any state page may declare `sources:` as globs or register topics. The gate fails a page when a source changed after the page's recorded digest. `docs-manifest.mjs` already stores source digests per domain, so this reuses that code path. A synthesis page with no `sources:` line and no update in `drafts.maxAgeDays` enters the triage queue.

### W5. Handoff integration

This workstream makes promotion part of every hop. Most decisions are made inside programs, so the ledger is where they must be caught. Each change extends a rule that already exists.

#### Ledger grammar

The Decisions ledger gains stable ids and a disposition, mirroring the open-item grammar:

```
- DEC-14 2026-09-25 The register splits by topic past its word budget · Rejected: one file with anchors · Hop: 3 · Disposition: pending
```

- `DEC-<n>` is unique within its program. One program has one live head session, and the peer guard already enforces that. Two sessions therefore never mint the same id.
- `Hop:` records the hop that made the decision.
- `Disposition:` is one of `pending`, `local`, `dropped`, or `promoted:<record id>`. `local` means the decision binds only this program. `dropped` means a later decision in the same program replaced it.
- Superseded entries stay, as today. A superseding entry names the id it replaces.

#### Checks added to `check-handoff.mjs`

| Check | Rule | Mirrors |
| --- | --- | --- |
| 11. Decision ids | Every Decisions-ledger bullet carries a `DEC-<n>` id, a `Hop:`, and a `Disposition:` | Check 4 for open items |
| 12. Disposition age | An entry made at a hop before the current `Hop:` must not be `pending` | New. It gives each decision one hop of grace |
| 13. Decision carry-forward | Every `DEC` id in the predecessor's `## Decisions made` appears in the ledger or its archive | Check 9 for open items |
| 14. Promotion resolves | Every `promoted:<id>` resolves in `state.json` or in intake on the working tree | Check 9 for scope documents |
| 15. Handoff points, not copies | Each `## Decisions made` bullet in `HANDOFF.md` leads with a `DEC` id | New. The ledger holds the text once |

Check 15 removes a duplicate that exists today, where the same decision is written in both the handoff and the ledger. The handoff keeps one clause of reason per decision and points at the ledger for the rest. The handoff skill's Write section says each decision carries "its reason and the options rejected". PR 4 changes that sentence and its eval in the same commit.

A promoted record lands only when its branch merges. A resume on another branch, or after the branch was abandoned, would otherwise fail check 14 or trust a record that never landed. So check 14 reads the working tree, and resume reports each missing id as UNLANDED, a warning. `handoff close` requires every promoted id sealed on the base branch.

#### Write

`co handoff draft` lists every `pending` decision from earlier hops as a `[FILL: disposition]` line. The unfilled skeleton already fails the check by design, so a hop cannot close with an old pending decision. A decision made in the current hop may stay `pending`. It is carried forward to the next hop, which must settle it.

A new command, `co decide promote DEC-<n> --program <slug>`, does the promotion in one step:

1. Write a record file and its intake line to the `decisions` collection, with `decides`, `topic`, `key`, `kind: decision`, and a `source` naming the program and hop.
2. Write the curation intake line.
3. Set the ledger disposition to `promoted:<record id>`.
4. Render the register.

One command writes all four, so the ledger and the register cannot disagree. The seal runs later, on the base branch, as W2 describes. The Write section of the handoff skill gains one sentence routing to this command.

#### Resume

`co handoff resume` adds two lines to its summary:

- Pending decisions from earlier hops. Check 12 makes this zero on a valid handoff, so a non-zero count means the handoff was written before this feature.
- Register drift. Each `promoted:` id whose status became `superseded` or `amended` since the predecessor was written is reported DRIFTED. Another program changed a rule this one relies on, so resume surfaces it as a contradiction, per the skill's existing rule.

Scope-document paths and anchors that miss on the tree fall back to `FORWARDING.json`. A forwarded hit reports MOVED, which warns, not GONE, which fails. Consumed handoffs from before the relocation therefore still resolve.

#### Ledger overflow

The 32 KB cap stays. Overflow gets one standard sibling, `programs/<slug>/PROGRAM.archive.md`, with only the Decisions ledger and Closed items headings. A new command, `co handoff archive`, moves entries there:

- It moves closed items, and decisions whose disposition is not `pending`.
- It refuses a `pending` decision, so size management can never bury an unsettled one.
- Checks 13 and 14 read both files when resolving ids.

This replaces the unstandardized `CLOSED-ARCHIVE.md` that murmuration programs use today. `distill backfill` renames those files and validates them against the grammar.

#### Program close

A program has no end today. A new command, `co handoff close <slug>`, adds one. Its preconditions:

- No `pending` decision.
- No open item, or each remaining item moved to a named successor program with `Owner: operator`.
- No unconsumed handoff in the chain.

It then does three things:

1. It writes `programs/<slug>/CLOSEOUT.md`: goal, outcome, the revision range, each promoted decision linked to its register line, and counts of closed items and local decisions.
2. It adds `Status: closed` under `## Program goal`.
3. It updates `80 Runs/INDEX.md`.

After close, `co handoff live` reports the program as closed, and the routing card stops advertising its handoffs. Under the `closeout` profile, the committed program folder is the permanent record of the program.

#### Parallel sessions and branches

| Surface | Conflict risk | Resolution |
| --- | --- | --- |
| Native record files | None. Each record is one file with a path-derived id | None needed |
| Authority batches and curation ledger | Both chains fork, and a branch `sourceHead` dies in a squash merge | Branches write intake only. The seal runs against the base branch. CI runs `verify-history` strictly |
| Intake files | Two branches append lines | `merge=union`. Order is file order, and the seal's `basis` check catches a same-record race |
| Sealed files | Two branches seal the same base intake | The seal is deterministic, so a conflict resolves by taking the base copy and sealing again |
| Register, indexes, `state.json` | Both branches regenerate them | Derived files. Never hand-merged. The pre-commit hook regenerates them, as it does host distributions today |
| Ratchet baseline | Both branches shrink it | One sorted violation per line. CI fails a baseline line that is not a live violation or not in the merge-base baseline. A union merge can then restore nothing, and a hand-added line fails |
| `DEC` ids | None within a program. The peer guard allows one live head | None needed |
| Conflicting rules from two programs | Both promote a rule on the same topic key | Invariant clause 4 fails the gate. The second promoter must add `supersedes` or `amends` |

### W6. One gate, installed

A new command, `co docs gate`, runs every docs check in order:

1. `docs-manifest check`
2. `records check` and `verify-history` for each collection, and the intake age rule
3. `check-vault-standard`
4. Register freshness, the invariant, and state budgets
5. Draft and staleness rules
6. Legacy-path guards
7. The tracked-run set against `runs.tracking` and each run's retention class
8. Ledger checks 11 to 14 over every open program tracked on the current branch. An untracked ledger gets check 14 as an UNLANDED warning only, so a promotion on one branch never blocks commits on another

**Ratchet.** On first adoption, the gate writes `98 System/GATE_BASELINE.jsonl` with every existing violation, one per line. Later runs fail on any violation not in the baseline. A fixed violation leaves the baseline at the next run, and the baseline never grows. This follows the repository rule that no gate turns fail-open.

**Installation.** `conform` installs the gate into the adopting repository: one CI step and one pre-commit entry. It also adds the pointer lines to `AGENTS.md`. `integrate-branch.mjs` gains a docs step that runs `records seal`, renders, and runs the gate.

**Removal.** `conform --remove docs-gate` takes out the CI step, the pre-commit entry, and the pointer lines as one adopter commit. The adopter reviews it like any change. Removal is the adopter's own choice, so it weakens no code-ops gate. It gives an adopter blocked by a gate defect a reviewed way out instead of a hand edit.

### W7. The `distill` skill

`code-ops-suite:distill` turns history into state.

**backfill** is the one-time cleanup of an existing sprawl. Each phase ends at a checkpoint:

1. **Inventory.** Size every tree. Run `co docs relocate plan` when a legacy tree exists.
2. **Relocate.** The operator reviews the plan. `apply` runs under the preconditions in W3.
3. **Classify.** Mechanical agents fill `title`, `topic`, `kind`, `key`, and `decides` for records, in batches of about 25. The lead reviews every `decision` and `amendment` line against its source, because a wrong summary of a ruling is worse than none. For other kinds, the lead reviews a 10% sample per batch, and one defect sends the whole batch to full review. Murmuration projects to about 51 decision-kind records and 384 others.
4. **Chain.** Link amendments, errata, and supersessions. Set each record's status.
5. **Drafts.** Triage every draft to `current`, `superseded` with a link, or archive.
6. **Ledgers.** Assign `DEC` ids and dispositions to every program ledger. Promote or mark `local` each decision. Standardize overflow files.
7. **Synthesis.** Add `sources:` to each synthesis page. Mark each stale page for refresh or archive it.
8. **Install.** Write the baseline and install the gate through `conform`.

**maintain** is a small, schedulable pass. It works down the baseline and the triage queue, and it stops at a declared round budget.

`conform` routes to `distill` when it finds drift in state surfaces. `doc-alignment` keeps its role: it reconciles docs against code, and `distill` reconciles history against state.

### W8. Session context

- **Routing card.** SessionStart adds one line: the register path, its entry count, and a warning when the gate would fail. It points and does not load, so it costs about 30 tokens.
- **History read notice.** A PostToolUse hook looks up a path in `state.json` when the file sits in a history location. For a record that is not `in-force`, it adds one context line naming the status, the replacing record, and the register line. An agent that opens an old record still learns the current rule. It is on by default, with an off switch.
- **Read paths.** Agents read files through Read, and also through shell commands and Grep. The hook therefore matches Read, Grep, and the shell tool, and it extracts history paths from the tool input. A path it cannot extract gets no notice. The register and the `AGENTS.md` pointer remain the backstop.

**Reach per host** (DSN-3). The table comes from the host coverage table at `code-ops-docs/50 Platform/INFRASTRUCTURE.md:197` and the adapter code. It is static evidence. PR 5 adds live-payload eval cases per host.

| Mechanism | Claude | Grok | Codex | OpenCode |
| --- | --- | --- | --- | --- |
| Read notice | Reaches: native PostToolUse context | Probable: a PostToolUse note reaches, as the handoff card shows. The read tool's name is UNVERIFIED | Probable: the renderer drops Claude-only matchers, and the payload adapter filters the tool. Codex reads through its shell tool, so the shell path must be extracted | Reaches: `tool.execute.after` appends to the tool output (`scripts/opencode-lifecycle.js:1313`) |
| Write deny under a removed root | Reaches: PreToolUse | Reaches: canonical command hook | Reaches: payload-adapted hook | Reaches: `tool.execute.before` port |
| Routing-card line | Reaches | No: passive stdout is unavailable, so the `AGENTS.md` pointer carries it | Reaches: projected session context | Reaches: system transform |

## Retention by run class

A project-wide profile is too coarse for a repository that mixes research with routine work. Murmuration runs include research evidence the operator calls extremely important, beside build and cleanup runs. So retention is set per run, and the project profile supplies only the default.

This section is a proposal built from a survey of 164 murmuration run folders (DSN-4). The operator accepted it on 2026-10-08. The run classes, the skill defaults, the raise and lower rule, and the citation gate are built; the retention profiles and untracking are not.

### What the survey showed

- **Names do not reveal research.** Slug keywords matched 27 research runs, and 72 slugs matched no kind at all. Most of those 72 are domain research named in project terms.
- **Artifacts do not reveal research either.** RESULTS, EVIDENCE, and DATA files, and the plots, cluster in the 7 migration runs. RECEIPT files appear in every kind.
- **Mixed runs are common.** 46 non-research runs hold findings, results, evidence, or receipt files.
- **Citation does reveal use.** 112 of 164 runs (68%) are cited from tracked files outside `80 Runs/`.
- **No run carries a marker today.** 21 runs hold `SESSION.json`, and none records a kind.

So recognition cannot be automatic from content. It needs an explicit class plus a citation check.

### The rules

- **Classes.** `co run open` takes `--retention evidence|working`. The class goes in `SESSION.json` and the run index.
- **Default from the opening skill.** Research, audit, calibration, and review skills open `evidence` runs. Build skills such as `ship`, `feature-implementation`, and `remediation` open `working` runs. A skill with no mapping opens `evidence`.
- **Citation raises the class.** The gate fails a `working` run that a tracked file outside `80 Runs/` cites, unless the citation targets its `CLOSEOUT.md`. The fix raises the run to `evidence` or retargets the citation.
- **Unclassified means evidence.** Losing research is worse than keeping busywork.
- **Only the operator lowers a class.** An agent may raise one.
- **Untracking waits for program close.** Later hops cite earlier runs, so a `working` run keeps its files until its program closes.
- **A profile change never untracks a committed run.** Untracking an existing run needs its own classification pass and operator sign-off, recorded per run.

| Profile | `evidence` run | `working` run |
| --- | --- | --- |
| `tracked` | Tracked whole | Tracked whole |
| `closeout` | Tracked whole | `CLOSEOUT.md` and `retain` globs, after its program closes |
| `ignored` | Not tracked. Its findings must reach a committed record or register line before its program closes | Not tracked |

Under `ignored`, `evidence` never means "track". Code-ops ignores `80 Runs/` by ADR 0001, and its calibration runs hold private-repo detail under the one-way channel rule. Revision 1 would have committed them.

### Recommendation for murmuration

Keep `tracked`. The design already stops runs from costing agent context, because history loads only through a state link. What remains is repository size. Migration runs hold 3,563 of the 5,409 run files, and their receipts must stay. Most other runs are cited or unrecognizable as research. Untracking would save little and put research at risk.

## State budgets

This section is a proposal built from murmuration measurements (DSN-5). It waits on operator acceptance. Budgets count words. One 3,000-word read costs about 4,000 tokens.

| Surface | Budget | Basis |
| --- | --- | --- |
| `REGISTER.md` summaries table | 1,500 | One line per audit executive summary. The murmuration count is UNMEASURED, so backfill measures it before this budget binds |
| `REGISTER.md` | 3,000 | 51 decision-kind records at 40 words a line is about 2,040. A register of all 435 records would reach 17,400, which is why evidence stays out |
| `20 Decisions/<topic>.md` | 3,000 | Same line size, after a split |
| `10 Design/INDEX.md` | 3,000 for `draft` and `current` notes | 281 notes at about 17 words a line is about 4,800. `accepted` and `superseded` notes move to an unbudgeted history index |
| Synthesis page | 2,500 | The eight largest ordinary topic pages run 810 to 1,475 |
| `00 Home.md` | 600 | 237 in murmuration, 463 in code-ops |
| `80 Runs/INDEX.md` | 3,000 | Open programs and runs from the last 30 days. Older rows move to a history index |
| `98 System/TRIAGE.md` | 2,000 | One `maintain` pass must be able to work it |

**Research and routine share one set of budgets.** State holds rules and pointers for both. Research depth lives in history, which has no budget, and a synthesis page reaches it through `sources:`.

Two murmuration compendia hold 32,509 and 24,389 words. No page budget fits them. Backfill adopts each as an `evidence` record under its topic. The topic page keeps a synthesis within budget that links them. Nothing is deleted.

## Safety and rollout

The operator's first concern is breaking working repositories. These guarantees bind every workstream:

1. **Nothing changes in an adopter until it opts in.** A code-ops upgrade adds commands and checks, but an adopting repository sees no new gate until `conform` installs it there.
2. **In-flight programs stay resumable.** Ledger checks 11 to 15 apply only to a `PROGRAM.md` that declares `Grammar: 2`. A new program starts at grammar 2 only where the manifest is v3. Revision 1 started every new program there, which would have added checks in a repository that never opted in.
3. **Every mutating command plans first.** `relocate`, `backfill`, `archive`, and `close` each have a plan mode that writes only to the run folder. The operator reviews the plan before `apply`.
4. **Each apply wave is one revertable commit.** `git revert` of that commit restores the prior tree while no later commit depends on it. A wave therefore lands alone.
5. **Nothing is deleted.** Relocation moves files. Archiving moves entries. Untracking a committed run follows the rule in the retention section.
6. **The adopter's own tests gate a relocation.** Each wave passes the repository's test suite in a rehearsal worktree before it lands, because code reads some moved files at runtime.
7. **Old citations keep resolving.** `FORWARDING.json` answers every old path in record bytes, run folders, ledgers, handoffs, and git history.
8. **Agents learn the new layout from the session start.** The routing-card line, the `AGENTS.md` pointer, and the read notice each point at the register. Reach differs by host, as the W8 table shows. On every host, the `AGENTS.md` pointer is the floor.

Each guarantee has a named eval case that must pass before the PR that could break it merges (DSN-6):

| Guarantee | Eval case | Suite | PR |
| --- | --- | --- | --- |
| 1 | `upgrade-without-conform-adds-no-failure`: a v2-manifest fixture passes the old and new gate chains alike | `evals/docs-manifest` | 3 |
| 2 | `grammar1-ledger-resumes-unchanged`: the existing ledger fixtures pass checks 1 to 10 and skip 11 to 15; a new program under a v2 manifest opens at grammar 1 | `evals/handoff-check` | 4 |
| 3 | `plan-writes-run-folder-only`: after each plan mode, `git status` shows changes only under the run folder | new `evals/docs-relocate` | 5 |
| 4 | `apply-wave-revert-restores-tree`: the tree hash after `git revert` equals the hash before apply | `evals/docs-relocate` | 5 |
| 5 | `apply-preserves-every-blob`: every source blob sha exists at its target; `archive-moves-not-deletes` for ledgers | `evals/docs-relocate`, `evals/handoff-check` | 5, 4 |
| 6 | `apply-refuses-failing-tests`: a fixture test reads a moved manifest, and apply stops in rehearsal when it fails | `evals/docs-relocate` | 5 |
| 7 | `forwarding-resolves-record-citation` and `handoff-anchor-forwarded-reports-moved` | `evals/docs-relocate`, `evals/handoff-check` | 5, 4 |
| 8 | `routing-card-register-line` and `read-notice-superseded-record`, the second with Claude and OpenCode payload shapes | hook evals | 6, 5 |

The mechanisms that revision 2 adds get cases too:

- `seal-two-branch-disjoint`: two branches promote different records, and the merged seal verifies.
- `seal-two-branch-same-record`: both branches curate one record, and the seal refuses with both lines named.
- `seal-after-squash-merge`: the sealed `sourceHead` stays reachable after a squash merge.
- `relocate-root-keeps-record-id`: every record in a moved collection keeps its id and passes `check` and `verify-history`.
- `seal-refuses-feature-branch`: `co docs seal` refuses a HEAD that is not the base head.
- `curate-routes-to-intake`: `records curate` off the base head writes intake, never the chain.
- `invariant-key-collision`, `invariant-key-superseded`, and `invariant-key-unknown-domain` cover clause 4.
- `retention-cited-working-run-fails` and `retention-ignored-evidence-not-tracked` cover the retention rules.

The two-branch cases need a fixture that `evals/record-collections` does not build today. That suite already builds a temporary git repository, so it gains a second branch.

## Murmuration adoption

The adoption is a calibration of the feature, not a separate project.

1. Run `distill backfill` assess-only through the `calibration-run` skill. Only the sanitized note returns to code-ops.
2. Run `backfill` for real. The measured scale is 435 adopted records in 5 collections, 219 drafts, and 136 decisions in 4 program ledgers and 1 overflow file. It also covers 1,157 files under `docs/`. Live handoffs no longer block relocation, because apply leaves ledgers and handoffs alone.
3. Keep the `tracked` profile, as the retention section recommends. The operator confirms this at the checkpoint.

The move rewrites about 930 references in 327 code files, in two waves: `docs/audit`, then `docs/preliminary`. Each wave passes the repository's test suite in rehearsal, because some references are runtime reads of machine manifests.

## Delivery

| PR | Content | Depends on |
| --- | --- | --- |
| 1 | Standard v5, manifest v3 schema, and decision note D-004 | None |
| 2 | Record fields, the status set, `amends`, typed events, identity through moves, intake and seal, and register rendering | 1 |
| 3 | Vault-check rules, generalized staleness, `co docs gate`, and the ratchet | 1, 2 |
| 4 | Handoff checks 11 to 15, `co decide promote`, `co handoff archive`, `co handoff close`, and resume fallbacks | 2 |
| 5 | `co docs relocate`, the legacy-path hook, and the read notice hook | 2, 3 |
| 6 | The `distill` skill, `conform` installation, the routing-card line, and `integrate-branch` steps | 3, 4, 5 |
| 7 | Evals | Each PR adds its own cases. This PR adds the end-to-end fixture |

PR 4 bumps the handoff contract in `CONTRACTS.md`. Existing program ledgers have no `DEC` ids, so checks 11 to 15 apply only to a program whose `PROGRAM.md` declares `Grammar: 2`. `distill backfill` upgrades a ledger to grammar 2. A new program starts at grammar 2 only under a v3 manifest. This keeps every in-flight program resumable during the rollout.

Each PR carries the eval cases the Safety table assigns to it.

**Evals.** A new fixture repository holds planted buried decisions:

- A promoted draft still marked `draft`.
- An amended record with no forward link.
- A program decision with no durable home.
- A stale synthesis page.
- A legacy `docs/` tree with code references.

Its answer key scores `distill backfill`. The handoff eval gains cases for checks 11 to 15, for overflow refusal, and for close preconditions.

## Rejected alternatives

- **Logical unification, keeping `docs/` on disk.** Rejected by the operator. Agents inevitably read the old tree, and nothing on disk tells them a record is superseded.
- **A physical move without a relocation event.** It breaks `verify-history`, and the move itself leaves no audit trail.
- **Rewriting citations inside record bytes.** It violates write-once evidence. Forwarding resolves those citations instead.
- **A promotion gate at `resume`.** Resume runs in a fresh context that did not make the decisions. A program's last hop has no resume at all. The gate belongs at write, while the deciding session still holds the context.
- **A manual settled-decision index.** Murmuration's index stopped within two weeks of its last update. Every state surface in this design is generated or gate-checked.
- **Mode flags on `vault` or `conform`.** Backfill plus maintain is a multi-phase workflow with its own checkpoints. It would crowd either skill's contract.
- **Warn-only gates at adoption.** A warning is the failure mode this design exists to remove. The ratchet gives adoption a path without a fail-open period.
- **`records rechain` after a merge** (revision 1). It rewrites digests after the fact, and it cannot repair a `sourceHead` that a squash merge made unreachable. Intake and seal replace it.
- **One move per record path** (revision 1). A misrouted first move would be permanent. A relocation chain replaces it.
- **One relocation commit for the whole legacy tree** (revision 1). One commit that moves 1,157 files cannot be rehearsed or reverted in parts. Waves replace it.
- **Recognizing research from slugs or artifact names.** The murmuration survey showed both fail. An explicit class plus a citation check replaces them.
- **A register line for every record.** It would reach about 17,400 words in murmuration. Evidence stays in history instead.
- **Loading state surfaces by default.** Revision 1's 12,000-word register placeholder would have cost about 16,000 tokens on every turn. The routing card points instead.

## Open items

Closed in revision 2:

- DSN-1 The topic key is defined under "The invariant", with three eval cases.
- DSN-2 Intake and seal replace rechain, and the `basis` rule settles a same-record race. See W2 and the `seal-*` cases.
- DSN-3 The W8 table records reach per host from static evidence. Live-payload cases land in PR 5.
- DSN-6 The Safety section maps each guarantee to a named eval case and PR.

Open:

- DSN-4 The retention proposal waits on the operator. It rests on a survey of 164 murmuration runs · Owner: operator · Done when: the operator accepts or amends "Retention by run class"
- DSN-5 The budget proposal waits on the operator. It rests on measured register, index, and synthesis sizes · Owner: operator · Done when: the operator accepts or amends "State budgets"
- DSN-7 The Grok read tool's name is UNVERIFIED, so the read-notice matcher may miss Grok reads · Owner: agent · Done when: PR 5 records the name from a live Grok payload or drops Grok from the Read matcher
- DSN-8 The skill-to-class mapping for retention defaults lists skills by family, not by name · Owner: agent · Done when: PR 6 lists each skill's default class and lint checks the list is total
