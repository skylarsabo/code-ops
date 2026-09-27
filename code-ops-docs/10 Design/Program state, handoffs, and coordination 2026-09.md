---
type: design
status: draft
updated: 2026-09-27
tags:
  - design
  - vault
  - records
  - handoff
  - coordination
  - operator-output
---

# Program state, handoffs, and coordination 2026-09

This design merges and supersedes two drafts:

- `Docs state and history 2026-09.md`, revision 3 (2026-09-25). It came from a review of the murmuration documentation and a map of the code-ops record, vault, and handoff tooling.
- `Handoff fidelity and session coordination 2026-09.md` (2026-09-27). It came from transcript measurements and six probes of handoff chains, peer sessions, and hook friction.

Both drafts extended the same handoff checker, the same handoff skill, and the same ledger grammar switch. They numbered their checks by hand to avoid a collision, and both minted `DEC-1` onward. One design removes that overlap and sequences one PR stack. It also adds workstream O, operator-facing output, from two operator reports on 2026-09-27.

Verified-at: c204b17 (2026-09-27). Evidence: `80 Runs/2026-09-25-docs-state-history-ho1/reports/`, `80 Runs/2026-09-27-handoff-fidelity-design/reports/`, and `80 Runs/2026-09-27-handoff-fidelity-ho1/reports/`.

## Overview

A long-lived program loses information in four ways:

- **Decisions sink into history.** Every layer that grows is append-only, and every layer that should distill it is manual and unchecked. When volume rises, the manual layers stop, and nothing reports it.
- **Handoff chains decay.** No open item is dropped, but each hop paraphrases, compresses, and carries unchecked pointers. Meaning drifts one hop at a time.
- **Concurrent sessions collide.** Nothing announces a session's branch, claims, or pushes to its peers. Peers pay in rejected pushes, failed pulls, and hand-merged derived files.
- **Operator-facing output misfires.** Commands arrive in bash on a Windows workstation, and replies name work without linking to it.

One model answers the first two. Every store splits into **state**, which is small, current, and mostly generated, and **history**, which is append-only and loaded only through a state link. A vault's state is its decision register and indexes. A program's state is its `PROGRAM.md` ledger, and each `HANDOFF.md` is one hop's history. Text lives once, in state, and history points at it.

The coordination board answers the third, with warnings only. Two doctrine rules and a routing-card line answer the fourth.

The feature ships as a new skill, `code-ops-suite:distill`, a `co program` command family, and changes to the Standard, the record tooling, the vault checker, the handoff lifecycle, and the suite hooks.

## Evidence

Labels follow the user-wide contract. CONFIRMED means executed or directly observed. PROBABLE means two static lines of evidence.

### Handoff decay

Two murmuration chains were traced hop by hop: the console command center chain (22 hops) and the single-tap ledger chain (12 hops).

- No open item was dropped silently. Check 9 of `scripts/check-handoff.mjs` blocks a hop that loses a predecessor item. CONFIRMED.
- Anchor rot. OI-3 kept `Pointer: src/murmuration/control/availability.py:35` from hop 2 to hop 23. The symbol it names moved to `availability_lanes.py`. Check 6 resolves only pointers with an `Anchor:` label (`scripts/check-handoff.mjs:322`), so a bare `Pointer:` is never checked. CONFIRMED.
- Paraphrase drift. Every hop rewrites each item as prose. OI-3 narrowed in meaning, and its owner became ambiguous, with no recorded revision. CONFIRMED.
- Compression. At hop 12 the handoff held 9 items in 74 lines, about 8.2 lines per item. At hop 18 it held 24 items in 87 lines, about 3.6 lines per item. The 8 KB cap is the probable cause. PROBABLE.
- Split gap. The single-tap program split into two programs. Five items (OI-1, 2, 7, 8, 12) moved only through a hand-made `SPLIT-SINGLE-TAP.md`. No ledger or archive names them, so check 9 cannot follow them. CONFIRMED.

### Handoff economics

- The trailing 72 hours were compared with the 72 hours before. Resume overhead fell from 11.8% to 6.8% of chain input. The median predecessor handed off at 292k instead of 209k. Lead mean context per turn rose from 157k to 209k. The share of lead input above 300k rose from 0.5% to 19%. CONFIRMED.
- A replay of the recent window with a handoff at 209k costs 12-15% less price-weighted lead spend, including the overhead of 98 extra handoffs. A sweep put the best point at 200-240k. This is a model, not a measurement.
- The handoff card fired in all 38 sessions that crossed 300k. No session stopped. An autonomous loop drove 17 of them, and operator or peer input drove 16. CONFIRMED.
- One hub session reached 535k while it absorbed peer messages for 12 hours after its assessment. PROBABLE.
- An assessment that chose CONTINUE was followed by a median of 20 more turns. An assessment that wrote a handoff was followed by 11. PROBABLE, because the sample is small.
- A resume spends a median of 13 turns and 36.7k input tokens (p90: 22 turns, 54.6k) before its first real work. Design documents the handoff already summarized are the most common re-reads. CONFIRMED for cost, PROBABLE for cause.

### Session coordination

- 151 sessions produced 235 overlapping same-repo pairs and 507 overlap-hours. CONFIRMED.
- Leads sent about 500 messages to each other, 94% of them in murmuration. Every captured inbound message got a reply or an action. Status updates are the largest class. Explicit file or scope claims are rare. CONFIRMED for counts, PROBABLE for classes.
- Nothing announces a session's branch, claimed files, or recent changes to its peers. The peer guard runs only when a session sends a message. CONFIRMED.
- Collisions:
  - 67 pushes were rejected as non-fast-forward.
  - 7 pulls failed with "local changes would be overwritten". One pair failed 5 seconds apart.
  - 5 merge conflicts hit `DOCS_MANIFEST.json` and an eval runner.
  - Two sessions edited one design document during a 43-hour overlap.
  CONFIRMED.
- The peer guard denied 44 messages to finished sessions. One session was denied 11 times. Two sends failed on names that no longer existed. CONFIRMED.
- The session record store is keyed by the working directory's slug (`sessionRecordPath` in `scripts/transcript-lib.mjs`). A worktree session and a main-checkout session of one repository therefore live in different buckets. CONFIRMED.

### Other friction

- The dispatch guard denied 239 dispatches, and 224 of them were for missing brief fields. Retries took a median of 2 and a maximum of 6. In a byte-compared case, the content was present in prose or on a shared line. `briefHas` requires each label at the start of its own line. CONFIRMED.
- 30 dispatches were denied as wide-surface `general-purpose` dispatches. CONFIRMED.
- Declared round budgets were exceeded often: explorer 45%, `mech` 58%, `implementer` 29%, probe 24%. The implementer carries 83.5% of subagent input tokens. CONFIRMED.
- 16 identical bash-versus-PowerShell quoting errors (`unexpected EOF while looking for matching`) occurred. CONFIRMED.
- The rare dispatch-guard binding denial does not say how to comply. CONFIRMED, n=3.

Not measured: a join of collisions against message traffic, and message delay. Both need a follow-up pass.

### Murmuration documentation

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

### Operator-facing output

- The operator reported on 2026-09-27 that handed commands are usually bash on a Windows workstation, and that agents sometimes name work without linking to it. CONFIRMED as a report.
- No suite rule governs the shell of a command handed to the operator. `CONVENTIONS.md:59` tells the agent to detect the shell and OS and not assume bash, which governs the agent's own commands. CONFIRMED (`80 Runs/2026-09-27-handoff-fidelity-ho1/reports/D-001.md`).
- No hook payload carries the operator's shell. Claude Code, Codex, and Grok payloads carry `cwd` and no shell field. CONFIRMED for Grok and PROBABLE for the others (`reports/D-002.md`). Claude Code does name the shell in the model's environment block, as this session observed.
- The Claude desktop app asks for `bash`-tagged blocks to attach its Run button. A filed issue reports that a `powershell` block's Run button runs bash. PROBABLE, secondary source only.
- Only the handoff resume reply requires links (`plugins/code-ops-suite/skills/handoff/SKILL.md:166`). Section 9 of `CONVENTIONS.md` requires `file:line` citations in artifacts, not links in replies. CONFIRMED.
- 16 identical bash-versus-PowerShell quoting errors occurred in the lead's own tool calls in one week. CONFIRMED.

### This merge

- Both drafts listed `plugins/code-ops-suite/skills/handoff/SKILL.md` and `scripts/check-handoff.mjs` as scope documents. Nothing warned either chain. CONFIRMED.
- Both program ledgers minted `DEC-1` to `DEC-8`. A merge by hand had to renumber 16 imported decisions. CONFIRMED.
- The docs-state design sat on a local-only branch for two days, with its chain's status still reading live. CONFIRMED.
- Resume printed `same-tree: no` at an unchanged HEAD. The only dirty path was the one the handoff itself recorded. `scripts/check-handoff.mjs:369` reports same-tree only on a tree clean apart from the handoff file, and `scripts/handoff-state.mjs:505` prints the flag. CONFIRMED.
- The documented 350k handoff point also sits in `global-contracts/AGENTS.md` and `code-ops-docs/55 Operations/MEASUREMENTS.md`, which H6 did not list. CONFIRMED.
- The docs-state draft said `integrate-branch.mjs` never seals (W2) and also that it runs `records seal` (W6). The two statements contradict. CONFIRMED.

## Operator constraints

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

## Workstream W: docs state

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

Docs-state revision 1 allowed one move per record path. Docs-state revision 2 allowed a chain of per-record moves. Docs-state revision 3 moves whole roots instead, because four path rules would drop a moved record from its collection (see W2). A root may move more than once. Each move folds one prefix swap.

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

So records move only as whole collections. Docs-state revision 2 split one legacy root across several targets, which would drop records from their collection.

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

Docs-state revision 1 answered the fork with `records rechain`, which rewrites events after a merge. Rechain cannot repair an unreachable `sourceHead`. Docs-state revision 2 sealed on the feature branch, which the rules above also refuse. Docs-state revision 3 keeps every branch write off both chains and seals only on the base head:

1. **Intake.** A branch writes the record body to `98 System/Records/intake/<collection>/`, outside the collection root. It adds one line to `98 System/Records/intake.jsonl`, naming the target path. The record id derives from the target path, so it is known at intake. A curation change also goes to intake.
2. **Seal.** `co docs seal` runs on a fresh branch cut from the current base head. In one commit, it moves each intake body to its target path. It also appends the authority batches and curation events, and it clears the sealed intake lines. The batch binds the base head, where the target path has no history. That commit stays reachable after any merge strategy, because it sits on the base branch.
3. **Serial seals.** Two seal branches bind the same base head, so the second fails `baseBindings` after the first merges. The seal holds nothing else, so the fix is to discard it and seal again from the new head. `distill maintain` and a post-merge step run seals. `integrate-branch.mjs` never seals, because a feature branch cannot.
4. **Render.** The register and `state.json` read sealed state plus intake, and they mark intake lines `pending seal`.
5. **Age.** The gate fails an intake line that stays unsealed on the base branch past 14 days. That line enters the ratchet like any other violation.

`records curate` writes the chain directly today (`scripts/records.mjs:1767`). Under a v3 manifest it refuses to run off the base head and routes the change to intake.

**Typed events.** The ledger validator requires a `state` object on every event (`scripts/record-lib.mjs:1258`), and the fold keeps the last `state` per record (`:1270`). A root relocation event therefore carries `type: relocate-root`, and the validator checks its own fields instead of `state`. The fold skips every type other than `curate`, so a relocation never overwrites a status.

**Two branches curate one record** (docs-state DSN-2, closed). Each curation intake line names a `basis`: the per-record head digest it saw, or the id of an earlier intake line for the same record. The ledger already keeps that head as `previousRecordEventDigest`. The seal applies intake in file order. It refuses a line whose recorded head no longer matches and names both lines. A session that reads both writes one resolving intake line. Last-event-wins folding (`scripts/record-lib.mjs:1268`) would otherwise drop one branch's change without a trace.

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

**Preconditions.** `apply` refuses a dirty tree and a base older than the plan. Docs-state revision 1 also refused while any handoff was unconsumed. A repository with live programs rarely meets that, and murmuration had two. It is no longer needed, because apply leaves handoff bytes alone.

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

### W6. One gate, installed

A new command, `co docs gate`, runs every docs check in order:

1. `docs-manifest check`
2. `records check` and `verify-history` for each collection, and the intake age rule
3. `check-vault-standard`
4. Register freshness, the invariant, and state budgets
5. Draft and staleness rules
6. Legacy-path guards
7. The tracked-run set against `runs.tracking` and each run's retention class
8. Ledger checks 11 to 18 over every open program tracked on the current branch. An untracked ledger gets check 14 as an UNLANDED warning only, so a promotion on one branch never blocks commits on another

**Ratchet.** On first adoption, the gate writes `98 System/GATE_BASELINE.jsonl` with every existing violation, one per line. Later runs fail on any violation not in the baseline. A fixed violation leaves the baseline at the next run, and the baseline never grows. This follows the repository rule that no gate turns fail-open.

**Installation.** `conform` installs the gate into the adopting repository: one CI step and one pre-commit entry. It also adds the pointer lines to `AGENTS.md`. `integrate-branch.mjs` gains a docs step that renders the register and indexes and runs the gate. It never seals, because a feature branch cannot (W2).

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

**Reach per host** (docs-state DSN-3, closed). The table comes from the host coverage table at `code-ops-docs/50 Platform/INFRASTRUCTURE.md:197` and the adapter code. It is static evidence. PR 12 adds live-payload eval cases per host.

| Mechanism | Claude | Grok | Codex | OpenCode |
| --- | --- | --- | --- | --- |
| Read notice | Reaches: native PostToolUse context | Probable: a PostToolUse note reaches, as the handoff card shows. The read tool's name is UNVERIFIED | Probable: the renderer drops Claude-only matchers, and the payload adapter filters the tool. Codex reads through its shell tool, so the shell path must be extracted | Reaches: `tool.execute.after` appends to the tool output (`scripts/opencode-lifecycle.js:1313`) |
| Write deny under a removed root | Reaches: PreToolUse | Reaches: canonical command hook | Reaches: payload-adapted hook | Reaches: `tool.execute.before` port |
| Routing-card line | Reaches | No: passive stdout is unavailable, so the `AGENTS.md` pointer carries it | Reaches: projected session context | Reaches: system transform |

## Workstream L: program ledger, grammar 2

This workstream merges W5 of the docs-state draft with H1 to H5 of the handoff-fidelity draft. `PROGRAM.md` is a program's state layer, and each `HANDOFF.md` is one hop's history. The ledger holds each decision's and each open item's text once. A handoff lists ids and one clause of change.

Every rule here applies only to a `PROGRAM.md` that declares `Grammar: 2`. One switch covers decisions and open items, so no second grammar version exists. A new program starts at grammar 2 only under a v3 manifest (DEC-23). In-flight programs stay resumable.

### L1. Ledger grammar

A grammar-2 `PROGRAM.md` has six sections: Program goal, Request history, Scope documents, Open items, Decisions ledger, and Closed items. Open items is new. The 32 KB cap stays.

An open item keeps today's line and adds a required anchor:

```
- [ ] OI-7 PR 6 is not started · Owner: agent · Done when: gates pass with warn-only cases · Pointer: `scripts/check-handoff.mjs:322` · Anchor: `if (!labelled) continue;`
```

- An item whose `Owner:` or `Done when:` changes carries `Revised: hop <n> · <reason>`.
- `TASKS.md` stays the run's working checklist. `run open` and `handoff resume` seed it from the ledger's Open items. `handoff draft` writes each change back to the ledger.

A decision carries a stable id, its hop, and a disposition:

```
- DEC-14 2026-09-25 The register splits by topic past its word budget · Rejected: one file with anchors · Hop: 3 · Disposition: pending
```

- `DEC-<n>` and `OI-<n>` are unique within a program, across the ledger and its archive. Check 18 enforces this.
- `Disposition:` is one of `pending`, `local`, `dropped`, or `promoted:<record id>`. `local` binds only this program. `dropped` means a later decision in the program replaced it.
- Superseded entries stay. A superseding entry names the id it replaces.
- An entry imported by a merge carries `Was: <program>/<id>`.

### L2. Checks added to `check-handoff.mjs`

| Check | Rule | Source | Mirrors |
| --- | --- | --- | --- |
| 11. Decision ids | Every Decisions-ledger bullet carries a `DEC-<n>` id, a `Hop:`, and a `Disposition:` | W5 | Check 4 for open items |
| 12. Disposition age | An entry made at a hop before the current `Hop:` must not be `pending` | W5 | New. One hop of grace |
| 13. Decision carry-forward | Every `DEC` id in the predecessor's `## Decisions made` appears in the ledger, its archive, or a `Was:` trail | W5 | Check 9 |
| 14. Promotion resolves | Every `promoted:<id>` resolves in `state.json` or in intake on the working tree | W5 | Check 9 for scope documents |
| 15. Handoff points, not copies | Each `## Decisions made` and `## Open items` bullet in `HANDOFF.md` leads with its id. A decision adds at most one clause. An active open item keeps its full line, and a carried one shows id and title | W5, H2 | New |
| 16. Every pointer anchored | Every `Pointer:` in the ledger's Open items and in the handoff carries an `Anchor:` | H1 | Check 6 |
| 17. Revisions recorded | An item whose `Owner:` or `Done when:` differs from the predecessor's carries `Revised:` | H2 | New |
| 18. Ids unique | No `DEC` or `OI` id appears twice across the ledger and its archive | New | Check 4 |

Check 16 also ships early as a warning for grammar-1 ledgers. It warns rather than fails there, because existing chains carry bare pointers.

Under grammar 2, check 4 reads `Owner:` and `Done when:` for a carried item from the ledger, because the handoff shows only its id and title.

Check 18 is the mechanical backstop for id uniqueness. The docs-state draft relied on the peer guard allowing one live head per program. The peer guard cannot see a session in another worktree until C1 rekeys the session store.

A promoted record lands only when its branch merges. So check 14 reads the working tree, and resume reports a missing id as UNLANDED, a warning. `co program close` requires every promoted id sealed on the base branch.

### L3. Write

- `co handoff draft` fills `Anchor:` from the cited line for each pointer it writes. The anchor rule costs the writer nothing.
- The draft sorts open items into two tiers. Active items were touched this hop and keep full detail. Carried items show id and title, with the full text in the ledger. The 8 KB cap then bounds active detail only.
- The draft lists every `pending` decision from an earlier hop as a `[FILL: disposition]` line. The unfilled skeleton fails the check by design. A decision made this hop may stay `pending` for one hop.
- The handoff skill's Write section today says each decision carries "its reason and the options rejected". The grammar-2 PR changes that sentence and its eval in the same commit.

`co decide promote DEC-<n> --program <slug>` promotes a decision in one step:

1. It writes a record file and its intake line to the `decisions` collection, with `decides`, `topic`, `key`, `kind: decision`, and a `source` naming the program and hop.
2. It writes the curation intake line.
3. It sets the ledger disposition to `promoted:<record id>`.
4. It renders the register.

One command writes all four, so the ledger and the register cannot disagree. The seal runs later, on the base branch, as W2 describes. The Write section of the handoff skill gains one sentence routing to this command.

### L4. Resume

- **Same tree.** Resume reports `same-tree: yes` when HEAD equals `Verified-at` and the dirty set equals the handoff's recorded dirty paths. Today it requires a tree clean apart from the handoff file (`scripts/check-handoff.mjs:369`, printed at `scripts/handoff-state.mjs:505`), which sends an unchanged resume through a full re-read.
- **Scope digests.** The handoff records, per scope document, a content hash and a one-paragraph digest with `Verified-at:`. Resume skips an unchanged document and flags a changed one for re-reading. Target: the median resume cost falls from 36.7k to under 25k input tokens.
- **Re-anchoring.** Resume re-resolves every carried pointer. A MOVED anchor is rewritten to its new line in the successor's draft. A DRIFTED or GONE anchor becomes `[FILL: re-anchor or disposition]`, so the next hop cannot carry it silently.
- **Forwarding.** A scope-document path or anchor that misses on the tree falls back to `FORWARDING.json`. A forwarded hit reports MOVED, which warns, not GONE, which fails.
- **Pending decisions.** The summary counts pending decisions from earlier hops. Check 12 makes this zero on a valid handoff.
- **Register drift.** Each `promoted:` id whose status became `superseded` or `amended` since the predecessor is reported DRIFTED. Another program changed a rule this one relies on, so resume surfaces it as a contradiction.
- **Program overlap.** Resume lists other live programs whose scope documents intersect this one (C6).

### L5. Program lifecycle: `co program`

Program-level commands move under `co program`, because they act on a program and not on one hop. `co handoff` keeps the per-hop verbs: `draft`, `check`, `resume`, and `live`.

- **`archive`.** It moves closed items, and decisions whose disposition is not `pending`, to `programs/<slug>/PROGRAM.archive.md`. That sibling holds only the Decisions ledger and Closed items headings. It refuses a `pending` decision, so size management never buries an unsettled one. Checks 13, 14, and 18 read both files. It replaces the unstandardized `CLOSED-ARCHIVE.md` files in murmuration programs.
- **`split <slug> --into <a>,<b>`.** It writes a grammar-2 ledger per child. It assigns each open item and each pending decision to exactly one child as `Forwarded-to: <child>/<id>`, and it refuses while any is unassigned. Check 9 follows `Forwarded-to:`. It replaces sidecar files such as `SPLIT-SINGLE-TAP.md`.
- **`merge <from> --into <to>`.** It is the inverse of split. It appends the source's requests to the target's Request history with a source tag, and adds its scope documents. It gives each imported open item and decision the next free id with `Was: <from>/<id>`. It marks the source ledger `Status: merged into <to>` and each source item `Forwarded-to:`. It refuses while the source's live head session is running, unless the operator passes `--head-ended`. Checks 9 and 13 follow `Was:`.
- **`close <slug>`.** Preconditions: no `pending` decision, no open item except those forwarded to a named successor with `Owner: operator`, and no unconsumed handoff in the chain. It writes `programs/<slug>/CLOSEOUT.md` with goal, outcome, revision range, each promoted decision linked to its register line, and counts of closed items and local decisions. It adds `Status: closed` under the goal, and it updates `80 Runs/INDEX.md`.

After a close or a merge, `co handoff live` reports the program's status and names the merge target. The routing card stops advertising its handoffs.

### L6. Parallel sessions and branches

| Surface | Conflict risk | Resolution |
| --- | --- | --- |
| Native record files | None. Each record is one file with a path-derived id | None needed |
| Authority batches and curation ledger | Both chains fork, and a branch `sourceHead` dies in a squash merge | Branches write intake only. The seal runs against the base branch. CI runs `verify-history` strictly |
| Intake files | Two branches append lines | `merge=union`. Order is file order, and the seal's `basis` check catches a same-record race |
| Sealed files | Two branches seal the same base intake | The seal is deterministic, so a conflict resolves by taking the base copy and sealing again. C3 warns a second sealer before it starts |
| Register, indexes, `state.json`, `DOCS_MANIFEST.json` | Both branches regenerate them | Derived files. Never hand-merged. The merge driver (C5) and the pre-commit hook regenerate them |
| Ratchet baseline | Both branches shrink it | One sorted violation per line. CI fails a baseline line that is not a live violation or not in the merge-base baseline |
| `DEC` and `OI` ids | Two sessions of one program in different worktrees | Check 18 fails a duplicate. C1 makes the peer guard see worktree sessions |
| Conflicting rules from two programs | Both promote a rule on the same topic key | Invariant clause 4 fails the gate. The second promoter adds `supersedes` or `amends` |
| Two programs on one scope document | Both plan changes to one file | C6 warns at run open and resume. `co program merge` joins them when the operator chooses |

## Workstream H: handoff point

### H6. Handoff point and follow-through

- Move the documented handoff point from about 350k to about 225k (DEC-3). The 150k card bands stay.
- Every copy of the rule changes in one commit: `plugins/code-ops-suite/skills/handoff/SKILL.md:73`, `global-contracts/AGENTS.md`, and the PR #184 savings paragraph at `code-ops-docs/55 Operations/MEASUREMENTS.md:340`. `node scripts/sync-global.mjs` then refreshes the machine's global contract. CHANGELOG history stays as written.
- The dispatch guard's 300k ceiling stays. It now sits past the handoff point, so it forces an assessment on a session that chose CONTINUE and overran.
- When no operator prompt has arrived since the last card, the session runs autonomously. There the card at the handoff point says to write the handoff at the next boundary, instead of assessing again.
- An assessment that returns CONTINUE past the handoff point records a `Continue-until:` bound, in turns or in context. The card fires again past it.
- Hub sessions: peers post status to the board (C3) instead of messaging the hub (DEC-6). Messages carry requests, warnings, and handovers.

## Workstream C: session coordination

All state stays on the local machine under `<home>/.claude/code-ops/`. Nothing adds network traffic. Records hold names, branches, and repo-relative paths only. The hooks follow the suite's fail-open, bounded-read pattern and have off switches.

### C1. A repo-keyed presence board

- Key the board by the repository, not the working directory. A worktree's `.git` file names its common directory, so one file read maps a worktree to its repository without spawning git.
- Store one record per live session: name, host session id, branch, worktree, run folder, claimed paths, recent edits with timestamps, a one-line task, and a heartbeat.
- The existing hooks write it: `handoff-state.mjs` on run open and resume, the PostToolUse edit hook for recent edits, and SessionEnd to mark the record ended. A record without a heartbeat for 30 minutes counts as idle.
- `co board` lists the board. `co board claim <paths>` and `co board release` record explicit claims. A resume claims the program's scope documents automatically.
- Migrate the session record store to the same repository key, so `co handoff live` and the peer guard see worktree sessions too.

### C2. Collision warnings (warn only)

- PreToolUse on edit tools: when another live session claimed the path or edited it within the last 6 hours, add context that names the peer and gives a ready `SendMessage` line. The hook fires once per path, per peer, per session, and it never blocks.
- PreToolUse on `git pull`, `merge`, `rebase`, and `push`: list the live peers on the same branch, and their recent edits that overlap this session's dirty files.

### C3. Change feed

- PostToolUse on `git push`, `gh pr merge`, and edits to shared hub files (`DOCS_MANIFEST.json`, `PROGRAM.md`) appends an event: repository, branch, commit, session name, and changed paths.
- At its next prompt or tool call, each peer gets one line per new event, such as "main moved to <sha> by <name>; it touched files you edited". The line is limited to events that intersect the peer's branch or its edits. This targets the 67 rejected pushes and the stale pulls.
- Status posts (H6) go to the same feed, so they reach a peer only when the peer reads the board.
- `co docs seal` posts a seal event to the feed when it starts and when it lands. A session that starts a seal on the same base head gets a warning first. The second seal would fail `baseBindings` anyway, so the warning saves the wasted work.

### C4. Redirect stale messages

- When the peer guard finds that the target has handed off to a live head, it rewrites the message's target to that head and adds a notice. It no longer denies (DEC-4).
- The rewrite uses PreToolUse input modification, which the digest hook already relies on:
  - Claude Code and Codex document `hookSpecificOutput.updatedInput`. CONFIRMED from primary docs (`80 Runs/2026-09-27-handoff-fidelity-ho1/reports/D-002.md`).
  - Installed Grok 1.0.13 accepts the same shape (`code-ops-docs/35 Contracts and Data/CONTRACTS.md:450`). PROBABLE: the record is contract prose, not a payload run, although Grok's public hooks page shows only a deny decision.
  - The OpenCode port assigns `output.args` from `updatedInput` (`scripts/build-opencode-dist.mjs:448`). A filed issue reports that OpenCode ignores the mutation for its bash tool. If that holds, the digest port is affected too, so DSN-2 covers both.
  - A host whose live-payload eval fails keeps today's deny.
- A filed Claude Code issue reports that hooks sometimes miss subagent tool calls. The peer guard therefore stays a lead-side guard, and nothing relies on it firing inside a subagent.

### C5. Derived-file conflicts

- `DOCS_MANIFEST.json`, the register, the indexes, `state.json`, and host distributions are regenerated, never hand-merged.
- `install-git-hooks.mjs` registers a merge driver that takes either side and regenerates the file, plus `merge=union` for intake files (DEC-5). This is repository-local git configuration.
- `conform` installs the same driver and attributes in an adopting repository, beside the docs gate (W6). The docs-state draft covered derived files with the pre-commit hook only, which does not run during a merge.

### C6. Program overlap warning

- At `run open` and `handoff resume`, the board compares this program's scope documents with those of every other live program in the repository. Each shared path produces one warning line that names the other program, its live head, and the path.
- The warning suggests `co program merge` when the overlap is more than one path. It never blocks (DEC-2).
- This merge is the motivating case. Both chains claimed the handoff skill and the checker, and neither learned of the other.

## Workstream U: friction fixes

- **U1. Brief skeleton.** A brief-field denial prints a ready skeleton of the missing labels, one per line, for the exact agent type. `co brief <agent>` prints the full template, and the routing card names that command. Label parsing stays strict (DEC-7). Only the message improves.
- **U2. Binding denial.** The binding and counter denial states the mechanical fix, as the other denials do.
- **U3. Push sync.** The ship skill's push step runs fetch, rebase, and push, and retries once on a non-fast-forward rejection. With C3, this targets the 67 rejections.
- **U4. Round-budget checkpoint.** At 1x the declared budget, the subagent receives a context line telling it to checkpoint to its report path and return. The hard stop moves from 2x to 1.5x. This tightens a gate and weakens none.

U5 of the handoff-fidelity draft moved to O3.

## Workstream O: operator-facing output

### O1. Commands match the operator's shell

- **Rule.** A command handed to the operator runs in the operator's shell. On Windows, that shell is PowerShell unless the operator names another.
- **Neutral first.** Prefer a command that runs unchanged in PowerShell 5.1, PowerShell 7, and bash, such as `node scripts/lint-plugins.mjs`. Most suite commands are already neutral.
- **PowerShell form.** When a command needs shell syntax, give a `powershell` block that PowerShell 5.1 accepts: `;` or separate lines instead of `&&`, `$env:NAME` instead of `export`, `Remove-Item` instead of `rm`, and double quotes around paths with spaces. Give a bash variant only when the operator also uses a POSIX shell.
- **Detection.** No hook payload carries the shell, and only Claude Code names it to the model. The SessionStart routing card therefore adds one line on the other hosts, such as `operator shell: PowerShell (win32)`. It derives the value from `process.platform`, and `CODE_OPS_OPERATOR_SHELL` overrides it. The line costs about 15 tokens. On Grok, where passive stdout is unavailable, the doctrine rule is the floor.
- **Doctrine.** Section 4 of `CONVENTIONS.md` gains the rule beside `Detect the shell and OS.`, and the global contract gains one sentence. The section-4 text is not a pinned passage, so each plugin's copy changes on its own.
- **Run button.** The Claude desktop app asks for `bash` blocks to attach its Run button, and a filed issue reports that a `powershell` block's Run button runs bash. A neutral command runs correctly either way. A PowerShell-only command is copied into the terminal. DSN-9 settles the button's behavior with a live check.

### O2. Replies link what they cite

- **Rule.** A reply to the operator links every repository file, run folder, open-item pointer, and PR it names. A file is `[name](repo-relative/path:line)`, and a PR is its full URL. A bare `#123` is never enough.
- **Scope.** The rule binds replies, including each skill's final report. Artifacts keep backticked `file:line` citations with anchors (section 9), because the checkers parse them.
- **Doctrine.** The rule becomes a new pinned passage in all four `CONVENTIONS.md` files through `SHARED_PASSAGES`, mirrored in `PINNED_TEXTS`. The global contract gains one sentence.
- **Scripts.** A script whose output the lead relays prints a `links:` block, as `co handoff resume` does today. The first set is `co handoff draft`, `co run open`, and `integrate-branch.mjs`. The PR confirms the list from their current output.

### O3. Shell trap in the lead's own calls

- A routing-card line on Windows tells the lead to write a multi-line script to a file, and never to nest quotes in `node -e` inside bash. This targets the 16 quoting errors. It was U5.

## Cross-cutting: hook cost

W8's read notice, C2, and C3 add behavior to the most frequent tool events. Each hook process adds startup latency to every matching tool call.

- A new behavior joins an existing hook entry for its event, instead of adding a process.
- The p50 and p95 added latency per tool call is measured before the first of these PRs and after each one. A regression above 50 ms at p95 blocks that PR until it is fixed or the operator accepts it.
- Every new hook keeps the suite pattern: fail open, bounded reads, local files only, and an off switch.

## Retention by run class

A project-wide profile is too coarse for a repository that mixes research with routine work. Murmuration runs include research evidence the operator calls extremely important, beside build and cleanup runs. So retention is set per run, and the project profile supplies only the default.

This section is a proposal built from a survey of 164 murmuration run folders (DSN-4). It waits on operator acceptance.

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

Under `ignored`, `evidence` never means "track". Code-ops ignores `80 Runs/` by ADR 0001, and its calibration runs hold private-repo detail under the one-way channel rule. Docs-state revision 1 would have committed them.

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

1. **Nothing changes in an adopter until it opts in.** A code-ops upgrade adds commands and checks, but an adopting repository sees no new docs gate until `conform` installs it there. Hook and dispatch-guard changes (U4, C4, H6) apply at upgrade, as suite hook changes do today, each under its existing off switch.
2. **In-flight programs stay resumable.** Ledger checks 11 to 18 apply only to a `PROGRAM.md` that declares `Grammar: 2`. A new program starts at grammar 2 only where the manifest is v3. Docs-state revision 1 started every new program there, which would have added checks in a repository that never opted in.
3. **Every mutating command plans first.** `relocate`, `backfill`, and the `co program` commands each have a plan mode that writes only to the run folder. The operator reviews the plan before `apply`.
4. **Each apply wave is one revertable commit.** `git revert` of that commit restores the prior tree while no later commit depends on it. A wave therefore lands alone.
5. **Nothing is deleted.** Relocation moves files. Archiving moves entries. Untracking a committed run follows the rule in the retention section.
6. **The adopter's own tests gate a relocation.** Each wave passes the repository's test suite in a rehearsal worktree before it lands, because code reads some moved files at runtime.
7. **Old citations keep resolving.** `FORWARDING.json` answers every old path in record bytes, run folders, ledgers, handoffs, and git history.
8. **Agents learn the new layout from the session start.** The routing-card line, the `AGENTS.md` pointer, and the read notice each point at the register. Reach differs by host, as the W8 table shows. On every host, the `AGENTS.md` pointer is the floor.
9. **Coordination never blocks.** Collision, overlap, and seal warnings add context and never deny (DEC-2).
10. **Coordination state stays local.** The board and feed live under `<home>/.claude/code-ops/` and hold names, branches, and repo-relative paths only. Nothing adds network traffic (DEC-8).
11. **Hooks fail open and stay cheap.** A missing or corrupt board file produces no output, and the hook-cost limit above binds each hook PR.

Each guarantee has a named eval case that must pass before the PR that could break it merges. PR numbers refer to the Delivery table below.

| Guarantee | Eval case | Suite | PR |
| --- | --- | --- | --- |
| 1 | `upgrade-without-conform-adds-no-failure`: a v2-manifest fixture passes the old and new gate chains alike | `evals/docs-manifest` | 9 |
| 2 | `grammar1-ledger-resumes-unchanged`: the existing ledger fixtures pass checks 1 to 10, skip 11 to 15, 17, and 18, and warn on 16; a new program under a v2 manifest opens at grammar 1 | `evals/handoff-check` | 6 |
| 3 | `plan-writes-run-folder-only`: after each plan mode, `git status` shows changes only under the run folder | new `evals/docs-relocate`, `evals/handoff-check` | 12, 6, 7, 8, 13 |
| 4 | `apply-wave-revert-restores-tree`: the tree hash after `git revert` equals the hash before apply | `evals/docs-relocate` | 12 |
| 5 | `apply-preserves-every-blob`; `archive-moves-not-deletes`; `merge-forwards-every-item` | `evals/docs-relocate`, `evals/handoff-check` | 12, 6, 7 |
| 6 | `apply-refuses-failing-tests`: a fixture test reads a moved manifest, and apply stops in rehearsal when it fails | `evals/docs-relocate` | 12 |
| 7 | `forwarding-resolves-record-citation` and `handoff-anchor-forwarded-reports-moved` | `evals/docs-relocate`, `evals/handoff-check` | 12, 8 |
| 8 | `routing-card-register-line` and `read-notice-superseded-record`, the second with Claude and OpenCode payload shapes | hook evals | 13, 12 |
| 9 | `collision-warns-never-denies` and `overlap-warns-never-denies` | hook evals | 11 |
| 10 | `board-writes-home-only`: every board write lands under the home directory and holds no absolute repo path | hook evals | 10 |
| 11 | `board-corrupt-fails-open`, plus the latency measurement | hook evals | 10, 11 |

The record mechanisms add these cases:

- `seal-two-branch-disjoint`: two branches promote different records, and the merged seal verifies.
- `seal-two-branch-same-record`: both branches curate one record, and the seal refuses with both lines named.
- `seal-after-squash-merge`: the sealed `sourceHead` stays reachable after a squash merge.
- `relocate-root-keeps-record-id`: every record in a moved collection keeps its id and passes `check` and `verify-history`.
- `seal-refuses-feature-branch`: `co docs seal` refuses a HEAD that is not the base head.
- `curate-routes-to-intake`: `records curate` off the base head writes intake, never the chain.
- `invariant-key-collision`, `invariant-key-superseded`, and `invariant-key-unknown-domain` cover clause 4.
- `retention-cited-working-run-fails` and `retention-ignored-evidence-not-tracked` cover the retention rules.

The two-branch cases need a fixture that `evals/record-collections` does not build today. That suite already builds a temporary git repository, so it gains a second branch.

The ledger and output workstreams add these cases:

- `same-tree-recorded-dirty-set`: a resume at the recorded HEAD with the recorded dirty paths reports `same-tree: yes`, and one extra dirty path reports no.
- `check16-bare-pointer`, `check17-unrecorded-revision`, and `check18-duplicate-id`, each failing under grammar 2 and passing or warning under grammar 1.
- `split-refuses-unassigned` and `merge-renumbers-with-was`: a merge of two ledgers that both hold `DEC-1` yields unique ids and a full `Was:` trail.
- `overlap-shared-scope-document`: two live programs with one shared scope document produce one warning line each.
- `routing-card-operator-shell`: the card names PowerShell on a win32 payload, bash on linux, and the override value when set.


## Murmuration adoption

The adoption is a calibration of the feature, not a separate project.

1. Run `distill backfill` assess-only through the `calibration-run` skill. Only the sanitized note returns to code-ops.
2. Run `backfill` for real. The measured scale is 435 adopted records in 5 collections, 219 drafts, and 136 decisions in 4 program ledgers and 1 overflow file. It also covers 1,157 files under `docs/`. Live handoffs no longer block relocation, because apply leaves ledgers and handoffs alone.
3. Keep the `tracked` profile, as the retention section recommends. The operator confirms this at the checkpoint.

The move rewrites about 930 references in 327 code files, in two waves: `docs/audit`, then `docs/preliminary`. Each wave passes the repository's test suite in rehearsal, because some references are runtime reads of machine manifests.

## Delivery

One stack replaces the two 7-PR stacks. PR numbers are new. Each PR bumps `code-ops-suite`, regenerates host distributions, and carries its own eval cases. `co docs gate` grows by PR: PR 9 ships steps 1 to 5 and 8, PR 12 adds step 6, and PR 13 adds step 7.

| PR | Content | Risk surface | Depends on |
| --- | --- | --- | --- |
| 1 | O1, O2, O3, U1, U2, and the check-16 warning | Doctrine prose, pinned passage, gate messages, routing card | None |
| 2 | L4 same-tree fix and scope digests | Handoff resume | None |
| 3 | H6 handoff point, global contract, card follow-through, `Continue-until:` | Hook behavior, global contract | DSN-3 pre-registration |
| 4 | W1: Standard v5, manifest v3, decision note D-004 | Public contract | None |
| 5 | W2: record fields, status set, `amends`, typed events, identity through moves, intake and seal, register rendering, and the `FORWARDING.json` schema | Record chains | 4 |
| 6 | L1, L2 checks 11 to 13 and 15 to 18 plus the check-4 change for carried items, L3 draft changes, `co program archive` | Handoff contract | 1, 4 |
| 7 | L5 `co program split` and `merge` | Handoff contract | 6 |
| 8 | L3 `co decide promote`, check 14, L4 forwarding and register drift, L5 `co program close` | Handoff contract, records | 5, 6 |
| 9 | W4 vault rules, generalized staleness, W6 `co docs gate` steps 1 to 5 and 8, and the ratchet | Gates | 4, 5, 6, 8 |
| 10 | C1 board and session-store rekey, C4 redirect on each host whose live-payload eval passes | Hooks, public contract | None |
| 11 | C2 warnings, C3 feed and seal events, C6 overlap warning, hook-cost measurement | Hooks | 5, 7, 10 |
| 12 | W3 `co docs relocate`, the legacy-path hook, W8 read notice, gate step 6 | Hooks, file moves | 5, 9 |
| 13 | W7 `distill`, retention classes with gate step 7, C5 merge driver in code-ops and through `conform`, routing-card register line, `integrate-branch` docs step | Skills, adopter install, git configuration | 8, 9, 12 |
| 14 | U3 push sync, U4 round-budget checkpoint | Ship skill, dispatch guard | None |

Phases:

- **A. Quick wins:** PRs 1 to 3 and 14. They need no new data model and address the most frequent friction.
- **B. Foundations:** PRs 4, 5, 6, and 10. PR 10 proceeds in parallel with the chain 4, 5, 6, on disjoint files.
- **C. Lifecycle and gate:** PRs 7, 8, 9, and 11.
- **D. Adoption surface:** PRs 12 and 13.
- **E. Murmuration adoption,** as a calibration run.

PRs 5, 6, 8, 10, 11, and 12 touch public contracts, record chains, or hooks. The operator decides at each checkpoint whether `code-ops-suite:local-review-gate` runs on them.

**Evals.** A new fixture repository holds planted buried decisions:

- A promoted draft still marked `draft`.
- An amended record with no forward link.
- A program decision with no durable home.
- A stale synthesis page.
- A legacy `docs/` tree with code references.

Its answer key scores `distill backfill`. PR 13 adds it.

## Measurements to pre-register

Record these in `MEASUREMENTS.md` before the named PR lands. Re-measure with the same 72-hour window method one week after it lands.

| Measure | Baseline | Expected | PR |
| --- | --- | --- | --- |
| Price-weighted lead cost per turn, and the share of lead input above 300k | 209k mean context; 19% above 300k | Both fall | 3 |
| Median resume cost to first real work | 36.7k input tokens, 13 turns | Under 25k | 2 |
| Brief-field denials per 100 dispatches | 224 of 239 denials | Under a third of today's rate | 1 |
| Share of Windows-session operator command blocks with POSIX-only syntax | To measure from transcripts | Under 10% | 1 |
| Share of repo paths and PR numbers named in final replies without a link | To measure from transcripts | Under 10% | 1 |
| Non-fast-forward push rejections and merge conflicts per overlap-hour | 67 rejections, 5 conflicts | A fall | 11, 13, 14 |
| Added hook latency per tool call, p50 and p95 | To measure | Under 50 ms at p95 | 11, 12 |

## What changed from the source drafts

To the docs-state draft:

- One grammar switch covers decisions and open items. Its checks 11 to 15 and the handoff draft's 16 and 17 form one table, and check 18 is added.
- Id uniqueness no longer rests on the peer guard, which cannot see worktree sessions. Check 18 enforces it, and C1 fixes the blind spot.
- Check 15 covers open items as well as decisions, so the handoff never copies either.
- `integrate-branch.mjs` renders and gates but never seals. This removes the W2 and W6 contradiction.
- The merge driver and union attribute reach adopters through `conform`, because a pre-commit hook does not run during a merge.
- The delivery table fixes dependencies the docs-state stack inherited: the gate grows by PR, retention has a PR, and `close` lands with promotion.
- Program commands group under `co program`, and `merge` joins `split`, `archive`, and `close`.
- Serial seals announce themselves on the feed, so a second sealer learns before it starts.

To the handoff-fidelity draft:

- Resume counts a tree with only the recorded dirty paths as the same tree.
- H6 names every copy of the handoff-point rule, including the global contract.
- C4 cites the in-tree evidence for Grok and OpenCode input rewrite, and a live-payload eval settles each host.
- C6 warns when two live programs share a scope document.
- `co program merge` handles the inverse of a split, with a `Was:` trail.
- U5 widened into workstream O, which covers operator commands and reply links.
- New hook behavior carries a latency budget.

## Crosswalk

| Source item | Here |
| --- | --- |
| Docs-state W1 to W4, W6 to W8 | W1 to W4, W6 to W8 |
| Docs-state W5 grammar, checks, write, resume, overflow, close, parallel sessions | L1, L2, L3, L4, L5, L5, L6 |
| Handoff-fidelity H1 | L2 check 16, L3, L4 |
| Handoff-fidelity H2, H3 | L1 and L2 check 17, L3 |
| Handoff-fidelity H4, H5 | L5 split, L4 |
| Handoff-fidelity H6, C1 to C5, U1 to U4 | H6, C1 to C5, U1 to U4 |
| Handoff-fidelity U5 | O3 |
| Docs-state decisions DEC-1 to DEC-16 | Program ledger DEC-9 to DEC-24, each with `Was:` |
| Handoff-fidelity DSN-1 to DSN-3 | DSN-1 to DSN-3 |
| Docs-state DSN-4, DSN-5, DSN-7, DSN-8 | Same ids |
| Docs-state DSN-1, DSN-2, DSN-3, DSN-6 | Closed in its revision 2 |

## Operator decisions

The operator accepted every recommendation of the docs-state review on 2026-09-25, and D-1 to D-4 of the handoff-fidelity design on 2026-09-27:

- D-1 The handoff point moves from about 350k to about 225k.
- D-2 A message to a session that handed off is rewritten to its live head. A host without input modification keeps the deny.
- D-3 `install-git-hooks.mjs` registers the derived-file merge driver in each checkout.
- D-4 Status updates go to the board. Messages carry only requests, warnings, and handovers.

On 2026-09-27 the operator asked to combine the two programs and improve each, to receive PowerShell commands on Windows, and to have every reference linked. Collision handling stays "Warn only (Recommended)".

## Rejected alternatives

- **Logical unification, keeping `docs/` on disk.** Rejected by the operator. Agents inevitably read the old tree, and nothing on disk tells them a record is superseded.
- **A physical move without a relocation event.** It breaks `verify-history`, and the move itself leaves no audit trail.
- **Rewriting citations inside record bytes.** It violates write-once evidence. Forwarding resolves those citations instead.
- **A promotion gate at `resume`.** Resume runs in a fresh context that did not make the decisions, and a last hop has no resume.
- **A manual settled-decision index.** Murmuration's index stopped within two weeks. Every state surface here is generated or gate-checked.
- **Mode flags on `vault` or `conform`.** Backfill plus maintain is a multi-phase workflow with its own checkpoints.
- **Warn-only docs gates at adoption.** A warning is the failure this design removes. The ratchet gives adoption a path without a fail-open period.
- **`records rechain` after a merge.** It cannot repair a `sourceHead` that a squash merge made unreachable. Intake and seal replace it.
- **Per-record moves, once or chained.** Collection membership and path-profiled history would drop a moved record. Root relocation replaces them.
- **One relocation commit for the whole legacy tree.** It cannot be rehearsed or reverted in parts. Waves replace it.
- **Recognizing research from slugs or artifact names.** The murmuration survey showed both fail.
- **A register line for every record, or loading state by default.** Either would cost thousands of tokens per read or per turn.
- **Accepting brief labels mid-line.** It loosens a gate's parsing. The U1 skeleton fixes the friction instead.
- **Blocking edits on collision.** The operator chose warn only, and a block can stall an autonomous run.
- **A shared network service for the board.** Local files cover one machine and add no traffic.
- **Raising the 8 KB handoff cap.** Tiering keeps the cap and stops the compression.
- **Two programs with a cross-reference.** Both claimed one checker and one skill, numbered checks by hand, and collided on every `DEC` id.
- **A second grammar switch for open items.** Two switches double the rollout states for no gain.
- **Reading the operator's shell from the hook payload.** No host's payload provides it.
- **Always printing bash and PowerShell variants.** It doubles every command block. Neutral commands need neither.

## Open items

- DSN-1 The collision and message-traffic join was not measured · Owner: agent · Done when: a pass joins git-mutating calls to peer sends by repo and time, and the Evidence section records the result
- DSN-2 OpenCode's bash-tool argument mutation has conflicting evidence, which touches the digest port and C4 · Owner: agent · Done when: PR 10 records a live-payload eval on OpenCode and Grok, and a failing host keeps the deny
- DSN-3 The handoff-point replay is a model · Owner: agent · Done when: `MEASUREMENTS.md` records the window method before PR 3, and the comparison runs one week after it lands
- DSN-4 The retention proposal waits on the operator. It rests on a survey of 164 murmuration runs · Owner: operator · Done when: the operator accepts or amends "Retention by run class"
- DSN-5 The budget proposal waits on the operator. It rests on measured register, index, and synthesis sizes · Owner: operator · Done when: the operator accepts or amends "State budgets"
- DSN-7 The Grok read tool's name is UNVERIFIED, so the read-notice matcher may miss Grok reads · Owner: agent · Done when: PR 12 records the name from a live Grok payload or drops Grok from the Read matcher
- DSN-8 Retention defaults map skills by family, not by name · Owner: agent · Done when: PR 13 lists each skill's default class and lint checks the list is total
- DSN-9 The desktop Run button's behavior on a `powershell` block rests on a secondary report · Owner: operator · Done when: the operator reports which shell runs a `powershell` block from the Run button
- DSN-10 Hook latency has no baseline · Owner: agent · Done when: `MEASUREMENTS.md` records p50 and p95 per event before PR 11
