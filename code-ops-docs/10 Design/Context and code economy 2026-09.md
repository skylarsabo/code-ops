---
type: design
status: draft
updated: 2026-09-02
tags:
  - design
  - roadmap
  - token-economy
---

# Context and code economy 2026-09

Source: an ad-hoc research pipeline run on 2026-09-02 (one explorer over the suite, web reads of the three upstream repositories and the Fable 5.1 prompting guide, and a transcript measurement over this repository's own sessions). No existing skill fit a four-source comparative brief, so the pipeline was hand-assembled and is declared here. This note proposes. Nothing in it is committed work.

Verified-at: a9105a8 (2026-09-02)

## Overview

Three open-source tools and one vendor guide each attack a cost the suite already pays:

| Upstream | What it attacks | Suite mechanism today |
| --- | --- | --- |
| rtk (rtk-ai/rtk) | Bash output volume entering the context | None. No hook touches tool output (GAP-1, GAP-2 below). |
| ponytail (DietrichGebert/ponytail) | Over-built code from agents | One sentence in `normalize` and "smallest correct change" prose (GAP-3, GAP-4). |
| codegraph (colbymchenry/codegraph) | File-by-file discovery cost | `repo-map.mjs`, `import-graph.mjs`, `context-snapshot.mjs`, `context-bundle.mjs`. No query interface, no call edges. |
| Fable 5.1 prompting guide | Behavior drift on the current model | Doctrine written against Opus-era behavior. Some guidance is present, some is absent. |

The plan keeps every upstream idea that survives contact with the suite's rules (zero npm dependencies, fail-loud never silent truncation, receipts over narration, quality-first tiering) and rejects the parts that would degrade quality. Four workstreams share one measurement spine, and each mechanism must beat the no-mechanism control under the pre-registration protocol in `evals/README.md` or it is removed.

One reading of the request: "make this our own while increasing token costs" is read as decreasing token costs. Every workstream below lowers cost or is dropped.

## Baseline measurement

Scratch measurement over the 23 session transcripts for this repository, run 2026-09-02 (character counts, bytes divided by four as the token estimate, the same approximation rtk uses):

| Slice | Share of context |
| --- | --- |
| Tool results (all tools) | 54.9% |
| Bash results | 29.3% |
| Read results | 15.9% |
| Agent (operative) reports | 5.9% |
| Assistant text | 9.2% |
| Thinking | 9.7% |
| User and system text | 26.2% |

The fifteen largest single results were dominated by Reads of the suite's own generated artifacts: task output files, a findings register, `REPO_MAP.md` at 52k characters, and a cached `CONVENTIONS.md`. Among Bash results, the largest families were compound commands prefixed with `cd <repo> &&`, then `git diff`, `gh pr`, `git show`, and `sed -n` file reads through the shell.

Two conclusions shape the plan. First, rtk's target (chatty git and test output) is real here but second-order. The first-order cost is whole reads of large artifacts and compound shell commands, which rtk cannot touch. Second, the measurement itself was cheap and repeatable, so it becomes the first deliverable.

## Goals

- Cut tool-result bytes entering any context by a measured margin with zero loss of load-bearing content, proven by a deterministic must-keep eval.
- Make every compressed output a provenance receipt, so token economy and "I ran it" proof are one mechanism.
- Give operatives a bounded query interface over the code index so they stop reading whole maps.
- Add a code-economy ladder that lowers line count only as a tie-breaker behind correctness, module boundaries, measured performance, and readability, with a mechanical over-build scanner scored against decoys.
- Align skill, agent, and doctrine prose with the Fable 5.1 prompting guide where the guide's tested instructions apply.

## Non-goals

- A file-watcher daemon, a global binary, or any tree-sitter or SQLite dependency. Node builtins only.
- Telemetry of any kind.
- Intensity modes (lite, full, ultra). One rule set, overridable per brief.
- A per-turn persona injection. The suite pays for doctrine once per brief, not once per turn.
- Rewriting Read, Grep, or Glob calls in the first slice. Whether `updatedInput` applies to them is an open question below.
- Command-specific filters for a hundred tools. Shape detection covers the long tail.

## Design

### Workstream A. Output economy: compress at the source, keep the receipt

**What rtk does that is novel.** A PreToolUse rewrite that turns `git status` into `rtk git status`, backed by a shell-aware lexer that splits compound commands safely and leaves pipelines and redirects alone. Per-command filters as TOML files with inline tests, concatenated at build time. Tee of the raw output to disk with a `[full output: path]` hint on failure and on truncation, including a `tail -n +offset` hint that jumps to the first hidden item. A `discover` command that replays session JSONL to find commands that could have been filtered. A `learn` command that mines fail-then-succeed pairs into correction rules. A trust store keyed by content hash for project-local filters.

**What does not survive.** Command-keyed filters need a handler per tool and miss everything else. Savings are reported as bytes over four with no tokenizer. Read, Grep, and Glob bypass the hook. A lossy filter can hide the one line that mattered, and the guard list (`gh --json`, `cat` with flags, redirects) shows how fragile rewriting is. The rewrite changes what the agent asked for without telling it.

**Our design.**

1. **Shape-keyed digest.** `scripts/digest.mjs -- <cmd>` runs the command, classifies the output by shape (test runner, compiler or linter diagnostics, unified diff, log stream, table, JSON, file listing, stack trace, progress noise, plain text), and applies generic stages: ANSI and carriage-return progress stripping, duplicate-line folding with counts, common path-prefix factoring, stack-trace folding that keeps in-repo frames, diagnostic grouping by file and rule, diff hunk budgeting that keeps headers and changed lines, JSON shape summaries (keys, types, one sample), long-line truncation, and a tail cap. Command-specific overrides exist only where shape detection is insufficient (`git status`, the major test runners). Unknown shape means passthrough under a cap. Every stage announces what it elided and where.
2. **Receipt, not tee.** The digest writes the raw output under the run's artifact directory and appends a row compatible with `run-proof.mjs` (timestamp, HEAD sha, exit code, sha256, bytes before and after). The compressed output ends with one line: `[full: <path> · <n> lines · sha256:<8>]`, and each elided region carries an addressed recovery hint (`sed -n 'a,bp' <path>`). Rows recorded through a shell are flagged so `verify` skips replay rather than refusing the ledger.
3. **Loss-bounded by contract.** Each shape declares a must-keep set: the exit code, every error or failure line, the final N lines, and the counts of everything elided. A compressed output that drops a must-keep token is invalid. A deterministic eval (`evals/digest/`) holds a corpus of raw outputs with must-keep assertions and scores compression ratio subject to full retention. Ratio never trades against retention.
4. **Hook wiring.** The existing PreToolUse Bash hook gains a second stage that rewrites an allowlisted simple command to `node <root>/scripts/digest.mjs -- <cmd>` through `updatedInput`, with `additionalContext` telling the model the output is digested and where the full text lives. The first slice wraps only simple commands (no pipes, no `;`, no heredocs, no file redirects, no `--json`). The transcript baseline shows `cd <repo> && <cmd>` is the dominant compound form, so the second slice adds that one pattern before any general lexer. Latency budget is fifty milliseconds, measured with `benchmark-command.mjs`. The hook is opt-in per repository until Phase 5 measurement clears it.
5. **Read-side economy.** `scripts/skim.mjs <file>` prints an outline (headings, definitions, line ranges, size) so an operative reads a range instead of the file. Operative reports (5.9% of context) are checked with `scan-narration.mjs` at return time. `tracer.md` gets the density clause the other agents already carry (GAP-6).
6. **Retrospective audit.** `scripts/context-audit.mjs` generalizes the scratch measurement: share by tool, Bash families with `cd X &&` stripped, largest results, repeat reads of the same path in one session, and the estimated compressible share by shape. It runs against local JSONL only and writes a sanitized table. The `corrections` mode mines fail-then-succeed Bash pairs into candidate lines for `shell-discipline.md`, rtk's `learn` idea with the output routed into existing doctrine instead of a new rules file.

**Why this is better, not just different.** rtk saves bytes and hopes nothing important was in them. The digest saves bytes, proves what it kept, and leaves a replayable receipt. rtk needs a handler per command. The digest needs a detector per output shape, and the long tail passes through under a cap. rtk cannot see Reads. The skim tool and the query interface in Workstream C attack the 16% rtk cannot reach.

### Workstream B. Code economy without the basic-code trap

**What ponytail does that is novel.** A seven-rung decision ladder that runs after understanding the problem: need, reuse, stdlib, platform, installed dependency, one line, then minimum build. A safety floor the ladder never crosses (trust-boundary validation, data-loss error handling, security, accessibility, one runnable check per non-trivial change). A `ponytail:` comment convention that names a ceiling and an upgrade path, harvested by a debt command. Injection through SessionStart, UserPromptSubmit, and SubagentStart hooks, because SessionStart context never reaches subagents. An honest agentic benchmark (real repository, twelve tasks, diff line counts, tokens, time, correctness gate).

**What does not survive.** A persona injected every turn costs tokens every turn, and ponytail's own caveat is that reasoning models spend thinking tokens deliberating rungs. Nothing mechanical measures the code, so the effect is prompt-only. Line count is the objective, and the rung "can this be one line" pulls toward clever code. Modularity and performance are not in the objective at all.

**Our design.**

1. **Ordered objective, size last.** The suite's objective is ordered: correctness and the safety floor, then module boundary integrity, then measured performance on hot paths, then readability, then size. Fewer lines wins only between candidates equal on the first four.
2. **The suite's ladder.** Understand first (trace the real flow, cite `file:line`). Does it need to exist (scope is the request). Does it exist here (rung two queries the index from Workstream C). Does the standard library, the platform, or an installed dependency do it (verified through `current-docs`, never from memory). Does it fit inside the owning module (extend the module rather than add a file). Extract only on evidence (a second caller, a unit that needs its own test, or a file past the repository's own measured size norm). Then the minimum edge-case-correct implementation. Never trade algorithmic complexity for brevity on a path `benchmark-command.mjs` has measured hot. Mark a deliberate simplification with a `deferred(<ceiling>, <upgrade path>)` comment.
3. **Where the ladder lives.** One paragraph in each `CONVENTIONS.md` implementation loop, pinned through `SHARED_PASSAGES`. One "Size discipline" line in `dispatch-brief-template.md` for implementer briefs. A SubagentStart hook that injects a card of at most ten lines only for implementer-class agents, because SessionStart context does not reach subagents. The card runs as a measured experiment arm and is kept only if it beats the brief-only control.
4. **Mechanical scanner.** `scripts/scan-overbuild.mjs --git <range>` reports deterministic tells on a diff: new files against changed lines, an interface or abstract class with one implementor, pass-through wrappers whose body is a single forwarding call, a new dependency in a manifest with no decision record, test files beyond the neighbors' norm, configuration keys with no reader, a new helper whose name already exists as an export, and commented-out code. It is advisory in the ship review and blocking only for the new-dependency tell.
5. **Decoys protect modularity.** A fixture `evals/overbuild-garden/` plants over-builds and decoys. The decoys are legitimate extractions with two callers, a genuinely needed interface, and a test file that matches its neighbors. The scanner is scored for recall and decoy rate, like `hasty-code`. A scanner that flags good extractions fails the eval.
6. **Deferral harvest.** `deferred(...)` markers are harvested into a register that `revalidate-register.mjs` already understands, so a deferral carries a route back.
7. **Review lens.** A "size and boundary" lens joins the `pr-review` lens table, and rule F in `normalize` is strengthened to cite the ladder.

**Benchmark.** Adopt ponytail's agentic method (real tasks, diff line counts, tokens, time, correctness gate) and add what ponytail omits: function size distribution against the repository norm, import-graph fan-in and fan-out delta, and a hot-path benchmark. Success is line count down, correctness unchanged, boundary metrics unchanged, hot-path time unchanged.

### Workstream C. A query-able index that costs less context than codegraph

**What codegraph does that is novel.** A tree-sitter graph for twenty languages in SQLite with FTS5. One MCP tool, `codegraph_explore`, that answers a structural question in one call with verbatim source grouped by file, call paths, and a blast-radius summary. Native file watchers with debounced sync and a per-file staleness banner. Framework route linking for seventeen web frameworks. A benchmark with the CLI blocked in both arms.

**What codegraph admits.** Its responses leave about 80% more retrieval context resident at session end than a file-reading agent, because one dense verbatim payload stays in the window. On repositories where discovery is cheap, cost is near even.

**What the suite has.** `repo-map.mjs` (definitions by regex, forty per file), `import-graph.mjs` (module edges, one-hop focus), `context-snapshot.mjs` (content-addressed cache with `delta`), and `context-bundle.mjs` (a byte-budgeted bundle that fails loud). Missing: symbol-level call edges, any query interface, incremental refresh inside a session, and full-text search. The baseline shows the cost of the gap: `REPO_MAP.md` was read whole at 52k characters.

**Our design: pointers over payloads.**

1. **Query CLI.** `scripts/context-query.mjs` over the snapshot cache: `find <symbol>`, `callers <symbol>`, `callees <symbol>`, `blast <path>`, and `explore "<terms>" --budget <bytes>`. Results are `file:line` anchors, one-line signatures, and edge lists. Verbatim bodies are opt-in (`--with-source`) and budget-capped with the `BUDGET_EXCEEDED` semantics of `context-bundle.mjs`. The agent reads the ranges it needs. This attacks codegraph's residency cost and the suite's whole-map reads in one move.
2. **Call edges, honest ceiling.** Heuristic call extraction per language (an identifier followed by a call, resolved against the definition index within the file first, then across import edges). The ceiling is stated in the output: no dynamic dispatch, no type resolution. Optional providers raise fidelity when present: if `codegraph` or `universal-ctags` is installed, `preflight.mjs` detects it and the query tool ingests its output as data. Never required, never an npm dependency.
3. **Incremental refresh.** `context-query.mjs refresh` re-indexes only changed files through the content-addressed cache. A PostToolUse hook on Edit and Write triggers the refresh. No daemon.
4. **Staleness banner.** A query whose result touches a file edited since its last index says so, the way codegraph does, so the agent reads the live file.
5. **Consumers.** Operative briefs point at the query tool instead of the map. Ladder rung two in Workstream B calls `find`. `skim.mjs` in Workstream A shares the definition index.
6. **Later.** An MCP wrapper so non-Bash hosts get the same tool. Framework routes as a provider.

**Benchmark.** Replicate codegraph's method on the fleet's own repositories: one architecture question per repository, with and without the query tool, tool calls, tokens, time, and resident context at session end. The last metric is the one codegraph loses on and the one this design targets.

### Workstream D. Fable 5.1 prompting alignment

The guide's tested instructions map onto suite prose as follows. A grep on 2026-09-02 found no narration suppressors, no anti-formatting rules, and no batching guidance in the agent definitions.

| Guide section | Suite change |
| --- | --- |
| Consider all effort levels | Re-run the effort sweep. The guide says level names do not map across models, `medium` roughly matches Fable 5, and `low` competes with Opus and Sonnet on cost per task. Update `subagent-trade-offs.md`, `model-tiers.mjs`, and the routing card. Keep "never low on review". |
| Progress updates | No suppressors found. No change beyond the verification note. |
| Batch independent tool calls | Add the batching sentence to every agent definition and to the return section of `dispatch-brief-template.md`. |
| Append-only history | Add to `context-hygiene.md`: never edit earlier turns, send per-turn reminders as turn-scoped messages, compact by replacing the whole history. Cheaper cache reads move the compaction point later. Apply the same rule to `run-runtime.mjs` prefixes and the local runtime controller. |
| Writing density | Add the mannered-prose definition to `writing-standard.md`. Add a mannered-prose tell list to `scan-narration.mjs` as advisory. |
| Formatting in chat | Add the conditional formatting rule to `writing-standard.md`. |
| Quoting retrieved sources | Add the one-example pattern to the researcher `CONVENTIONS.md`, `gatherer.md`, and `claim-checker.md`. |
| Finish the whole task | The "we don't close early" doctrine already aligns. Add the last-paragraph check as one shared passage. |
| Compaction summaries | Adopt the six-item preservation instruction into the `handoff` template. Add a PreCompact hook that injects it as `additionalContext`. |
| Keep changes and tests to the task | Adopt the block into implementer briefs for `ship`, `feature-implementation`, `fix-verified`, and `remediation`. It is the evidence-backed core of Workstream B. |
| Search triggering at low effort | Raise `gatherer` and `explorer` to `medium` when the brief is sourcing, or add the verify-the-name nudge. Update the effort doctrine. |
| Safeguard false positives | Verifier and bug-hunt briefs ask "are there bugs", never "does it compile". The digest strips base64 blobs, which the guide names as a trigger. |
| Targeted edits | Add the surgical-edit line to `mech.md` and every implementer agent. |
| Long outputs at xhigh and max | Already doctrine (lead runs high, xhigh only on disputes). Add the `max_tokens` note to the local runtime. |
| Lead keeps working | Dispatch operatives in the background by default and continue independent work. Update `subagent-trade-offs.md` and the brief template. |
| Vision | Not applicable. |

### Workstream E. Measurement as receipts, not telemetry

The steer on 2026-09-02: measurement is wanted as a resume-grade evidence base, but nothing may add model tokens or egress. The model evals are the only measurement today.

The zero-cost source already exists. Every assistant message in the host's local session transcript carries exact usage: `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`, and `thinking_tokens`. The transcripts also carry the model id per message. Reading them costs no model tokens and leaves the machine never.

1. **Session receipts.** A `SessionEnd` hook appends one row per session to a local ledger: model, turns, tool calls by tool, exact tokens by class, wall time, and the run slug when one is active. No hook output reaches the model.
2. **Instrumented calibration.** `calibration-graph.mjs` accepts the ledger row instead of a hand-entered note, which closes GAP-5. The `confirmedPer100kTokens` metric becomes measured.
3. **Arms by construction.** Every mechanism PR in this note lands behind a per-repo switch, so the before-and-after arms come from ordinary sessions on the same repository, not from a staged benchmark. The pre-registration protocol in `evals/README.md` still names the metric and the stopping rule before the switch flips.
4. **The published table.** A sanitized `MEASUREMENTS.md` in `55 Operations/` carries per-mechanism deltas (tokens, tool calls, time, cost at list price, eval score) with the receipt id beside each row. Numbers without a receipt do not enter the table.

### Workstream F. One entrypoint instead of fifty scripts

The count on 2026-09-02: 50 canonical scripts under `scripts/` at 16.9k lines, mirrored byte-identically into four plugin `scripts/` directories and two host renders, for 260 `.mjs` files in the tree. The duplication is mechanical and lint-pinned, not logical. The real sprawl is inside the canonical set: 19 `usage` functions, 12 `die`, 9 `flags`, three `walkFiles`, three `git` wrappers. Skills invoke 22 distinct scripts, each through the same `node ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs` boilerplate.

1. **Façade first.** One entrypoint, `scripts/co.mjs <domain> <verb>`, that lazy-imports the existing modules by domain: `context` (snapshot, bundle, query, map, graph, skim, digest), `run` (preflight, ledger, receipt, contract, runtime), `scan` (ai-tells, narration, redaction, injection, overbuild), `check` (vault, docs, links, citations, fleet, deps), `calibrate`, `atlas`, `records`. The old paths keep working as shims until every skill, eval, and handbook reference has moved.
2. **One CLI library.** `cli-lib.mjs` owns flag parsing, usage, `die`, the git wrapper, and the file walker. Each migrated script drops its private copy.
3. **Smaller vendored surface.** A plugin vendors `co.mjs`, `cli-lib.mjs`, and the domain modules it uses. `vendored-manifest.mjs` already expresses per-plugin lists, so the parity lint does not change shape.
4. **Token effect in every skill.** `co scan narration <file>` replaces the long invocation in every `SKILL.md`, and `co --help` replaces the header comments the model reads today to learn a script's flags.
5. **Not a rewrite in another language.** A compiled binary is faster to start, but it costs a build and distribution pipeline and breaks "a plugin is a directory of files". The only latency-sensitive path is the digest hook, which has its own fifty-millisecond budget. Measure that path before considering anything beyond Node.

### Workstream G. Atlas at claim granularity

`atlas-check.mjs check` reports 8 of 8 sections FRESH at `a9105a8`, with 170 lines of prose across the sections. The mechanism works. Its ceiling is granularity: a section such as `gate-scripts` scopes the whole `scripts/` tree, so any commit there flips the whole section to STALE and a reader re-verifies 170 lines to recover 5. The Suite direction note already flagged that atlas and vault freshness are two mechanisms.

1. **Claim-level anchors.** Each atlas claim carries a `file:line` anchor and an anchor substring, the same grammar findings registers use. `revalidate-register.mjs` already classifies anchors FRESH, MOVED, DRIFTED, or GONE. Reusing that classifier gives a section a partial state: the claims that moved are listed, and the rest stay trusted. One freshness mechanism, not two.
2. **Scopes from the graph.** Section scopes come from import-graph clusters rather than hand-listed globs, so a section is as fine as the module boundary it describes.
3. **A query surface.** `co context query explore` returns the FRESH atlas claims for a path beside the code anchors. `context-bundle.mjs` already pulls capped atlas excerpts, so the surface extends an existing path.
4. **Inbox consolidation as a receipt.** Consolidation runs on a schedule the ledger records, so "the atlas was last consolidated at sha X" is a checkable claim.

### Workstream H. A strong-model register

The suite's prose was hardened for weak models: sixteen items landed as mechanical gates and point-of-use rule inlining, measured by `evals/FLOOR_TABLE.md`. Frontier models need less methodology scaffolding and every inlined rule costs tokens in every session. The guide's own finding is the pattern: instructions written to restrain earlier models now push the current one the wrong way.

1. **Two registers, one truth.** Each `CONVENTIONS.md` keeps its rules once and marks which passages are scaffolding for the weak floor. The routing card and briefs load the compact register for models above the floor and the full register below it, decided by `model-tiers.mjs` and the floor table, never by guesswork.
2. **Measured, not assumed.** The judgment evals already run per model tier and arm. Adding the register as an arm shows whether strong-model quality holds when the scaffolding is withheld. If it does not, the scaffolding stays.
3. **Orchestration as code where the host allows it.** The orchestrator skills are prose pipelines. On a host with a deterministic workflow tool, a compiled workflow script per orchestrator runs the same phases with fewer orchestration tokens and a replayable run id. The prose stays the portable fallback, so provider parity holds.
4. **Background by default.** Operatives run in the background and the lead continues independent work, per the guide. `dispatch-ledger.mjs` records the overlap so the wall-time gain is measured.

## Key decisions

- Shape-keyed digest over command-keyed filters.
- Receipts over tee. Compression and proof are one mechanism.
- Loss-bounded compression with must-keep contracts, scored deterministically. Ratio never trades against retention.
- Pointers over payloads for the index. Verbatim source is opt-in and budgeted.
- Size is a tie-breaker behind correctness, boundaries, measured performance, and readability.
- Doctrine in briefs, not a per-turn persona. The SubagentStart card is an experiment arm.
- Zero npm dependencies. Optional external providers are detected at preflight and treated as data.
- Every mechanism beats the no-mechanism control under `evals/README.md` pre-registration, or it is removed.
- The digest hook ships opt-in per repository and turns on by default only after Phase 5.
- Measurement reads local transcripts and receipts. No model tokens, no egress, no hand-entered counts.
- Own implementations only. Nothing from rtk, ponytail, or codegraph is vendored or wrapped.
- One entrypoint with shims, migrated by domain. No rewrite in another language before the hot path is measured.
- Atlas freshness moves to claim granularity by reusing the register classifier. Two freshness mechanisms become one.
- Scaffolding for weak models is kept, marked, and withheld from strong models only when the eval arm proves quality holds.

## Open questions

- Does `updatedInput` apply to Read, Grep, and Glob on the primary host? The hooks reference confirms it for Bash and is silent on the rest. Test in Phase 2.
- Cross-host parity. Does opencode's `tool.execute.before` allow argument mutation, and what does the second host's hook layer allow? The traceless port only blocks today.
- Token estimate calibration. Is a one-off `count_tokens` run against a sanitized corpus acceptable under the egress posture, recorded as a calibration note?
- Compound commands. Simple-only wrapping plus the `cd X &&` pattern, or a lexer in the style of rtk's? Decide from the Phase 0 share.
- The deferral marker name and register shape.
- Whether the SubagentStart card earns its tokens. Decided by the Phase 5 arm.

## Risks

- A lossy stage hides a failure. Mitigation: must-keep contracts, the eval corpus, and the receipt line on every output.
- Hook latency on every Bash call. Mitigation: a fifty-millisecond budget measured by `benchmark-command.mjs`, and the fast path for non-allowlisted commands.
- A rewrite changes command semantics. Mitigation: an allowlist, no wrapping with redirects, heredocs, pipes, or structured-output flags, and `additionalContext` that tells the model the output was digested.
- Index staleness. Mitigation: content-addressed refresh on Edit and Write, and the staleness banner.
- Doctrine bloat. Every added passage costs tokens in every session. Mitigation: count the added lines per PR, pin shared passages, and cap the card at ten lines.

## PR plan

Each PR passes the full gate chain, bumps the plugin version, and carries a changelog entry. Each ships as a stack of small PRs where the slice allows.

1. **Phase 0, measure.** `context-audit.mjs` reading exact transcript usage, the `SessionEnd` receipt hook, and `MEASUREMENTS.md` with the baseline row. The effort-sweep plan as a calibration arm. One PR.
2. **Phase 1, doctrine and façade.** Workstream D prose edits, the `tracer.md` density clause, the PreCompact hook, and the `co.mjs` façade with `cli-lib.mjs` and shims. Two PRs.
3. **Phase 2, digest.** `digest.mjs` with the first shapes, the must-keep eval corpus, receipt integration, `skim.mjs`, and the opt-in PreToolUse stage for simple commands. Two PRs.
4. **Phase 3, code economy.** The ladder passage, `scan-overbuild.mjs`, the `overbuild-garden` fixture, the review lens, the deferral harvest, and the SubagentStart card as an experiment arm. Two PRs.
5. **Phase 4, index.** `context-query.mjs` with call edges and the refresh hook, then providers and the MCP wrapper. Two PRs.
6. **Phase 5, atlas and register.** Claim-level atlas anchors on the register classifier, graph-derived scopes, and the strong-model register as an eval arm. Two PRs.
7. **Phase 6, measure again.** Pre-registered comparisons for Workstreams A, B, and C against their no-mechanism controls. Keep what wins. Remove what does not. Flip the digest default if it clears. Publish the deltas to `MEASUREMENTS.md` with receipts.

## Evidence pointers

Suite state on 2026-09-02, from the explorer pass (paths relative to the repository root):

- `plugins/code-ops-suite/hooks/hooks.json` wires only PreToolUse (Bash) and SessionStart. No PostToolUse, SubagentStart, or PreCompact hook exists in any plugin (GAP-1).
- `plugins/code-ops-suite/hooks/enforce-traceless.mjs` reads the command and exits 0 or 2. It never emits `updatedInput` (GAP-2).
- `plugins/code-ops-suite/skills/normalize/SKILL.md:38` carries the only sentence balancing size against modularity (GAP-3). No script measures produced code (GAP-4).
- `scripts/calibration-graph.mjs` holds the only per-run token figures, hand-entered from a note field (GAP-5).
- `plugins/rigor/agents/tracer.md` has no density clause. The other seven bundled agents do (GAP-6).
- `scripts/context-bundle.mjs` enforces the only byte budget and fails loud on overflow. Operative Reads are unbounded (GAP-7).
- `scripts/run-runtime.mjs prefix` emits a cache-ready prefix that no script injects into a host (GAP-8).

Upstream sources read on 2026-09-02:

- https://github.com/rtk-ai/rtk (default branch `develop`): `src/filters/README.md`, `src/core/README.md`, `src/discover/README.md`, `src/learn/README.md`, `src/hooks/README.md`.
- https://github.com/DietrichGebert/ponytail: `AGENTS.md`, the hooks manifest under `hooks/`, `hooks/ponytail-instructions.js`, `hooks/ponytail-subagent.js`, `hooks/ponytail-runtime.js`, `benchmarks/`.
- https://github.com/colbymchenry/codegraph: `README.md` (benchmark methodology and the residual-context caveat).
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1
- https://code.claude.com/docs/en/hooks (hook output fields per event).
