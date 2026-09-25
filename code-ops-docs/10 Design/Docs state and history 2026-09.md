---
type: design
status: draft
updated: 2026-09-25
tags:
  - design
  - vault
  - records
  - handoff
---

# Docs state and history 2026-09

Source: a read-only review of the murmuration documentation on 2026-09-25, then a map of the code-ops record, manifest, vault, and handoff tooling. Seven explorers ran over disjoint slices. The lead verified every load-bearing claim with direct probes. Findings about murmuration name paths and counts only.

Verified-at: c204b17 (2026-09-25)

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
| Run share | `80 Runs/` holds 1.7M words and 5,404 tracked files | CONFIRMED |
| Settled-record index | Last updated 2026-08-26. It omits 108 of 223 settled records, including all 90 from September | CONFIRMED |
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

| Layer | Contents | Mutability | Loaded by default |
| --- | --- | --- | --- |
| State | `00 Home.md`, `20 Decisions/REGISTER.md`, `10 Design/INDEX.md`, `80 Runs/INDEX.md`, synthesis pages that declare sources | Rewritten in place, mostly generated | Yes, within budget |
| History | Record collections, dated run folders, `PROGRAM.archive.md`, closed drafts, `99 Archive/` | Append-only. Record bytes never change | No. Reached through a state link |

The manifest declares each state surface and its word budget. The gate fails a surface over budget. A register over budget splits by topic into `20 Decisions/<topic>.md` files under one short `REGISTER.md`.

### The invariant

1. Every decision in force has one register line.
2. Every register line cites one history source: a record id, and a run or program id when it came from a run.
3. Every program-ledger decision carries a disposition within one hop of being made.
4. No two in-force register lines claim the same topic key without a `supersedes` or `amends` link.

The gate checks all four. Clause 4 surfaces conflicting decisions from parallel programs as a gate failure, not as silent drift.

### Decision status

Curation state becomes a closed set:

| Status | Meaning | Register shows |
| --- | --- | --- |
| `in-force` | The rule applies as written | The rule line |
| `amended` | The rule applies with later amendments | The rule line and each amendment id, in order |
| `superseded` | A later record replaces the rule | Nothing in the main table. The history section links it |
| `historical` | Evidence or a report, not a rule | Nothing. It stays reachable through its topic page |

Status changes are curation events. Record bytes never change, so a write-once record still reads as amended in the register.

## Workstreams

### W1. Standard v5 and manifest v3

The Standard gains the two layers, the invariant, and three profile blocks in the manifest.

```json
{
  "runs": { "tracking": "closeout", "retain": ["2026-09-11-migration-execution/P4/**/RECEIPT*.md"] },
  "drafts": { "maxAgeDays": 21, "statuses": ["draft", "current", "accepted", "superseded"] },
  "state": { "REGISTER.md": { "budgetWords": 12000 }, "10 Design/INDEX.md": { "budgetWords": 4000 } }
}
```

- `runs.tracking` accepts `tracked`, `closeout`, or `ignored`. Under `closeout`, program folders and each `CLOSEOUT.md` are committed, and dated run folders are ignored except the `retain` globs. The default is `closeout`.
- The project profile sets only the default. Each run also carries a retention class, because one repository can mix research evidence with routine work. See "Retention by run class" below.
- `drafts.statuses` replaces profile statuses declared in prose. The checker reads the list from the manifest.
- `legacyPaths` gains two dispositions beside `pointer` and `tombstone`. `relocated` names a moved path and its target. `removed` names a root that must not exist on disk.

**Doctrine change.** The Standard today makes adopted paths irreversible as well as adopted bytes. v5 keeps bytes irreversible and lets a record path move once. Each move is a `relocate` curation event that preserves the sha256. `verify-history` follows the relocation chain. This change needs its own decision note, `D-004 record paths may relocate once`, which supersedes the path clause and cites this design.

### W2. Records carry meaning

`records.mjs` and `record-lib.mjs` change as follows:

- Inventory entries gain `title`, `topic`, `kind`, and `decides`. `kind` is one of `decision`, `amendment`, `erratum`, `evidence`, or `report`. `decides` is one line of at most 25 words.
- Records gain `amends` beside `supersedes`.
- Curation `state` becomes the closed status set above, validated on append.
- A new event type, `relocate`, records `{ from, to, sha256 }`. The validator rejects a relocate whose target bytes differ.
- A new subcommand, `records rechain`, re-sequences a branch's curation events after the base branch's events. It recomputes digests and preserves event order and content. `validateLedger` stays strict, because `rechain` runs before verification.
- `records render` gains a `--register` target. It writes `20 Decisions/REGISTER.md` with one line per in-force or amended decision, grouped by topic: id, the `decides` line, date, source link, and amendment ids. It also writes `98 System/Records/state.json`, the lookup the hooks use.
- A new collection, `decisions`, rooted at `<hub>/20 Decisions/Records/`, receives every new decision through native append. The existing `D-NNN` notes in code-ops adopt into it by genesis adoption.

### W3. Remove the legacy tree

A new command, `co docs relocate`, moves a legacy tree into the vault in two steps.

`plan` classifies every file and writes `RELOCATION_PLAN.md` and `RELOCATION_PLAN.json` in the run folder. Each row names the source, the target, the kind, and the reason. The default routing:

| Legacy content | Target | Layer |
| --- | --- | --- |
| Settled decisions, registrations, rulings, amendments, errata | `20 Decisions/Records/` | History, surfaced by the register |
| Audit runs and archived audits | `99 Archive/Audit/`, subpaths preserved | History |
| Live registers still named as scope by an open program | `99 Archive/Audit/`, flagged for promotion | History, with a triage item |
| References that a manifest domain owns | That domain's target folder | State |
| Specs and plans | `10 Design/Specs/` when current, else `99 Archive/Specs/` | By status |
| Machine-read manifests | `35 Contracts and Data/Manifests/` | State |

`apply` executes the reviewed plan in one commit:

1. `git mv` each file, so rename detection keeps blame.
2. Append a `relocate` event per record.
3. Write `98 System/FORWARDING.json`, the old-to-new path map.
4. Rewrite every reference outside record bytes: code, tests, workflows, `AGENTS.md`, vault notes, `PROGRAM.md` files, and run logs.
5. Set the old roots to `removed` in the manifest.
6. Render the register and indexes.
7. Run the gate.

Record bytes are never rewritten. A citation inside a record keeps its old path and resolves through `FORWARDING.json`.

**Preconditions.** `apply` refuses to run while any `HANDOFF.md` is unconsumed. A checkpoint binds handoff bytes, so a rewrite would break them. It also refuses a dirty tree and a base older than the plan.

**Guards after the move:**

- The gate fails when a `removed` root exists on disk. It also fails when a tracked file outside record bytes and `FORWARDING.json` references a relocated path.
- The `enforce-legacy-paths` PreToolUse hook denies a Write or Edit under a `removed` root. It is on by default, with an off switch like the other suite hooks.
- `integrate-branch.mjs` runs `co docs relocate forward` on a branch that predates the move. That rewrites the branch's own references through `FORWARDING.json` before the gate runs.

### W4. Vault checks

`check-vault-standard.mjs` adds these rules:

- Status must come from `drafts.statuses`.
- `superseded` requires a `superseded-by` link that resolves.
- A note whose status is `draft` and whose first 30 lines carry a PROMOTED or SUPERSEDED marker fails.
- A draft older than `drafts.maxAgeDays` needs a `next:` line, or it enters the triage queue.
- `10 Design/INDEX.md` is generated. It groups notes by status and lists each with its `updated` date and `next:` line.

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
| 14. Promotion resolves | Every `promoted:<id>` resolves in `state.json` | Check 9 for scope documents |
| 15. Handoff points, not copies | Each `## Decisions made` bullet in `HANDOFF.md` leads with a `DEC` id | New. The ledger holds the text once |

Check 15 removes a duplicate that exists today, where the same decision is written in both the handoff and the ledger. The handoff keeps one clause of reason per decision and points at the ledger for the rest.

#### Write

`co handoff draft` lists every `pending` decision from earlier hops as a `[FILL: disposition]` line. The unfilled skeleton already fails the check by design, so a hop cannot close with an old pending decision. A decision made in the current hop may stay `pending`. It is carried forward to the next hop, which must settle it.

A new command, `co decide promote DEC-<n> --program <slug>`, does the promotion in one step:

1. Append a native record to the `decisions` collection, with `decides`, `topic`, `kind: decision`, and a `source` naming the program and hop.
2. Append the curation event.
3. Set the ledger disposition to `promoted:<record id>`.
4. Render the register.

One command writes all four, so the ledger and the register cannot disagree. The Write section of the handoff skill gains one sentence routing to this command.

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
| Native record files | None. Each record is one file named by a unique id | None needed |
| Curation ledger | Two branches append events with the same `sequence` | `records rechain` runs in `integrate-branch.mjs` and the pre-commit hook. CI runs `verify-history` strictly |
| Register, indexes, `state.json` | Both branches regenerate them | Derived files. Never hand-merged. The pre-commit hook regenerates them, as it does host distributions today |
| Ratchet baseline | Both branches shrink it | The merge keeps the intersection. The baseline may only shrink |
| `DEC` ids | None within a program. The peer guard allows one live head | None needed |
| Conflicting rules from two programs | Both promote a rule on the same topic key | Invariant clause 4 fails the gate. The second promoter must add `supersedes` or `amends` |

### W6. One gate, installed

A new command, `co docs gate`, runs every docs check in order:

1. `docs-manifest check`
2. `records check` and `verify-history` for each collection
3. `check-vault-standard`
4. Register freshness, the invariant, and state budgets
5. Draft and staleness rules
6. Legacy-path guards
7. Ledger checks 11 to 14 over every open program

**Ratchet.** On first adoption, the gate writes `98 System/GATE_BASELINE.json` with every existing violation. Later runs fail on any violation not in the baseline. A fixed violation leaves the baseline at the next run, and the baseline never grows. This follows the repository rule that no gate turns fail-open.

**Installation.** `conform` installs the gate into the adopting repository: one CI step and one pre-commit entry. It also adds the pointer lines to `AGENTS.md`. `integrate-branch.mjs` gains a docs step that runs `records rechain`, renders, and runs the gate.

### W7. The `distill` skill

`code-ops-suite:distill` turns history into state.

**backfill** is the one-time cleanup of an existing sprawl. Each phase ends at a checkpoint:

1. **Inventory.** Size every tree. Run `co docs relocate plan` when a legacy tree exists.
2. **Relocate.** The operator reviews the plan. `apply` runs under the preconditions in W3.
3. **Classify.** Mechanical agents fill `title`, `topic`, `kind`, and `decides` for records, in batches of about 25. The lead reviews every `decides` line against its source, because a wrong summary of a ruling is worse than none.
4. **Chain.** Link amendments, errata, and supersessions. Set each record's status.
5. **Drafts.** Triage every draft to `current`, `superseded` with a link, or archive.
6. **Ledgers.** Assign `DEC` ids and dispositions to every program ledger. Promote or mark `local` each decision. Standardize overflow files.
7. **Synthesis.** Add `sources:` to each synthesis page. Mark each stale page for refresh or archive it.
8. **Install.** Write the baseline and install the gate through `conform`.

**maintain** is a small, schedulable pass. It works down the baseline and the triage queue, and it stops at a declared round budget.

`conform` routes to `distill` when it finds drift in state surfaces. `doc-alignment` keeps its role: it reconciles docs against code, and `distill` reconciles history against state.

### W8. Session context

- **Routing card.** SessionStart adds one line: the register path, its entry count, and a warning when the gate would fail. It points and does not load, so it costs about 30 tokens.
- **History read notice.** A PostToolUse hook on Read looks up the path in `state.json` when the file sits in a history location. For a record that is not `in-force`, it adds one context line naming the status, the replacing record, and the register line. An agent that opens an old record still learns the current rule. It is on by default, with an off switch. A `provider-parity-audit` pass covers the four hosts before release.

## Retention by run class

A project-wide profile is too coarse for a repository that mixes research with routine work. Murmuration runs include research evidence the operator calls extremely important, beside build and cleanup runs. So retention is set per run, and the project profile supplies only the default.

- `co run open` takes `--retention evidence|working`. The class is recorded in `SESSION.json` and in the run index.
- An `evidence` run is tracked whole, whatever the project profile says.
- A `working` run follows the project profile. Under `closeout`, only its `CLOSEOUT.md` and `retain` globs are committed.
- An agent may raise a run from `working` to `evidence`. Only the operator may lower it.
- A run with no class is treated as `evidence`. Losing research is worse than keeping busywork.
- Changing a profile never untracks a run that is already committed. Untracking an existing run needs its own classification pass and operator sign-off, recorded per run.

The classes, their defaults, and how research is recognized are open design work (DSN-4).

## Safety and rollout

The operator's first concern is breaking working repositories. These guarantees bind every workstream:

1. **Nothing changes in an adopter until it opts in.** A code-ops upgrade adds commands and checks, but an adopting repository sees no new gate until `conform` installs it there.
2. **In-flight programs stay resumable.** Ledger checks 11 to 15 apply only to a `PROGRAM.md` that declares `Grammar: 2`.
3. **Every mutating command plans first.** `relocate`, `backfill`, `archive`, and `close` each have a plan mode that writes only to the run folder. The operator reviews the plan before `apply`.
4. **Each apply is one revertable commit.** `git revert` of that commit restores the prior tree, with no manual cleanup.
5. **Nothing is deleted.** Relocation moves files. Archiving moves entries. Untracking a committed run follows the rule in the retention section.
6. **The adopter's own tests gate a relocation.** The relocation commit must pass the repository's test suite, because code reads some moved files at runtime.
7. **Old citations keep resolving.** `FORWARDING.json` answers every old path in record bytes, consumed handoffs, and git history.
8. **Agents learn the new layout from the session start.** The routing-card line, the `AGENTS.md` pointer, and the read notice each point at the register. No agent needs to know the old tree existed.

Each guarantee gets an eval case before the PR that could break it merges.

## Murmuration adoption

The adoption is a calibration of the feature, not a separate project.

1. Run `distill backfill` assess-only through the `calibration-run` skill. Only the sanitized note returns to code-ops.
2. Settle or consume the open handoffs, so the relocation preconditions hold.
3. Run `backfill` for real. The expected scale is about 223 settled records, 219 drafts, 4 program ledgers with about 300 decisions, and 1,157 files under `docs/`. The estimates are PROBABLE.
4. Choose the run profile. Migration runs hold receipts that must stay in git, so murmuration likely uses `closeout` with a `retain` list. The operator makes this choice at the checkpoint.

The move rewrites about 930 references in 327 code files. The repository's test suite must pass on the relocation commit, because some of those references are runtime reads of machine manifests.

## Delivery

| PR | Content | Depends on |
| --- | --- | --- |
| 1 | Standard v5, manifest v3 schema, and decision note D-004 | None |
| 2 | Record fields, the status set, `amends`, `relocate`, `rechain`, and register rendering | 1 |
| 3 | Vault-check rules, generalized staleness, `co docs gate`, and the ratchet | 1, 2 |
| 4 | Handoff checks 11 to 15, `co decide promote`, `co handoff archive`, `co handoff close`, and resume fallbacks | 2 |
| 5 | `co docs relocate`, the legacy-path hook, and the read notice hook | 2, 3 |
| 6 | The `distill` skill, `conform` installation, the routing-card line, and `integrate-branch` steps | 3, 4, 5 |
| 7 | Evals | Each PR adds its own cases. This PR adds the end-to-end fixture |

PR 4 bumps the handoff contract in `CONTRACTS.md`. Existing program ledgers have no `DEC` ids, so checks 11 to 14 apply only to a program whose `PROGRAM.md` declares `Grammar: 2`. `distill backfill` upgrades a ledger to grammar 2. A new program starts at grammar 2. This keeps every in-flight program resumable during the rollout.

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

## Open items

- DSN-1 The topic-key grammar for invariant clause 4 is undefined · Owner: agent · Done when: PR 2 defines the key and its eval case passes
- DSN-2 `records rechain` behaviour when both branches curate the same record is unspecified · Owner: agent · Done when: PR 2 states the rule and a two-branch eval case passes
- DSN-3 Whether the read notice hook is reachable on Grok and OpenCode is unverified · Owner: agent · Done when: `provider-parity-audit` records the result per host
- DSN-4 Run retention classes, their defaults, and how research evidence is recognized are undesigned. Murmuration mixes research with routine work, so a wrong default loses research · Owner: operator · Done when: a retention design section, built from a survey of murmuration run kinds, is accepted by the operator
- DSN-5 State budget defaults are placeholders. The right budgets differ between research and routine content · Owner: operator · Done when: budgets are set from measured murmuration register and synthesis sizes and accepted by the operator
- DSN-6 The safety guarantees have no eval cases yet · Owner: agent · Done when: each guarantee maps to a named eval case in the delivery plan
