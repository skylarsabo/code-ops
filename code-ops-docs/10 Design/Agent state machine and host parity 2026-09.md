---
type: design
status: accepted
updated: 2026-09-30
tags:
  - design
  - state-machine
  - hosts
  - workflows
  - distill
  - compaction
---

# Agent state machine and host parity 2026-09

This design answers the operator request of 2026-09-30: a state machine for agents, orchestrators, and workers that works the same on Claude, Codex, Grok Build, and OpenCode. It also covers four linked asks. Claude should use the Workflow tool more. OpenCode should use only enabled models. The `distill` skill keeps its full W7 scope. Compaction must not lose important context.

Verified-at: a4f5a1a on feat/compaction-convergence-ledger (2026-09-30). Evidence: `80 Runs/2026-09-30-handoff-fidelity-ho13/reports/` (state-substrate, host-parity, host-docs, workflow-and-docs-inventory, plan-review, autocompact-controls, unit-f1) and `RUN_LOG.md`. This design builds on `Program state handoffs and coordination 2026-09.md` (W7, C1 to C5) and does not replace it.

Terms used in this document, one term per concept:

- **Lead.** The session model that plans, dispatches, and accepts.
- **Orchestrator.** A skill the lead runs to dispatch workers, such as `everything` or `ship`.
- **Worker.** A suite agent that a dispatch starts. The word covers every operative and subagent.
- **Unit.** One brief handed to one worker, recorded as one dispatch row.
- **Agent ledger.** The F3 store that hooks write. Its name stays, and its rows describe workers.

## Summary

The repository already holds most of the states. A dispatch row moves through `dispatched`, `reported`, `failed`, and `redispatched`. A runtime moves through `init`, `checkpoint`, `resume`, and `replan`. A board record moves through live, idle, and ended. A handoff is written, then consumed. What is missing is one written statement of how these fit together, plus three pieces of machinery.

The design has three rules.

- **One state per entity.** Each entity keeps its state in the store that already owns it. No new journal and no new state store appear.
- **Scripts own transitions, hooks only speed them up.** Every transition is reachable by a host-neutral script that the lead can call. A hook writes the same store when the host exposes the event. A host without the event loses speed, never correctness.
- **Derived views replace new states.** "Accepted", "stale worker", and "abandoned session" are computed from existing records. They are not stored statuses.

The design adds four things to the in-flight work.

- A PreCompact snapshot and a compact re-inject that name pending workers (OI-56, after F1 and F3).
- A pending-worker rule on every host, so a handoff or a stop cannot leave a worker unreported.
- A fail-closed enabled-models check on OpenCode at the moment of dispatch.
- An opt-in Workflow branch for fan-out phases, with the same phases available through Agent calls on every host.

`distill` keeps all eight backfill phases and adds a no-loss check that accounts for every input path.

## Problem

Handoffs carried continuity, and they cost more than they returned. Measurements from HO 13 (`reports/churn-data-quality.md`, `churn-single-tap-cutover.md`, `hop-token-cost.md`, as summarized in `RUN_LOG.md:10-14`):

| Measure | Value |
| --- | --- |
| Data Quality open items | 18 to 86 over 34 hops |
| Data Quality hops that closed nothing | 9 of 11 (hops 22 to 32) |
| Single Tap open items | 20 to 63 over 29 hops |
| Ids open for 10 or more hops | 29 |
| Decisions superseded within 0 to 1 hops | 7 |
| Cost of one hop cycle | about 10.8M billed tokens, about 46% of a median session |
| Context after a compaction | 15k to 21k |

Workers were also orphaned. A handoff or a stop left dispatched workers with no recorded report. The dispatch ledger is lead-written, so a dead worker stays `dispatched` until the lead looks (`state-substrate.md`, gap 7).

DEC-73 and DEC-74 already answer the churn. Routine relief is auto-compaction at 250k. A program has a finish line F1 to Fn and at most 12 active items. After triage, Data Quality held 12 active items and 62 deferred. Single Tap held 12 active and 53 in backlog (`RUN_LOG.md:36`, `TASKS.md` OI-55).

Five gaps remain, and this design closes them:

1. No PreCompact hook exists. `plugins/code-ops-suite/hooks/hooks.json` registers PostToolUse (line 35), SubagentStart (line 86), and SubagentStop (line 96), and no PreCompact.
2. Nothing names a pending worker on hosts whose hooks never fire.
3. No written state machine exists, so each host grew its own reading.
4. No skill uses the Workflow tool (`workflow-and-docs-inventory.md`, CONFIRMED). The Workflow branch has no owner.
5. OpenCode can bind a model the operator disabled. The gap is narrower than the first map claimed, as the OpenCode section shows.

## Entities and states

Each entity lists its states, its store, and what counts as terminal. The "Stored" column marks whether the state sits in a file or is computed on read.

| Entity | States | Stored | Terminal |
| --- | --- | --- | --- |
| Unit (dispatch row) | dispatched, reported, failed, redispatched | `DISPATCH_LEDGER.md` plus `.journal.jsonl` | reported |
| Unit acceptance | pending, accepted, rejected | derived from the acceptance ledger in `RUN_CONTRACT.json` | accepted |
| Worker run | dispatched, reported, failed, stale | agent ledger (F3), with `stale` derived | reported, failed |
| Runtime | init, checkpoint, resume, replan | `RUN_RUNTIME_RECEIPTS.jsonl` | none |
| Session | open, working, compacted, handed-off, consumed, ended | `SESSION.json`, board record, `HANDOFF.consumed`, with `compacted` derived | consumed, ended |
| Board record | live, idle, ended, abandoned | board file, with `idle` and `abandoned` derived | ended, abandoned |
| Context band | band N assessed or unassessed | `.assessed.json` | none |
| Program item | open, closed, backlog | `PROGRAM.md`, `TASKS.md`, `BACKLOG.md` | closed |
| Finish line Fn | open, done | derived from `Blocks: Fn` on items | done |
| Decision | pending, local, dropped, promoted | `PROGRAM.md` ledger, then the record | local, dropped, promoted |
| Distill phase | pending, running, checkpointed, done | runtime checkpoint per phase | done |

Five rules keep this table honest.

- **`reported` stays terminal for a dispatch row.** `ledger-grammar.mjs:44` returns false for any move out of `reported`, and only `failed` may become `redispatched`. A rejected unit therefore opens a new dispatch row that cites the old one. It does not reopen the old row.
- **Acceptance is derived, not stored.** A unit is accepted when every blocking criterion for it has a PASS verdict. The acceptance ledger lacks a unit id today (`state-substrate.md`, gap 6). The unit id moved to the backlog, so acceptance stays as built.
- **`compacted` is a view.** A session is compacted when its transcript holds a `compact_boundary` record that the restored context has not yet passed. No file stores the state.
- **`stale` is a view.** A worker run is stale when its row is still `dispatched` and either the session ended or an operator-set age passed. The dispatch ledger already prints this as an advisory (`scripts/dispatch-ledger.mjs:603-605`) and fails under `--strict` (line 661).
- **`abandoned` is a view.** A board record is abandoned when its heartbeat is older than 30 minutes and it never reached `ended`. This separates a clean finish from a dead session (`state-substrate.md`, gap 4).

The lead, an orchestrator, and a worker differ only in which transitions they may fire. The lead fires every lead-written transition. An orchestrator fires the same transitions on the lead's behalf, in the lead's session. A worker fires none. A worker writes artifacts, and the lead or a hook turns the return into a `reported` transition.

## Transition table

Writer names a script (S) that any host can run, or a hook (H) that needs the host event. Status marks built, in flight (F1, F2, F3, OI-56), or new.

| # | From | Event | Guard | To | Writer | Store | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | none | lead opens a run | repository has `.git` | session open | S `handoff-state.mjs open` | `SESSION.json`, board | built |
| 2 | session open | lead registers units | run contract exists | unit planned | S `run-contract.mjs init` | `RUN_CONTRACT.json` | built |
| 3 | unit planned | lead dispatches | dispatch guard allows, band assessed, agentType is a suite agent | row dispatched | S `dispatch-ledger.mjs add` with `--actor-id` | `DISPATCH_LEDGER.md` | built |
| 4 | none | host launches a worker | hook reaches the launch | worker run dispatched | H PostToolUse on `Agent`; covered-by 3 | agent ledger | F3 |
| 5 | row dispatched | worker returns | artifact exists and passes its section check | row reported | S `dispatch-ledger.mjs update --status reported --report` | `DISPATCH_LEDGER.md` | built |
| 6 | worker run dispatched | host reports the stop | SubagentStop carries `agent_id` | worker run reported | H SubagentStop; covered-by 5/7 | agent ledger | F3 |
| 7 | row dispatched | worker errors or dies | lead sees the error or a stale view | row failed | S `dispatch-ledger.mjs update --status failed` | `DISPATCH_LEDGER.md` | built |
| 8 | row failed | lead retries | new row with a new actor | row redispatched, new row dispatched | S `dispatch-ledger.mjs update --status redispatched`, then `add` | `DISPATCH_LEDGER.md` | built |
| 9 | row reported | lead records verdicts | every blocking criterion PASS | unit accepted | S `run-contract.mjs record` and `finalize` | `RUN_CONTRACT.json` | built |
| 10 | row reported | lead records a FAIL | any blocking criterion FAIL | unit rejected, new unit planned | S `run-contract.mjs record` | `RUN_CONTRACT.json` | built |
| 11 | session working | context crosses a 150k band | none | dispatch denied until assessed | H `dispatch-guard.mjs assessed` (line 621) writes the marker | `.assessed.json` | built |
| 12 | session working | auto-compaction starts | PreCompact fires or lead checkpoints | snapshot written | H PreCompact, or S `run-runtime.mjs checkpoint` | run folder snapshot, receipts | OI-56 |
| 13 | session compacted | new context starts with `source=compact` | snapshot exists | session working, state re-injected | H SessionStart compact branch | none (reads snapshot, `TASKS.md`, agent ledger) | F1, OI-56 |
| 14 | session working | lead hands off | DEC-73 trigger and zero pending workers | handed-off | S `handoff-state.mjs draft` | `HANDOFF.md` | built, pending rule new |
| 15 | handed-off | successor resumes | chain check passes | consumed | S `handoff-state.mjs resume` | `HANDOFF.consumed` | built |
| 16 | session working | session ends | none | ended | H SessionEnd `session-receipt`, or S writer for `ended` (PR 4 adds it if absent) | board, receipts | built, S writer new |
| 17 | board live | heartbeat silent 30 minutes | no `ended` | idle, then abandoned (views) | read only | board | built |
| 18 | item open | lead closes with evidence | Done when met | closed | lead edit, checked by `check-handoff.mjs` | `PROGRAM.md` | built |
| 19 | item open | active count exceeds 12 | F2 cap | backlog | S `handoff-state.mjs` with F2 checks | `BACKLOG.md` | F2 |
| 20 | finish line open | last `Blocks: Fn` item closes | none | done (view) | burn-down line | derived | F2 |
| 21 | decision pending | one hop of grace passes | disposition chosen | local, dropped, or promoted | S `co decide promote`, `distill` phase 6 | `PROGRAM.md`, record | built, phase 6 new |
| 22 | distill phase pending | lead starts the phase | prior phase done | running, then checkpointed | S `run-runtime.mjs checkpoint` | receipts | new |
| 23 | distill phase checkpointed | lead review passes | review rule met | done | lead | receipts | new |

Rows 4 and 6 add facts that rows 3, 5, and 7 already record under the lead's hand. The lead's rows say what the lead intended and verified. The agent ledger says what the host observed. The join key is `--actor-id`, which the dispatch ledger defines as "host-session-or-agent-id" (`scripts/dispatch-ledger.mjs:113`). Whether the F3 `agent_id` equals that value is PROBABLE and not yet checked. `unit-f3.md` does not exist yet, so the F3 builder must confirm it.

The pending-worker rule has one form. `co agents pending` always merges agent ledger rows still `dispatched` with dispatch rows still `dispatched`, deduped on actor id. It is never a fallback. It prints the sources it read. It prints `unknown` only when the host signals that it cannot report workers, and never for a missing file. Pending workers block transition 14. A handoff with an unreported worker fails (OI-54, done-when). The exit is `co agents settle <id> --failed --reason <text>`, which appends a `failed` row.

## State store

The design reuses every store in the table below and merges none of them. It adds one artifact and retires none.

**Reuse.**

- `DISPATCH_LEDGER.md` and `.journal.jsonl` hold unit rows. Unknown journal kinds stay valid, and pre-journal ledgers stay valid.
- `RUN_RUNTIME_RECEIPTS.jsonl` holds checkpoints, including one per distill phase.
- `RUN_CONTRACT.json` holds units, budgets, and the acceptance ledger.
- `SESSION.json` and the board hold session and presence state.
- `HANDOFF.md` and `HANDOFF.consumed` hold per-hop history.
- `PROGRAM.md`, `TASKS.md`, and `BACKLOG.md` hold program state.

**Merge.** The agent ledger and `DISPATCH_LEDGER.md` stay separate. They have different writers and different truth. A hook that wrote the dispatch ledger would break its grammar guarantees, because the ledger is lead-written by design (`state-substrate.md`, gap 7). The two files meet in a reader: `co agents pending` joins them on actor id, and `check-handoff.mjs` reads the join.

**New.** One snapshot file per compaction, in the run folder, written by a host-neutral snapshot script. The PreCompact hook calls the script, and the lead can call it too.

**Retire.** Nothing retires now. The design rejects a second journal (see Rejected alternatives). Two items may retire later if evidence supports it:

- The `.assessed.json` band marker, if auto-compaction makes bands obsolete on Claude and Codex.
- The 225k handoff point, which F1 already limits to Grok (`unit-f1.md`).

**Versioning.** Every new record carries a version field. A reader treats an unknown kind as a no-op. This keeps old repositories valid, and it lets a later record kind land without a migration.

## Host parity

This section answers one question per transition group: what event drives it on each host, and what does the lead do when the host lacks the event. Sources: `INFRASTRUCTURE.md:220-238`, `host-docs.md`, `host-parity.md`. UNVERIFIED marks a payload the repository has never captured.

The universal fallback applies to every row. The lead runs the script named in the transition table. The lead also runs `co agents pending` before any handoff or stop.

**Session open (row 1) and routing card.**

| Claude | Codex | Grok Build | OpenCode |
| --- | --- | --- | --- |
| SessionStart routing card | SessionStart, projected | SessionStart, but passive stdout is unavailable, so the card lives in instruction files | `system.transform` port on the first lead turn |
| Fallback: none needed | Fallback: lead runs `handoff-state.mjs open` | Fallback: `AGENTS.md` pointer tells the lead to run it | Fallback: lead runs it |

**Pre-dispatch guard (row 3).**

| Claude | Codex | Grok Build | OpenCode |
| --- | --- | --- | --- |
| PreToolUse on `Agent`, `Task`, `Workflow` | PreToolUse projected, but gates stay inert unless the dispatch tool shares Claude's name (`INFRASTRUCTURE.md:234`, UNVERIFIED) | `spawn_subagent` through the camelCase mapping, with no agent-type field | `tool.execute.before` with a suite-only Task allowlist |
| Fallback: none | Fallback: lead reads `agents/model-floors.json` and runs the ledger `add` itself | Fallback: lint-enforced floors, collapsed ladder | Fallback: `chat.params` floor gate throws below the floor |

**Worker launch and report (rows 4 to 7).**

| Claude | Codex | Grok Build | OpenCode |
| --- | --- | --- | --- |
| PostToolUse on `Agent` and SubagentStop. `agent_id` is PRIMARY in the payload | SubagentStart and SubagentStop exist per primary docs. Payload fields UNVERIFIED | SubagentStart and SubagentStop exist per primary docs. The payload is UNVERIFIED and `agent_id` is absent, so the hook stays silent (`INFRASTRUCTURE.md:229`) | No subagent-finish event. A task worker is a child session. `tool.execute.after` on the `task` tool is the probable signal |
| Fallback: lead runs `update --status reported` | Fallback: same | Fallback: same, using `get_command_or_subagent_output` | Fallback: same |

On every host the stale view works without any hook, because it reads dispatch rows. The hook path only makes the agent ledger richer. `tool.execute.after` at `scripts/opencode-lifecycle.js:1355` queues notes today and never writes a ledger. No OpenCode report writer is planned. A foreground task settles at launch (`scripts/agent-ledger.mjs:90`), and dispatch rows cover OpenCode.

**Compaction snapshot and re-inject (rows 12 and 13).**

| Claude | Codex | Grok Build | OpenCode |
| --- | --- | --- | --- |
| PreCompact hook for the snapshot. SessionStart `source=compact` for the re-inject | PreCompact and PostCompact exist. SessionStart reports `compact`. Projected restore | PreCompact and PostCompact exist. Restore uses instruction files only | `session.compacted` event. The lifecycle plugin has a compaction port |
| Fallback: lead runs the snapshot script at each 150k assessment | Fallback: same | Fallback: same, and Grok compacts at 85% by default (`auto_compact_threshold_percent`) | Fallback: same |

The four hosts all document a compaction event (`host-docs.md`). No PreCompact hook is registered on any host today. Each host registration needs a payload check before the design claims it works.

**Handoff and end (rows 14 to 17).**

| Claude | Codex | Grok Build | OpenCode |
| --- | --- | --- | --- |
| UserPromptSubmit card, SessionEnd receipt | Projected, and the card stays silent if `transcript_path` is absent | PostToolUse note from `updates.jsonl`. UserPromptSubmit stdout is discarded | Lifecycle note from `message.updated` usage. No SessionEnd. `session.deleted` and `session.idle` exist |
| Fallback: lead runs `handoff-state.mjs draft` | Fallback: same | Fallback: same, with self-assessment at 150k and 200k | Fallback: same |

**Board and collision (presence states).**

| Claude | Codex | Grok Build | OpenCode |
| --- | --- | --- | --- |
| PostToolUse edit hook | Payload UNVERIFIED | PostToolUse delivery only | `file.edited` port, and hub-edit and seal events only |
| Fallback: `co board` by hand | Fallback: same | Fallback: same | Fallback: same |

## OpenCode enabled models

**Rule.** A dispatch on OpenCode binds only a model that meets all four conditions. If none meets them for the agent's floor, the dispatch is denied.

1. The live host list names the model.
2. The operator profile names it, when the profile has an `enabled` list.
3. The desktop Models settings do not hide it.
4. No `disabled_providers` entry covers its provider, and `enabled_providers` includes it when set.

**What exists today.** The repository already covers part of the rule.

- `enabledModels()` filters the catalog by the profile list and by the desktop hidden-model store (`scripts/opencode-lifecycle.js:604-627`). `buildChooserLadder()` assigns tiers from that result (`:705-725`).
- `refreshChooserCache()` calls `client.config.providers()` with a 5 second limit and builds the live id list (`:470-495`).
- At dispatch, `tool.execute.before` compares the bound model with the live list. When the model is gone, it swaps the agent for its `-lead` clone and queues a note (`:1277-1283`).
- `chat.params` throws when the bound model falls below the agent's floor (`:435-437`).

**What is missing.** These are the real gaps. The earlier reports said nothing checks the live list, and that claim was too strong.

- The live check sits behind the `CODE_OPS_TIER_ROUTING` switch (`:1263`). Tier routing is on by default, so the gap shows only when the operator turns it off. The check must still not depend on the switch.
- `live` stays null until the first event handler finishes its refresh (`:1088`, `:1391-1392`), so an early dispatch skips the check.
- The check never applies the profile `enabled` list to the live ids. A model on the live list but off the profile list passes.
- The check inherits the lead model. It does not deny.
- When the profile list names no model the host offers, the code only warns, and agents keep their configured models (`:721-723`).
- Nothing reads `enabled_providers` or `disabled_providers`. Whether `client.config.providers()` already honors them is UNVERIFIED (`host-docs.md`).

**Where the check lives.** One function, `assertDispatchModel`, in `scripts/opencode-lifecycle.js`. It runs in `tool.execute.before` for every dispatch tool call, whatever the routing switch says. The model calls the task tool, so no lead-side script can bypass this point. A lead-side script check would duplicate it.

**Fail-closed behavior.** The order is: the live list, then the cache filtered by conditions 2 to 4, then the lead clone if the lead meets the agent's floor, then a denial.

- When the live list is null, the function waits once for `refreshChooserCache()` within its 5 second limit.
- If the wait fails, the function falls back to the cached catalog (`readChooserCache()`), filtered by conditions 2 to 4. The cache holds ids the host listed on an earlier run.
- If the cache is empty too, the function denies and tells the operator how to restart OpenCode.
- When the profile list names no available model, the function denies the dispatch. The startup warning stays.
- The lead clone fallback stays, but only when the lead model itself meets all four conditions and the agent's floor.

**Generated plugin.** `scripts/build-opencode-dist.mjs:363-395` writes `KNOWN_MODELS` and `TIER_BY_ID` at build time. The design does not filter those by the build machine's model list. A build-time list goes stale when the operator changes settings. `build-opencode-dist.mjs --check` only verifies that the generated plugin carries the function.

**Proof before claiming it works.** A live-payload check runs `client.config.providers()` with one provider under `disabled_providers` and records whether that provider's models appear. The result sets whether condition 4 needs its own read of the OpenCode config. A new eval, `opencode-enabled-models`, plants a disabled model and expects a denial before launch. The eval covers three states: live list present, live list null with a cache, and live list null with no cache.

**Codex and Grok.** Both hosts bind models through agent frontmatter and lint-enforced floors (`lint-plugins.mjs:710-741`) and through `agents/model-floors.json` for Codex. Neither host exposes an enabled-models list in the sources read. No runtime check is proposed for them.

## Workflows on Claude

**Finding.** No skill, agent file, or `CONVENTIONS.md` uses the Workflow tool (`workflow-and-docs-inventory.md`, CONFIRMED). The orchestrators `everything`, `ship`, `calibration-run`, `codebase-audit`, and `remediation` dispatch with the Agent tool only. The exact call form in those skills is UNVERIFIED, and this draft did not read them.

**Facts the design relies on.**

- A Workflow script runs JavaScript with `agent()`, `parallel()`, and `pipeline()`.
- Each `agent()` may set `agentType` and `effort`. Today the dispatch guard denies a Workflow script that holds an `agent(` call and no `agentType:` field anywhere in the script (`plugins/code-ops-suite/hooks/dispatch-guard.mjs:681-688`, `CONTRACTS.md:909-910`). It checks the script as a whole, not each call. It skips the brief-contract checks for a Workflow.
- A Workflow needs explicit operator opt-in for each run, unless ultracode is on.
- Scripts cannot touch the filesystem.
- Results are journaled and the run can resume.
- Other hosts have no Workflow tool.

**Where a Workflow fits.** A Workflow pays off for wide, independent fan-out with no gate between items. A Workflow does not fit a serial phase or a gate.

| Orchestrator or skill | Workflow branch | Reason |
| --- | --- | --- |
| `distill` backfill | yes, for phase 3 classify batches and phase 7 synthesis pages | about 18 independent batches per vault |
| `codebase-audit` | candidate, for independent reviewers | fan-out with no ordering, UNVERIFIED until the skill is read |
| `remediation` | no | fixes depend on each other |
| `everything`, `ship` | no | serial phases with gates |
| `calibration-run` | no | isolated assess-only runs already fan out by run |

**Opt-in handling.** An orchestrator never starts a Workflow on its own. One unpinned Workflow section goes into the `CONVENTIONS.md` of `code-ops-suite` (beside §1), `privacy-opsec-suite`, and `researcher`. It says: when the operator has opted in to Workflow for this run, or ultracode is on, run the fan-out phase as one Workflow script. Otherwise run the same phase with Agent calls. The named `SKILL.md` files cite that section and carry no copy of it. The design adds no new flag. The earlier candidates invented `--workflow` and `CODE_OPS_USE_WORKFLOWS`, and the repository has neither.

**Host-neutral equivalent.** The orchestrator writes a phase plan to the run folder before it dispatches. The plan lists batches, the suite agent for each, the effort, and the expected artifact path. Both paths execute the same plan.

- On Claude with opt-in, the Workflow script carries the plan's batches as `agent()` calls in `parallel()`. The script returns results to the lead. The lead writes the report files, because the script cannot.
- On any host without opt-in, the lead dispatches the same batches with Agent, Task, or the host's own dispatch tool. The lead writes the same report files.
- Either way, the lead registers each batch as a unit with `dispatch-ledger.mjs add` before the dispatch and updates it after. The Workflow journal helps resume, and the run ledger stays the durable record.

**Constraints that bind every `agent()` call.**

- `agentType` names the suite agent that best fits the job, such as `code-ops-suite:reviewer`. A wide-surface type is never used.
- `effort` is at most `high`.
- The call carries the same brief fields as an Agent dispatch. No gate checks this today, because the guard skips the brief-contract checks for a Workflow. PR 4 adds a per-call `agentType` check and denies a literal `effort` above `high`. The brief check stays an advisory.

Whether SubagentStart and SubagentStop hooks fire for workers started inside a Workflow is UNVERIFIED. The design assumes they do not. The lead therefore reconciles the ledger from the returned results and does not wait for hooks.

## Distill

`code-ops-suite:distill` keeps its full W7 scope. The operator amended the plan review on 2026-09-30 (`RUN_LOG.md:37`): murmuration docs must reach complete standardized order without losing research or other important information. The cut to a per-program distill (`plan-review.md`) becomes the first, cheapest mode. It no longer replaces the backfill.

**Two modes, one skill.**

- **Program mode** distills one program ledger into its finish line, at most 12 active items, live decisions, and a backlog. It is phase 6 alone. It serves any program that needs a finish line, and it needs no relocate.
- **Vault mode** is the full eight-phase backfill, then the maintain pass. The finish-line check of a program triggers it, and the operator can request it directly.

**Phases as states.** Each backfill phase is a state of the distill run (transition rows 22 and 23). A phase is pending, running, checkpointed, or done. The runtime checkpoint records the phase name, the input inventory, and the artifact paths. A compaction or a handoff resumes from the last checkpointed phase.

| Phase | Work | Checkpoint artifact | Review before done |
| --- | --- | --- | --- |
| 1 Inventory | size every tree, run `co docs relocate plan` | inventory and plan | lead reads totals |
| 2 Relocate | `co docs relocate apply` in waves | one commit per wave, forwarding map | operator approves the plan |
| 3 Classify | workers fill `title`, `topic`, `kind`, `key`, `decides` | per-batch metadata | lead reads every decision and amendment line, plus a 10% sample per batch |
| 4 Chain | link amendments, errata, supersessions, set status | chain report | lead reads every chain edge |
| 5 Drafts | triage to current, superseded with link, or archive | triage list | lead reads archive choices |
| 6 Ledgers | assign `DEC` ids and dispositions, standardize overflow | ledger diff | lead reads every disposition |
| 7 Synthesis | add `sources:` to each synthesis page, mark stale pages | page list | lead reads a sample |
| 8 Install | write the baseline, install the gate through `conform` | baseline and gate | no-loss check passes |

One defect in a 10% sample sends the whole batch to full review. A worker never classifies its own batch twice.

**Murmuration sizes** (`workflow-and-docs-inventory.md`, `plan-review.md`):

- 26,839 files in the vault, of which 26,378 sit under `80 Runs` (6.6 GB, 257 run folders).
- 296 design files, 66 operations files, and 19 topic files. About 98% of files outside `80 Runs` carry frontmatter.
- A legacy `docs/` tree of 6,955 files and a `research/` tree of 44,624 files. The register holds `research/` by pointer, as one entry for the tree, and does not list its files.
- A relocate plan of 6,945 files in 5 waves, with 2,141 runtime reads, 2,341 prose references, 0 unresolved, and 0 conflicts.
- About 435 records: 51 decision-kind and 384 of other kinds. At 25 per batch, this is about 18 batches. The lead reads all 51 decision records and about 39 sampled records.
- About 180 and 156 decision lines across 9 and 5 ledger files.

The candidate designs quoted 136 decisions across 4 ledgers. That figure does not match the plan review, so this design uses the plan review's counts and marks the discrepancy as an open question.

**No-loss guarantee.** Five rules and one check protect research and important information.

1. **Bytes stay.** Relocation uses `git mv`, which preserves content and history. Intake copies, and sealing moves whole files. Classification adds metadata and never rewrites a body.
2. **Old paths resolve.** `FORWARDING.json` maps every old path to its new path. Citations in records, ledgers, handoffs, and code resolve through it.
3. **Archives are untouched.** A ledger rewrite moves superseded text to `PROGRAM.archive.md`. It does not delete any line. A superseded decision links to its successor.
4. **Runs stay committed.** `80 Runs` holds run evidence, and cited runs are never pruned by distill. Retention classes stay cut to backlog.
5. **The lead reads every ruling.** A wrong summary of a decision is worse than none, so the lead checks each decision and amendment against its source.

The check is a deterministic script, not a model review. It runs at phase 8 and again at the end of every maintain pass. It lists every input path from the phase 1 inventory. Each path must end in exactly one state: in place, moved with a forwarding entry, or archived with a link. A path in no state is a loss. The gate refuses to install while any loss remains. The count of inputs must equal the count of accounted paths.

A findability count runs beside it. Every `.md` file outside `80 Runs` must be reachable from a generated index, and the script reports the count of unreachable files. The gate refuses to install while that count is above zero.

**Standardized order.** The register groups records by topic key, sorted. Indexes are sorted. The triage list holds one line per item with its path, rule, and entry date. Each surface is generated and gate-checked, so the order is the same on every run.

**Maintain pass.** The pass works down the baseline and the triage queue. It stops at a declared round budget and writes a checkpoint. A schedule can run it between other work. `conform` routes to `distill` when it finds drift in a state surface.

**Adoption.** Phase E runs assess-only on murmuration through `calibration-run`. Only a sanitized note returns, per the one-way channel rule. The note reports batches, review rate, defect rate, loss-check result, and tokens per phase. The real run follows the note.

## Compaction fidelity

The operator concern of 2026-09-30 is that auto-compaction may drop extremely important context. Three layers answer it, and a live check records the result.

**Layer 1, mechanical capture.** A PreCompact hook runs a snapshot script. The hook cannot steer the summary, because hosts ignore PreCompact stdout (`INFRASTRUCTURE.md:131`, OI-52 closed). The snapshot holds:

- Every operator message, verbatim, read from `transcript_path`.
- The active `TASKS.md` lines.
- The pending workers from the agent ledger, with agent ids.
- The finish line and its open `Blocks:` items.

The snapshot lands in the run folder and is gitignored with the rest of `80 Runs`. The script fails open: if it cannot read the transcript, it still writes the other three parts and says what was missing.

**Layer 2, re-injection.** The SessionStart `source=compact` branch in `routing-card.mjs` restores run state only when a session record exists; in this session none did, and the card printed no run state (see the next section). F1 adds `openItemLines()`, which prints at most 12 lines of 80 characters from `TASKS.md`. The compact branch then gains two things: it names the snapshot path, and it prints the pending workers. After a compaction the lead can name every item, constraint, and worker from the card and the snapshot alone.

**Layer 3, steering.** F1 adds a Compact Instructions section to the user-wide contract. The steering source is the documented one: a section in `CLAUDE.md` or `/compact <focus>` (`autocompact-controls.md`). `CLAUDE_CODE_AUTO_COMPACT_WINDOW=250000` sets the trigger. The desktop app honors the variable (`RUN_LOG.md:34`). No programmatic trigger exists.

**The live check recorded on 2026-09-30** (`RUN_LOG.md:38`). Auto-compaction fired in the HO 13 session after a checkpoint at about 200k. The lead ran the fidelity check from the summary and the SessionStart compact card only, before it read any file.

- Active items named: yes (OI-50, 51, 53, 54, 56, 57, with OI-52 and OI-55 closed).
- Operator constraints verbatim: yes, all five operator messages, including "maximum ever 'High' effort" and "merge when green and keep going".
- Running workers named: yes, the F1, F2, and F3 builders with branches and report paths.
- Gap: agent ids were missing from the summary. The lead resolved them through the host's task notifications.
- Caveat: no snapshot hook existed. The pass rested on the summarizer plus a checkpoint the lead wrote by hand.

One point stays open. OI-51 asks for a transcript that shows a compact boundary near 250k, and the operator owns it. The log records the observation but does not attach that boundary. The first live compaction after the snapshot PR lands repeats the check below and records its result in `MEASUREMENTS.md`.

**Failed compaction.** A compaction has failed when the host reports an error, or when the post-compaction lead misses the pre-registered check below. The session state `compacted` is derived from the `compact_boundary` records in the transcript. No file stores it.

**Pre-registered check for the snapshot.** At the first compaction after OI-56 lands, the post-compaction lead must name each active item, each operator constraint verbatim, and each running worker with its agent id. It must do so without reading any file beyond the card, the snapshot, and the `RUN_LOG.md` `Next:` line. The next section widens the check to grants, running work, and peers. A miss on any of the three fails the check and reopens OI-56. The eval `compact-snapshot` runs the same check on a fixture transcript with a known set of operator messages, items, and workers.

## Compaction snapshot and message threads

Added 2026-09-30 under DEC-76 and revised the same day from two measured reviews of this session's own transcript, which compacted twice (`reports/snapshot-overinclusion.md`, `reports/snapshot-gaps.md`). A handoff is now only for new work or a clean session that loads code-ops changes, so one session runs long and compacts many times. The operator must keep talking to the same workers and peers without repeating anything. This section designs OI-56, which absorbed OI-64. It ships as PR 2.

**What the evidence showed.** The design goal is the right context, not more context.

- Operator messages are small: 14 messages, about 570 tokens for a full day. Task notifications were 97% of the enqueue payload, and the invoked skill body was 4,858 tokens. Those are the noise, not the operator's words.
- The same open items were restored three times: the card, the snapshot, and an instruction to reload `TASKS.md` and `RUN_LOG.md` (about 3.7k tokens).
- The real losses were elsewhere. One authority grant arrived as an `AskUserQuestion` answer, not a prompt. After the second boundary the lead spent about 3k tokens and 3.5 minutes re-finding its in-flight `file:line` targets. It re-probed git state at both boundaries. A Workflow run, two background shell tasks, and a scheduled wakeup appeared in no ledger.
- Both summaries were stale on agent state: one said agents were not yet dispatched when four were running, the other said an agent owed a report after it had delivered.
- The compact card printed no run state in this session, because `sessionRecord()` (`routing-card.mjs:105`) found no session record and never reads the run folder's `SESSION.json`.

**Source of truth.** The host transcript already holds every fact the snapshot needs, and compaction does not delete it. `conversationOf(text)` in `scripts/transcript-lib.mjs` reads it. The transcript format is a host internal, so the parser lives in one function, fails open, and an eval fixture pins these observed shapes:

- Operator prompts: `queue-operation` records with `operation: "enqueue"`, excluding task notifications, `isMeta` skill bodies, command wrappers, hook context, and system reminders. Deduplicate by text. A `/skill` invocation keeps only its `ARGUMENTS` line.
- Operator answers: `AskUserQuestion` tool results, recorded as the question header and the chosen label. Grants arrive here too.
- Peer messages: `<cross-session-message from-name=... from-session=...>` inside an enqueue record.
- Outbound messages: a `SendMessage` tool use with `to`, `summary`, and `message`.
- Long-running work: an async `Agent` result (`agentId`), a `Bash` call with `run_in_background` (its task id), a `Workflow` run id, and a `ScheduleWakeup` call. A `<task-notification>` with a `task-id` and `status` closes the matching entry.

**Threads are a view, not a store.** Decision 3 holds: no message ledger file. A thread is one session peer, keyed by its full `from-session` id and named by `from-name`. It is `reply-owed` when the peer's last message is newer than the lead's last message to it, and otherwise `quiet`. There is no awaiting-reply state, because an acknowledgement expects no answer and would never clear. Workers are not threads: the running-work list covers them.

**Snapshot.** `scripts/compact-snapshot.mjs` writes `COMPACT_SNAPSHOT.md` in the session's run folder, and each write replaces the file. The budget is 3,000 tokens (12,000 characters), about 14% of a post-compaction context, split as follows. Sections, in order:

1. **Operator words** (1,200 tokens). Every operator prompt and answer, oldest first, each cut to 600 characters (head 400, tail 150, the omitted count, and the transcript line). Over budget, older messages become one-line stubs: the first 80 characters and the transcript line. Messages of 80 characters or fewer and every `AskUserQuestion` answer never become stubs, because short directives and answers carry the grants ("merge when green and keep going"). The selection uses age and length only, never keywords.
2. **Running work** (500 tokens). Each launched entry with no closing notification: kind (agent, shell, workflow, wakeup), id, type, age, description, and report path. Agents come live from the agent ledger (`scripts/agent-ledger.mjs`), so a summary can never show a stale agent state. Other work (shell, workflow, wakeup) comes from the transcript. The ledger row gains `report_path`, parsed from the brief's `Report path:` line. A `worktree` field on ledger rows stays in the backlog.
3. **Active items** (900 tokens). The unchecked `TASKS.md` lines, cut to 240 characters each and at most 16, keeping id, owner, and done-when.
4. **Peers** (300 tokens). Reply-owed threads first, each with the peer name, the full session id, the last message cut to 200 characters, and its age. Quiet threads get one line each.

Truncation order when over budget: stub older operator messages, then cut item lines, then drop quiet peers, then cut running-work descriptions. Ids, report paths, and reply-owed peers are never cut.

Five rules make the file safe to trust.

- **Atomic write.** The script writes a temporary file and renames it over `COMPACT_SNAPSHOT.md`. A reader never sees a half-written file.
- **Freshness by boundary count.** The header records the number of `compact_boundary` records in the transcript when the script ran. The card counts the boundaries again. The snapshot is fresh when the card sees exactly one more boundary than the header, because PreCompact writes before its own boundary. Any other difference marks it STALE.
- **Partial status.** A run with no readable transcript, such as a manual run, still writes the other sections. The header says `partial` and names what is missing.
- **Masking stubs.** Text passes through the redaction scanner's masking before it is written. If masking fails on a message, the script writes a stub for it (the transcript line only) and never the raw text.
- **Gitignore check.** Before it writes, the script runs `git check-ignore` on the run folder path. When the path is not ignored, it writes to the home state directory instead.

**Not in the snapshot, on purpose.** Git state and the next step change after the snapshot is written, so the card reads them live. Decisions and rejected options already live in `PROGRAM.md` and `RUN_LOG.md`. The host re-attaches recently read files and invoked skill bodies by itself, so nothing depends on that.

**Writers.**

- A `PreCompact` hook, `hooks/compact-snapshot.mjs`, calls the script with the payload's `transcript_path` and `session_id`. It exits 0 on every path, never blocks compaction, and prints nothing, because the host ignores PreCompact stdout. `CODE_OPS_COMPACT_SNAPSHOT=0` turns it off.
- `co snapshot` runs the same script by hand. It is the fallback on a host whose PreCompact payload is unverified or absent, and the lead runs it at each 150,000-token assessment there.
A `co threads` command, which would print the peer view mid-session without writing, is deferred to the backlog.

**Restore.** The SessionStart compact card is the only automatic re-injection, and it prints only what the snapshot cannot hold or what is live:

- **Run folder fallback.** When no session record exists, the card finds the run folder whose `SESSION.json` names the payload `session_id` or `hostSessionId`, and prints the item lines. The fallback ships in PR 1.
- **One live git line.** Branch, short HEAD, and the dirty-path count.
- **The latest `Next:` line from `RUN_LOG.md`.** The lead writes one at each assessment and phase boundary: the in-flight step, its next command, and the `file:line` it edits.
- **A `Snapshot:` line.** The line reads `Snapshot fresh` or `Snapshot STALE`, by the boundary-count rule above. When fresh, it gives the path and counts (operator words, running work, active items, reply-owed peers) and states that the snapshot outranks the summary on running work and peers. When stale or absent, as on hosts with an unverified writer, the card prints the item lines instead, as it does today.
- **Active count.** The line `active N/12 (last snapshot M)` carries a GROWING flag when N exceeds M, and an OVER CAP flag when N exceeds 12.
- **Pending agents**, always live from the ledgers, even when the snapshot is fresh.
- **Reply-owed peers**, at most 4 lines, even when the snapshot is fresh, because an unanswered peer is the costliest miss.

The card stops telling the lead to reload `TASKS.md` and `RUN_LOG.md`. The reload order in `global-contracts/AGENTS.md` (line 142) changes to start from the card. The lead reads the snapshot, one bounded file of at most 3,000 tokens. The Compact Instructions in the user-wide contract drop the verbatim-request bullet in favour of one line each, because the snapshot holds the words, and add the next command.

**Host parity.**

| Host | Snapshot writer | Restore |
| --- | --- | --- |
| Claude | PreCompact hook | SessionStart `compact` |
| Codex | PreCompact hook, gated on a captured payload (PR 5); until then `co snapshot` | SessionStart `compact` projected, gated on the capture |
| Grok | PreCompact hook, gated on a captured payload (PR 5); until then `co snapshot` | instruction files and the PostToolUse note, gated on the capture |
| OpenCode | `experimental.session.compacting` (`scripts/opencode-lifecycle.js:1433`) runs before the summary. It pushes the `TASKS.md` lines, pending dispatch rows, and the snapshot path into the compaction context (PR 3) | `session.compacted` and the lifecycle plugin port |

A Codex or Grok row that fails its capture keeps today's behavior and drops out of the row.

**Handoff.** `handoff draft` warns and lists each reply-owed peer, because a new session cannot answer a message sent to the old one. A question lost at a handoff is CONFIRMED in murmuration (`reports/peer-comms.md`). The draft seeds its running-work list from the snapshot.

**Evals.** `evals/compact-snapshot` is the only eval name for this section. It uses synthetic transcripts that cover each record shape above. It includes the noise shapes that must be excluded: task notifications, `isMeta` bodies, and duplicate wrappers. It checks the section budgets and the truncation order, that an `AskUserQuestion` answer survives as an operator word, and that a running entry closes on its notification. It also checks the peer states, the off switch, fail-open on a malformed line, the run-folder fallback, and the fresh and stale card forms. Three cases are required: a stale second compaction, a masking failure, and the fallback.

**Verification.** The pre-registered check repeats at the first compaction after this PR lands. The lead may read the card, the snapshot, and the `RUN_LOG.md` `Next:` line, and nothing else. From those alone it must name every active item, every operator constraint and grant verbatim, every running entry with its id and report path, every reply-owed peer, and the next command. The check also counts re-reads in the first 30 tool calls after restore. Anything above zero for state the snapshot should hold reopens OI-56.

## Peer coordination between programs

Added 2026-09-30 from a read-only probe of the Data Quality and Single Tap sessions in murmuration since 2026-09-24 (`reports/peer-comms.md` in the HO 13 run folder). Two programs that share one repository must agree on shared surfaces without the operator carrying messages between them.

**What the evidence showed.** The channel works at volume, and the gaps sit at its edges.

- CONFIRMED: the two programs sent 705 messages over 194 hops. 680 had a matching delivery. The median reply came in 70 seconds, the 90th percentile in 770 seconds.
- CONFIRMED: there were no merge conflicts. Shared areas were negotiated by message before each merge, and 23 collision notes fired on `git push` or `git merge` to `main`.
- CONFIRMED: 17 operator prompts relayed between the programs, for example "inform single tap" and "confirm with data quality". One supplied a live session name right after a blocked send.
- CONFIRMED: the peer guard blocked sends to handed-off sessions at least 4 times, and it named the successor each time. Under DEC-76 handoffs are rare, so this path shrinks.
- CONFIRMED: one question was lost when its sender handed off before the reply.
- CONFIRMED: a test verifier in one program ran `taskkill /F` on every python process on the shared host.
- CONFIRMED: Single Tap read the Data Quality ledger in 4 sessions. Data Quality never read the Single Tap ledger. Agreements lived only in message text.

**Root cause.** Neither program declares what it shares with the other. The collision note fires only after a peer edited the same path in the last 6 hours (`scripts/collision-lib.mjs:7-17`). A negotiated surface, such as a ConfigMap or an ingest pin, has no recent peer edit, so the session asks the operator instead.

**Design.** Four small changes, all warn-only, like the collision notes they extend.

1. **Declared peers.** `PROGRAM.md` gains an optional `## Peers` section. Each line is `- <program slug> · Surfaces: <path or glob>, ... · Notify: edit|merge`. A surface can also be `process:<name>` for a host process the peer depends on.
2. **Surface notes.** `collision-lib.mjs` reads the session's program ledger. An edit to a declared surface, or a `git merge` or `git push` whose diff touches one, prints one note: the live peer session name, resolved the way `co handoff live` resolves it, and a ready `SendMessage` line. A shell command that kills processes (`taskkill`, `pkill`, `kill`) while a live peer declares a `process:` surface for that name prints the same kind of note. The note fires once per surface and peer per session.
3. **Peer names on the card.** The startup and compact cards print one line per declared peer: its live session name and whether any thread with it is reply-owed. A session then never needs the operator to supply a name.
4. **Agreements in both ledgers.** A cross-program agreement is a decision entry with an `Agreed-with: <program slug>` line, recorded in both `PROGRAM.md` files with the same text. `check-handoff` warns when an `Agreed-with` entry has no counterpart in the peer ledger.

The handoff draft reply-owed warning moves from backlog into PR 2, because a lost question at handoff is CONFIRMED.

**Not in this design.** No new message store, no blocking gate, and no automatic sends. The operator still decides what to agree to. The peer guard and the board stay as they are.

**Finish line (proposed F8, needs an operator DEC).** Across an operator-set window in murmuration after the plugin sync, Data Quality and Single Tap need zero operator relays, leave zero peer questions unanswered at a handoff or session end, and send zero messages to a finished session. A sanitized note from the same probe records the counts.

**Delivery.** PR 9, after PR 2 and in parallel with PR 4: the `## Peers` parser, the surface and process notes in `collision-lib.mjs`, the card peer lines, and the `Agreed-with` warning. The eval `peer-surfaces` covers a declared surface with no recent peer edit, a merge whose diff touches a surface, a process kill with a declared `process:` surface, a peer that handed off, and the off switch. Seeding the `## Peers` sections in the two murmuration ledgers is operator work in that repository.

## Delivery

Revised 2026-09-30 from the plan judge panel (three designers, three adversarial reviewers, one synthesis; `reports/plan-judge-panel.json` in the HO 13 run folder). Each PR follows the `AGENTS.md` rules: plugin version bump, CHANGELOG entry, regenerated host distributions, atlas stamp, and manifest sync. The plan is 7 required PRs after PR 0, 1 conditional PR, and 2 runs, with at most 12 active items.

| PR | Scope | Closes | Evals and gates |
| --- | --- | --- | --- |
| 0, built | Compaction default and compact re-inject, finish line with `Blocks`, 12 cap, backlog and burn-down line, agent ledger hook, `co agents pending`, and the draft refusal. Merged as https://github.com/skylarsabo/code-ops/pull/206 | OI-50, OI-53, OI-54; F2 | `handoff-card`, `handoff-check`, `handoff-convergence`, `agent-ledger`, `bench-hooks` |
| 1 | Pending workers on every host. `pendingAgents` always merges hook rows with dispatched `DISPATCH_LEDGER` rows, deduped on actor id, and names the sources read. It prints `unknown` only on a host signal. `co agents settle <id> --failed --reason <text> [--session <id>]` appends a failed row, and the draft refusal names it. The compact card finds the run folder by `SESSION.json` when `sessionRecord()` is null. SessionEnd and the next startup card flag pending workers. A dependency-free active-items counter feeds a read-only `co burndown`. The agent-ledger hook gains an env-gated payload capture (key names only) before the Grok early return | OI-58, OI-66 instrument; F3 except host rows | `handoff-check` cases per host form, `agent-ledger` (lost stop, then settle), `handoff-card` (fallback case), lint chain |
| 2 | Compact snapshot as specified in "Compaction snapshot and message threads", plus the handoff draft reply-owed warning (see "Peer coordination between programs") | OI-56; F1 after the live check | `compact-snapshot` (stale second compaction, masking failure, fallback), `handoff-card`, `codex-marketplace`, `grok-build-compat`, lint chain |
| 3, parallel with 1 and 2 | OpenCode `assertDispatchModel` at `tool.execute.before`, unconditional, in the order live list, cache filtered by conditions 2 to 4, lead clone at floor, deny. `experimental.session.compacting` pushes the active items, pending dispatch rows, and the snapshot path | OI-59; F6; the OpenCode F1 row | `opencode-enabled-models`, `build-opencode-dist.mjs --check`, lint chain |
| 4, after 2 | State machine contract: entity and transition tables in `CONTRACTS.md`, with lint checking statuses against `LEDGER_STATUSES` and a writer on every row. The dispatch guard checks `agentType` on each `agent()` call and denies a literal effort above `high`. One unpinned Workflow section in three `CONVENTIONS.md` files, cited by the named skills | OI-60 (absorbs OI-61); F5 | lint and `evals/lint-plugins`, dispatch-guard eval |
| 5, conditional | Host rows from captured payloads: the Codex spawn name in `DISPATCH_TOOLS`, the Grok agent ledger once `agent_id` is confirmed, and PreCompact `transcript_path` on Codex and Grok. A host that fails its check keeps today's behavior and leaves that row | OI-67 | fixture-pinned payload evals, `grok-build-compat`, `codex-marketplace` |
| 6 to 8 | `distill`: program mode (6); phases 1 to 5 and 7 with the no-loss script, the findability count, and the Workflow branch for phases 3 and 7 (7); install, maintain, and `conform` routing (8) | OI-62; part of F7 | `node evals/score.mjs <ANSWER_KEY> --check`, `register-staleness` |
| 9, after 2 | Peer surfaces, as specified in "Peer coordination between programs" | OI-65; F8 if accepted | `peer-surfaces`, lint chain |
| Runs | Murmuration assess-only distill calibration; the F4 window note after the plugin sync | OI-63, OI-66; F7, F4 | sanitized notes only (one-way channel) |

**Parallelism.** PR 3 builds in its own worktree beside PRs 1 and 2. PR 4 waits for PR 2, because both edit `CONTRACTS.md`. At each integration, the dist regeneration, atlas stamp, and manifest sync run one branch at a time.

Rules that hold across the stack:

- No answer key ever enters the context handed to a skill under eval.
- PRs 2, 3, and 5 are the risk surfaces. Each has a live-payload check. A failing check keeps today's behavior and drops the host from that row.
- Gate scripts gain checks only. No PR weakens or narrows one.
- Each PR merges on a green hosted gate. A model review gate runs only when the operator asks for it.

### Pending operator decision

The panel proposed these changes. They wait for an operator DEC, because a gitignored ledger edit cannot move an operator-set finish line. The Finish line and decision 6 above stay as accepted until then.

- F1: "The compact card restores run state with or without a home session record. The first live compaction after PR 2 passes the pre-registered check ... On Codex, Grok and OpenCode, the restore names the active items and pending workers ... Each host row is verified from a captured payload, or it is dropped with a recorded reason."
- F3: "On every host, each dispatch and report is recorded, from hook rows merged with dispatch rows. `handoff draft` refuses a pending worker and names `co agents settle` and `--pending-agents-ok`. A session that ends with a pending worker is flagged at SessionEnd and on the next SessionStart card."
- F4: "data-quality and single-tap-cutover each hold at most 12 active items, with no net growth and 0 orphaned agents (pending past maxAgeMs), across an operator-set window that starts after the plugin sync in murmuration. `co burndown` reports this, in a sanitized note."
- Decision 6 becomes "flag a pending worker at SessionEnd and the next SessionStart". Without it, F3 needs a new blocking Stop hook.
- F8, new: see "Peer coordination between programs".
- The C5 merge driver and the `integrate-branch` docs step: keep them in PR 8, or move them to backlog.
- The F4 window: its length, and who runs the plugin sync in murmuration that starts it.

### Backlog

- `co threads`.
- A `worktree` field on ledger rows.
- An acceptance unit id and a `check-handoff` pending refusal. The refusal clashes with `--pending-agents-ok` (`handoff-state.mjs:658`).
- Workflow run ids in the agent ledger. The snapshot covers them on Claude.
- A split of PR 7 into relocate and classify-to-synthesis, if review strain shows.
- Retention classes and gate step 7 (OI-16).

### Rejected in the judge panel

- A `reported-empty` status (correctness P3). Transition 5 already runs the report-shape gate (`dispatch-ledger.mjs:459`), and the status would block routinely, because the lead writes reports.
- An age limit on the OpenCode cache (correctness P9). The cache is filtered at dispatch and rewritten only on change, so an age limit denies valid dispatches.
- A Grok compaction relief (parity P5). It rests on an unverified Grok window, gives Grok the weakest restore, and reopens DEC-73 with no new evidence.
- Folding program mode into distill phases 1 to 7 (parity P10, convergence P6). It builds the largest PR and saves no handbook work.
- A weaker F2 wording (correctness P10). The card counter fixes the check instead.
- A store rearchitecture and a card cap of 12 (correctness P4). The card already prints shown-of-total (`routing-card.mjs:132`), and a cap of 12 would drop items 13 to 16.
- An OpenCode agent-ledger writer (parity P1). Foreground tasks settle at launch (`agent-ledger.mjs:90`), and dispatch rows cover OpenCode.

## Risks and open questions

**Risks.**

1. A PreCompact hook may not fire, or may carry no `transcript_path`, on Codex and Grok. The snapshot then has no operator messages on those hosts. Mitigation: the lead runs the snapshot script at each 150k assessment.
2. The OpenCode check may block early dispatches if both the live list and the cache are empty. Mitigation: the denial message names the restart step, and the eval covers the path.
3. Hook and ledger drift: the agent ledger and the dispatch ledger can disagree. Mitigation: `check-handoff` reports the disagreement and does not repair it.
4. Distill at scale strains lead review. The lead reads 51 decision records and about 39 sampled records. Mitigation: batches of 25, a full review after one sample defect, and a stop at the round budget.
5. Workflow workers may not fire the hooks. Mitigation: the lead reconciles from returned results.
6. The pending-worker rule may block a handoff for a worker the operator wants to abandon. Mitigation: `co agents settle <id> --failed --reason <text>` records the `failed` transition with its reason (PR 1).

**Open questions.**

1. Does the F3 `agent_id` equal the dispatch ledger `--actor-id`? The F3 ledger stores the host agent id from the launch result and the SubagentStop payload. The dispatch ledger `--actor-id` is whatever the lead passes, so readers join only when the lead passes that host id.
2. Who writes `failed` in the agent ledger? The F3 hook writes it when the SubagentStop payload carries `error`, `is_error: true`, or an error status. That host field is UNVERIFIED, so the lead still marks `failed` where the hook cannot.
3. Do SubagentStart and SubagentStop fire inside a Workflow? Needs one live run under operator opt-in.
4. Does `client.config.providers()` honor `enabled_providers` and `disabled_providers`? Needs the live-payload check.
5. Does `opencode models` honor the enable and disable lists? This design does not depend on it.
6. Which decision counts are right for murmuration: 180 and 156 lines in 9 and 5 files, or 136 across 4 ledgers? Phase 1 of the backfill settles it.
7. Which phases of `codebase-audit` fan out independently? The skill was not read for this draft.
8. Is the agent ledger path under the run folder? No. It is `~/.claude/code-ops/agents/<sha256 of session id>.jsonl`, and the hook honors `CODE_OPS_HOME`.
9. Do Codex and Grok deliver `transcript_path` to a PreCompact hook? No captured payload exists.

## Decisions to accept

The operator accepts or rejects each line. Numbers here are draft numbers. They take `DEC` ids on acceptance.

1. Adopt the entity and state tables above as the contract, and store each state in its existing store.
2. Keep `reported` terminal for a dispatch row. A rejected unit opens a new row that cites the old one.
3. Derive accepted, stale, idle, and abandoned from existing records. Store none of them.
4. Keep the agent ledger and the dispatch ledger separate, and join them on actor id in readers.
5. Require every transition to have a host-neutral script, and treat hooks as accelerators only.
6. Block a handoff and a clean stop while any worker is pending, on every host.
7. Build the PreCompact snapshot (OI-56) after F3 merges, and name pending workers in the compact re-inject.
8. Treat PreCompact stdout as ignored, and steer the summary only through Compact Instructions.
9. Enforce OpenCode enabled models in one function at `tool.execute.before`, unconditional and fail-closed, using the cached catalog when the live list is null.
10. Deny a dispatch when the profile list names no available model, and keep the startup warning.
11. Skip a build-time model filter in `build-opencode-dist.mjs`.
12. Offer the Workflow branch to `distill`, `codebase-audit`, and design and planning work on Claude, only on operator opt-in (amended at acceptance, DEC-75), with `agentType` a suite agent and `effort` at most `high` on every `agent()` call.
13. Add no new Workflow flag or environment variable.
14. Keep `distill` at full W7 scope with program mode first, and add the phase 8 no-loss check as a hard gate.
15. Keep retention classes and gate step 7 in backlog.
16. Deliver in the revised order: PR 0 built, then PRs 1 and 2 in order, PR 3 in parallel, PR 4 after PR 2, PR 5 on capture, PRs 6 to 8, and PR 9 after PR 2 (amended 2026-09-30 by the plan judge panel).

Decision 6 and the finish line wait on the operator decision listed under "Delivery".

## Rejected alternatives

- **Event-sourced journal (SESSION.jsonl with folds and projections).** It duplicates `.journal.jsonl` and the runtime receipts. Every tool call would append to it on four hosts. It needs a migration and leaves two sources of truth. Its transitions named commands that do not exist (`run-contract.mjs accept`, `dispatch-ledger.mjs redispatch`), and it moved a worker out of `reported`, which the grammar forbids. Kept from it: versioned records and unknown kinds as no-ops, and the per-host compaction event table.
- **Workflow-native runner scripts (`runner-codex.mjs`, `runner-grok.mjs`, `runner-opencode.js`).** On every host the model calls the spawn tool. A script or hook only observes or rewrites. No host lets a script spawn a worker and poll it. OpenCode has no subagent-finish event. A Workflow script also cannot write `phase-journal.json`, because it cannot touch the filesystem. Kept from it: phase checkpoints with resume for distill, and `agentType` plus `effort` on every `agent()` call.
- **Hooks that write `DISPATCH_LEDGER.md` rows.** `add` needs `--brief`, `--artifact`, and under a version 4 contract `--actor-id`. The ledger is lead-written by design. F3's separate agent ledger gives the hook its own store.
- **A `--workflow` flag, `--enable-workflows`, or `CODE_OPS_USE_WORKFLOWS`.** None exists in the repository. The guard reads only `agentType`.
- **A fail-open model check when the live list is unavailable.** It turns a new gate into a weakened one. The cached catalog and a denial replace it.
- **A build-time enabled-models filter as the main fix.** It goes stale when the operator changes settings after the build.
- **A 225k handoff point with a routing card at 225k.** DEC-73 replaces it with auto-compaction at 250k. F1 keeps it for Grok only.
- **Stored `accepted` and `rejected` ledger statuses.** They would break the terminal `reported` rule and add a migration. The acceptance ledger already holds the verdicts.
- **Per-program distill as a replacement for the backfill.** The operator amended the plan review to keep the full scope. Program mode stays as the first mode.
- **Runner-style session states such as INIT to END with round budgets as events.** The existing band marker and round counter already cover them.
