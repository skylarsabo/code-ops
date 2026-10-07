---
type: reference
status: current
updated: 2026-09-30
---

# Infrastructure

This page owns the runtime environment: the Node version, the repository's own CI and hook
infrastructure, the bundled host hooks and their switches, and the operational limits. Look
here first for the name of a switch or the path of a local store.

## Runtime

The project is a Node.js repository that intentionally uses only Node built-ins. `.node-version` is the runtime SSOT and selects Node 24 LTS. CI and local tooling consume that file rather than maintain separate Node versions. Evidence: `.node-version`, `.github/workflows/validate.yml`, and `scripts/check-no-deps.mjs`.

Long-horizon runs use an explicit, ignored host-capability descriptor. The descriptor records
host, provider, model, observation source, and five capability states. Runtime receipts and
default metrics retain only its digest, states, and policy outcomes. The tools do not infer
capabilities from a model name. Initialization rejects Git-visible paths and linked components
before writing raw provenance. Evidence: `scripts/host-capabilities.mjs:1-79` and
`scripts/runtime-lib.mjs:17-29`, `193-218`.

The runtime stores a hash-chained receipt log at a repository-ignored path. It serializes mutations with a lock. A checkpoint or resume fails when its contract, capability receipt, stable prefix, ledger, bundle, or artifact has drifted. Evidence: `scripts/run-runtime.mjs:96-136`, `205-218`, and `253-292`.

The read-only `run-runtime.mjs status` surface bounds its event output and reports checkpoint, pending-dispatch, partial-acceptance, drift, and token-budget state. Context delivery is also bounded twice: `context-bundle.mjs view` produces a verified unit projection, and `worker-brief.mjs` enforces separate invariant, unit, and total byte limits with a source-bound receipt.

There is no application server, managed database, container image, Terraform root, or cloud-runtime configuration in the current repository. That is an inspected repository boundary, not a statement about hosts that install the marketplace.

## Repository infrastructure

GitHub Actions provides CI. GitHub hosts pull requests, branch protection, and the marketplace repository. `.github/actions-lock.json` owns the reviewed action identities, immutable SHAs, provenance, permissions, egress, telemetry, and advisory notes. The deterministic checker rejects mutable, unlisted, or drifted action references.

Git hooks can regenerate derived host distributions and reject unsafe staging conditions. CI remains the backstop when hooks are missing or bypassed. Evidence: `AGENTS.md:106-108`.

A commit that stages any file under `code-ops-docs/98 System/Atlas` now runs the full atlas gate and the staged-index manifest check, whether or not the hook changed other bytes (`.githooks/pre-commit`, the `atlas_staged` test). A commit made partway through a rebase, cherry-pick, or revert skips it, because the manifest is then intermediate. When the only stale digest is the atlas content digest and the atlas gate and claims gate both pass, the hook restamps that digest and stages the manifest. Any other stale digest, or a stale atlas section, aborts the commit with the stamp and sync commands. A merge reconciles its manifest in the hook, and `.githooks/post-rewrite` restamps the tip after a rebase. `CODE_OPS_DIGEST_AUTOFIX=off` removes the atlas trigger, the restamp, the merge reconcile, and the post-rewrite restamp. The freshness checks that follow a hook edit or a failed attempt stay on.

`scripts/sync-global.mjs` keeps one operator machine current after a merge. It installs the user-wide contracts from `global-contracts/` for Claude Code, Codex, and Grok Build, and it refreshes the installed code-ops plugin caches on each host. It refuses to overwrite a contract it did not write unless the operator passes `--force` or `--capture`. `evals/sync-global/run.mjs` covers it. See the README section "Keep this machine current".

## Host hook switches

The code-ops-suite package registers fourteen commands across eight events in
`plugins/code-ops-suite/hooks/hooks.json`. Twelve distinct scripts serve them. Every one is on by default where the host exposes
the required event contract. The traceless guard blocks a publishing command when it detects a
trace or a branch name with an AI-tool prefix or a generated token, and fails open on
infrastructure errors. The dispatch guard can deny a subagent call at
its budget boundary or when its explicit controller binding is invalid. It can also deny a lead
dispatch of a wide-surface type that names no reason, and a lead dispatch past the context
ceiling before the handoff assessment. Unbound infrastructure failures retain the previous
fail-open behavior. The peer guard redirects a message to a peer session that already handed off to its live successor on Claude and Codex, and denies it on Grok or when no live successor can take it.
The `SubagentStop` return check is advisory and never blocks. The agent ledger records each
subagent launch and report without output, so `co agents pending` lists the agents a handed-off
session never heard back from. The `PreCompact` hook `compact-snapshot.mjs` writes
`COMPACT_SNAPSHOT.md` before each compaction and never blocks it.
The table lists each variable that switches off a hook or feature, read from the canonical
`.claude/settings.json` environment. Three rows differ. `CODE_OPS_CONTEXT_CEILING` also takes an
integer that replaces the default ceiling. `CODE_OPS_OPERATOR_SHELL` is not an off switch: it names
the operator's shell on the routing card. `CODE_OPS_DIGEST_AUTOFIX` is read from the environment of
the git process, not from `settings.json`.
Rendered hosts use their documented process environment:

```json
{ "env": { "CODE_OPS_DIGEST": "off" } }
```

| Variable | Value that turns it off | What it governs |
| --- | --- | --- |
| `CODE_OPS_DIGEST` | `off`, `0`, or `false` | the `PreToolUse` output digest, `digest-rewrite.mjs` |
| `CODE_OPS_INDEX` | `off`, `0`, or `false` | the `PostToolUse` symbol-index refresh, `index-refresh.mjs` |
| `CODE_OPS_LADDER_CARD` | `off`, `0`, or `false` | the `SubagentStart` code-economy card, `ladder-card.mjs` |
| `CODE_OPS_SUBAGENT_REPORT` | `off`, `0`, or `false` | the `SubagentStop` advisory verdict and word-cap check, `subagent-report.mjs` |
| `CODE_OPS_AGENT_LEDGER` | `off`, `0`, or `false` | the `PostToolUse` (`Agent`, `Task`) launch record and the `SubagentStop` report record in `~/.claude/code-ops/agents/`, `agent-ledger.mjs`; `co agents pending` reads them; also the `ended` marker that `session-receipt.mjs` writes at `SessionEnd` |
| `CODE_OPS_AGENT_LEDGER_CAPTURE` | off unless `1`, `true`, or `on`, or a `capture.on` flag file exists in the ledger directory (`<home>/.claude/code-ops/agents/`) | the payload capture in `agent-ledger.mjs`, run by the agent-ledger and PreCompact hooks: one `payload-keys.ndjson` row per host, key-path list, and value set; key names, the host from env variable names (`codex`, `grok`, `claude`, `opencode`, `other`), up to 30 matching env var names, and only `hook_event_name`, `tool_name`, `agent_type`, and `subagent_type` as values (64 characters each), never any other value |
| `CODE_OPS_RECEIPTS` | `off`, `0`, or `false` | the `SessionEnd` measurement row, `session-receipt.mjs` |
| `CODE_OPS_HANDOFF_CARD` | `off`, `0`, or `false` | the `UserPromptSubmit` context-size nudge, `handoff-card.mjs`; it silences only the card, not the feed |
| `CODE_OPS_FEED` | `off`, `0`, or `false` | the change feed: event recording and delivery, `change-feed.mjs` |
| `CODE_OPS_HANDOFF_PICKUP` | `off`, `0`, or `false` | the `SessionStart` pending-handoff line inside `routing-card.mjs` |
| `CODE_OPS_COMPACT_SNAPSHOT` | `off`, `0`, or `false` | the `PreCompact` snapshot write, `compact-snapshot.mjs`, and the snapshot warning and seeding in `co handoff draft`; it does not gate the compact card in `routing-card.mjs` |
| `CODE_OPS_DISPATCH_GUARD` | `off`, `0`, or `false` | the `PreToolUse` round counter, dispatch gates, and dispatch advisories, `dispatch-guard.mjs` |
| `CODE_OPS_LEGACY_PATHS` | `off`, `0`, or `false` | the deny of an edit under a manifest `removed` legacy path, behaviour 6 of `dispatch-guard.mjs`; `CODE_OPS_DISPATCH_GUARD=off` also silences it, and `warn` makes it advisory |
| `CODE_OPS_READ_NOTICE` | `off`, `0`, or `false` | the `PostToolUse` history read notice for a Read, Grep, or shell call that opens a record not in force, inside `handoff-card.mjs`; the card and feed switches leave it on |
| `CODE_OPS_CONTEXT_CEILING` | `off`, `0`, or `false` | the context-ceiling dispatch gate inside `dispatch-guard.mjs`; an integer of at least 150,000 replaces the 300,000-token default |
| `CODE_OPS_PEER_GUARD` | `off`, `0`, or `false` | the `PreToolUse` redirect or deny of a message to a handed-off peer session, `peer-guard.mjs`, and every presence board write: `handoff-state.mjs` open and resume, the `index-refresh.mjs` edit record, the `session-receipt.mjs` `SessionEnd` mark, and the OpenCode `tool.execute.after` adapter, the collision note and its peer-surface note in `dispatch-guard.mjs`, the routing card's `peer:` lines, and the change feed |
| `CODE_OPS_DIGEST_AUTOFIX` | `off`, `0`, or `false` | the git-hook digest autofix, read from the git process environment: the `.githooks/pre-commit` atlas content restamp (block 0d), its atlas-staged trigger, the merge reconcile in `derived-merge.mjs`, and the `.githooks/post-rewrite` restamp; it leaves the freshness checks on every failure path and the merge driver unchanged |
| `CODE_OPS_OPERATOR_SHELL` | not an off switch | the `operator shell:` line inside `routing-card.mjs` on hosts other than Claude Code; a value replaces the shell derived from `process.platform` |

Any other `CODE_OPS_RECEIPTS` value names the receipt ledger path.

`CODE_OPS_DISPATCH_GUARD=warn` is the one middle setting: it keeps every advisory and turns each
deny into an advisory, except a deny for a malformed or unavailable controller binding. `CODE_OPS_ROUND_BUDGET` overrides the guard's 40-round default and takes a
positive integer only. An unregistered worker takes its budget from the brief's `Round budget:`
line, read once and clamped to 120, before that default. The guard injects one line at the budget
and at every further 20 rounds, telling the operative to start no new edit and write a checkpoint.
At 1.5 times the budget, rounded down and at least one call past it, it denies further tool calls and requires the same checkpoint. It counts rounds only inside a subagent, which
the host marks by an `agent_id` in the hook payload. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs`.

On the lead's own dispatch (`Agent`, `Task`, or `Workflow`) the guard applies two gates. The
wide-type gate denies a `general-purpose`, `claude`, `fork`, or unnamed agent type unless the
brief carries a `Wide-surface reason:` line. It also checks each `agent(` call of a `Workflow` script
and denies one with no `agentType`, a wide literal type, or a literal `effort` above `high`. The context-ceiling gate denies a new dispatch once the lead's
resident context reaches `CODE_OPS_CONTEXT_CEILING`, 300,000 tokens by default. Running
`/code-ops-suite:handoff assess` records the assessment and unlocks dispatch until the next
150,000-token band. A host without a skill tool records it with `dispatch-guard.mjs assessed
--session <id> --band <n>`, run from the project root. The guard also adds at most two advisory
clauses: a `model` override that replaces the agent's declared tier, and a brief carrying no
Round budget. It never denies any other main-thread tool call. `CODE_OPS_DISPATCH_GUARD=off`
disables the ceiling gate with the rest of the hook. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs`.

A controller with the exact host agent ID can run `dispatch-guard.mjs register --agent-id
<id> --budget <calls> --allowance <calls>` from the worker's repository directory. The allowance
defaults to two and cannot exceed four. The effective budget and allowance cannot extend the
legacy stop. `receipt --agent-id <id>` reports binding health and attempted tool calls, including
denied attempts. Unobserved model requests and tokens remain `UNKNOWN`. No automatic association
uses agent type or timing. Registration is local state; installation alone does not provide a
host correlation capability. Evidence: `plugins/code-ops-suite/hooks/dispatch-guard.mjs`.

On a trusted, supported host with enabled pickup hooks, a fresh `startup` or `clear` session can
receive one passive line listing up to 3 pending handoffs, newest first, each as its `Session:`
name (the run folder name for a legacy handoff) and path. The line states that the session is new
work unless the operator resumes one, and it never directs a resume. Discovery reads two bounded
directory levels, the dated run folders under each `<repo>-docs/80 Runs/` and under the
repository's own `80 Runs/`, never a recursive walk. Pending means the run folder has no
`HANDOFF.consumed` beside its `HANDOFF.md`, whatever that marker holds, and the file's mtime falls
inside 14 days. Discovery does not consume, resume, or reconstruct the handoff. Evidence:
`plugins/code-ops-suite/hooks/routing-card.mjs:29-89` and `scripts/opencode-lifecycle.js:168-213`.

Two variables name a storage path:

| Variable | What it names | Default |
| --- | --- | --- |
| `CODE_OPS_DIGEST_DIR` | the digest store root | `<host home>/code-ops/digest/<project slug>/` |
| `CODE_OPS_INDEX_DIR` | the symbol-index directory | `<host home>/code-ops/index/<project slug>/` |

`<host home>` is `~/.codex` under the Codex projection and `~/.claude` on every other host.
Evidence: `codex-marketplace/plugins/code-ops-suite/hooks/session-receipt.mjs:29`.

`CODE_OPS_DIGEST_STORE=off` keeps compression enabled while disabling raw-output and receipt storage.

The one command with no switch is `enforce-traceless.mjs` at `PreToolUse`. The routing card
itself has none either; only its pending-handoff line does. The `PreCompact` command
`compact-snapshot.mjs` prints nothing, because the host ignores `PreCompact` stdout. It writes the
snapshot file, and Claude and Codex receive the durable-state restore instruction on `SessionStart
source=compact`. That restore runs after compaction and does not alter the summary that was already
produced. It names the snapshot's state (fresh, stale, or absent), the live `active N/12` count,
and the reply-owed peers. When the session record names a run folder, it also lists the folder's
unchecked `TASKS.md` lines (id and first 80 characters, at most 12) while the snapshot is not
fresh. On Claude and Codex, host
auto-compaction is the routine context relief (DEC-73), and a handoff is only for new work, a
clean session that loads updated code-ops plugins, a host change, or a failed compaction (DEC-76). Claude Code compacts
itself near the size in `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (a token count, 250000 recommended),
which the operator sets in the `env` block of user settings; the handoff card names it while it is
unset. Claude documents `/compact [focus]`; Codex CLI and desktop document `/compact`. Detect
the active surface and never assume an agent-callable tool. Otherwise report the action as pending
operator work. The
[contracts reference](../35%20Contracts%20and%20Data/CONTRACTS.md) owns each command's
contract. Evidence: `plugins/code-ops-suite/hooks/hooks.json`,
`plugins/code-ops-suite/hooks/compact-snapshot.mjs`, and
`plugins/code-ops-suite/hooks/routing-card.mjs`.

## What the local stores hold

Leaving `digest-rewrite.mjs` on persists the complete raw output of every rewritten command, in
plain text, under `<host home>/code-ops/digest/<slug of the repository>/`, with a receipt row that
records the command's arguments as written. Nothing purges that store. Delete the directory to
purge it. `CODE_OPS_DIGEST_STORE=off` beside the switch keeps the compression and writes nothing,
at the cost of the recovery hints. The store is keyed by the repository that opted in, never by a
`cd` target inside a command. Evidence: `plugins/code-ops-suite/hooks/digest-rewrite.mjs:12-16`
and `plugins/code-ops-suite/hooks/digest-rewrite.mjs:161-176`.

The symbol index lives under `<host home>/code-ops/index/<slug of the repository>/` or
`$CODE_OPS_INDEX_DIR`, never in the tree, and holds definitions, call sites, and import edges,
never file bodies. Delete the directory to purge it. Evidence:
`plugins/code-ops-suite/hooks/index-refresh.mjs:6-11` and
`plugins/code-ops-suite/hooks/index-refresh.mjs:25-36`.

The session-receipt ledger is `<host home>/code-ops/session-receipts.jsonl`, or `$CODE_OPS_RECEIPTS`.
`context-audit.mjs receipts --purge-before <ISO date>` is the only thing that removes rows, so
retention stays one operator command. Evidence: `scripts/context-audit.mjs:8-16`.

The handoff-card marker store is `<host home>/code-ops/handoff/<project slug>/<session id>.json`,
one small file per session holding the 150,000-token band already nudged and the highest band the
session reached. It has no override variable and nothing purges it automatically; delete the
directory to purge it. Evidence: `plugins/code-ops-suite/hooks/handoff-card.mjs:68-72` and
`scripts/transcript-lib.mjs:565-581`.

The session records live at `<home>/.claude/code-ops/sessions/<repo key>/<session id>.json`,
one small file per session. A record holds the session id, host session id, name, worktree, run
folder, hop, and update time. The repository key is the repository folder name plus the first 12
hex of the SHA-256 of the git common directory, so every worktree of a repository shares it.
Readers also read the older store keyed by the working directory. `<home>` is `CODE_OPS_HOME`
when set, else the OS home.

The presence board lives at `<home>/.claude/code-ops/board/<repo key>/<session id>.json`, one
file per session. A record holds the session name and ids, branch, worktree, run folder, claimed
paths, the 20 newest edited paths with times, a one-line task, a heartbeat, and `ended`. Every
path is relative to the worktree top. No record holds file contents or an absolute path.
`CODE_OPS_PEER_GUARD` off stops every automatic write. Nothing purges either store
automatically; delete the directory to purge it. Evidence: `scripts/handoff-state.mjs:11-37` and
`scripts/handoff-state.mjs:253-419`.

The feed store is `<home>/.claude/code-ops/feed/<repo key>/`. The collision store is
`<home>/.claude/code-ops/collision/<repo key>/`.

The dispatch-guard store is `~/.claude/code-ops/dispatch/<cwd hash>/<agent hash>`. Each agent
has a `.rounds` counter and may have a `.binding.json` controller record. Each lead session that
recorded a handoff assessment has a `<session hash>.assessed.json` marker holding the highest
assessed band. New keys use SHA-256;
legacy slug-keyed counters remain readable so adoption does not reset enforcement. No automatic
purge runs. Receipts omit raw paths, agent IDs, prompts, and commands. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs`.

`context-audit.mjs --host codex` reads local Codex session JSONL, filters to the current
directory unless `--all` is present, and normalizes current response usage. A receipt follows
child rollout `parent_thread_id` links rather than assuming Claude's nested directory layout.
For installed Grok 1.0.13, the receipt parser reads cumulative per-prompt snapshots from the
session's `updates.jsonl` and records `ladderCard=false` and `handoffPickup=false`.
`handoffCard` follows its switch, because PostToolUse delivers that note. Every receipt
also records the handoff band the session reached and whether the operator ran
`/code-ops-suite:handoff`, so `receipts --by-arm` reads the handoff card against its own control.
The `arms` object also carries `handoffPickup` and `dispatchGuard`, each read from its own switch.
A `CODE_OPS_DISPATCH_GUARD` of `warn` records `dispatchGuard=true`, because every advisory still
runs and only the denies are lifted.
The report omits tool arguments and
working-directory values unless raw output was explicitly requested.

Keeping a switch per repository is what makes a measurement arm possible: one checkout runs with
the mechanism and another runs without it, and their session receipts compare. The
[measurements reference](../55%20Operations/MEASUREMENTS.md) owns the baseline rows and the
comparison method. The `ladder-card.mjs` card is an arm of exactly that kind, and it stays only
if the receipts show it beats the brief-only control. Evidence:
`plugins/code-ops-suite/hooks/ladder-card.mjs:6-10`.

## Host projections

Claude and Grok consume the canonical packages. Codex and OpenCode consume deterministic
host projections. Parity means equivalent behavior through each host's supported API, not
byte-identical packaging.

| Capability | Claude | Grok | Codex | OpenCode |
| --- | --- | --- | --- | --- |
| Skills and scripts | Native | Native package | Rendered | Rendered |
| Operative floors | Native agent metadata | Preflight with collapsed model ladder | `model-floors.json` plus role brief | `chat.params` gate plus preflight carrier |
| Publishing gate | `PreToolUse` | Canonical command hook | Payload-adapted hook | `tool.execute.before` port |
| Digest and index | Native hooks | `updatedInput` digest and `PostToolUse` index side effect | Payload-adapted hooks | Mutable tool arguments and `file.edited` port |
| Routing and compaction | Session context and `source=compact` restore with the open `TASKS.md` lines | Instruction files carry the compact rule; PostToolUse names the newest compaction segment; passive stdout unavailable | Projected session context and restore | System-transform and compaction ports |
| Compact snapshot | Native `PreCompact` hook writes `COMPACT_SNAPSHOT.md`; the `source=compact` card reads it | `PreCompact` and `PostCompact` write `COMPACT_SNAPSHOT.md`. The 2026-10-01 capture shows Grok sends the snake-case `session_id` and `transcript_path` the hook reads. No Grok compaction marker is known, so the boundary count stays 0. The next PostToolUse names the newest `compaction/segment_*.md`. Passive stdout is ignored | Projected hook; dropped: `PreCompact` did not fire on compaction in the 2026-10-01 capture, so the handoff card tells Codex to run `co snapshot` | No `PreCompact` port and no snapshot writer; the compacting hook pushes the open `TASKS.md` lines, pending dispatch rows, and the snapshot path or a `co snapshot` line |
| Documentation MCP | Plugin manifest | Plugin manifest | Projected MCP manifest | Runtime `config` hook with local commands |
| Ladder card | Native | Instruction files only; receipt arm is false | Projected hook | Lifecycle plugin injects it into the implementer |
| Subagent return check | Native `SubagentStop` `systemMessage` note | `SubagentStop` `systemMessage` only. CamelCase `subagentType` and `lastAssistantMessage` are read. `additionalContext` is never set | Projected hook; payload fields UNVERIFIED, so a missing field leaves it silent | Not ported; no verified subagent-stop callback (UNVERIFIED) |
| Agent ledger | Native `PostToolUse` (`Agent`, `Task`) and `SubagentStop` | `PostToolUse` records `spawn_subagent` and `spawn_agent`. `SubagentStop` records the report. An omitted `background` flag means a background child | Projected hook without a matcher; it filters on `Agent` or `Task`, and the Codex dispatch tool name and `SubagentStop` fields are UNVERIFIED, so a missing field records nothing | Not ported; no verified subagent-stop callback (UNVERIFIED) |
| Session receipt | Native transcript callback | `updates.jsonl` side effect | Child rollouts followed by `parent_thread_id` | Lifecycle ledger from `message.updated`; no transcript parse |
| Handoff card | Native; asks for a CONTINUE or COMPACT assessment, names host auto-compaction as the relief, and names `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (250000 recommended) while it is unset | PostToolUse note from `updates.jsonl` on the TUI, headless, and ACP agent. At 150,000 tokens it checkpoints and waits for the host compact near 184,000 tokens. Past 200,000 a typed prompt is blocked until `/compact`, a handoff command, or a live `Continue-until:` bound, because that compact did not run. That record unlocks the current ceiling band, and the next 150,000-token band blocks again. A host compact records the same assessment. The next tool result names the newest compaction segment. UserPromptSubmit stdout is discarded | Projected hook that asks for CONTINUE or COMPACT, with no handoff point; silent if the payload omits `transcript_path` | Lifecycle note on the next tool result or user turn, from `message.updated` usage; also delivers and records feed events |
| Pending handoff | Native routing-card line | Instruction files only; passive stdout unavailable | Projected hook | Lifecycle line on the first lead system transform |
| Peer guard | Native `PreToolUse` deny on `SendMessage` and `mcp__ccd_session_mgmt__send_message` | Registered on `SendMessage` and `send_subagent_message`. A handed-off target is denied. `updatedInput` is not used | Projected hook without a matcher; inert unless a messaging tool shares a name (UNVERIFIED) | Not ported |
| Dispatch guard | Native, with the wide-type and context-ceiling dispatch gates | Registered; the dispatch gates read the camelCase `toolName`, `toolInput`, and `sessionId` and cover `spawn_subagent`; its schema has no agent-type field, so the wide-type gate denies only a named wide type; the round counter is inert without `agent_id` | Projected hook; the round counter is inert without `agent_id`, and the dispatch gates stay inert unless the dispatch tool shares Claude's name (UNVERIFIED) | Lifecycle guard keyed by child `sessionID`, a suite-only Task allowlist, and a context-ceiling gate unlocked by the `skill` tool or the typed handoff command, and an enabled-models deny for a model the host lists as unavailable or the operator has disabled |
| Collision note | Native | Camel-case payload mapped | Payload UNVERIFIED | Not ported |
| Change feed | Native | PostToolUse delivery only | Payload UNVERIFIED | Hub-edit and seal events only; no push or merge events, no delivery |
| Legacy path deny | Native `PreToolUse` deny inside the dispatch guard | Registered; camelCase `toolName` and `toolInput` mapped; `search_replace` is the edit name, and its path key is UNVERIFIED, so the extractor tries `file_path`, `filePath`, `path`, and `target_file` | Payload-adapted; `apply_patch` targets read from the patch text | `tool.execute.before` throw for `write`, `edit`, `patch`, and `apply_patch`; the shared library loads from `code-ops/code-ops-suite/scripts/` |
| History read notice | Native `PostToolUse` context on `Read`, `Grep`, and shell | Reach UNVERIFIED. No captured Grok payload exists in the repository. The Grok hooks guide (installed 1.0.13) maps `Read` to `read_file`, `Grep` to `grep`, and `Bash` to `run_terminal_command` and says a matcher tests the real tool name, so the hook matches those names. The read tool's input field name is UNVERIFIED, so the extractor tries the same key list; a Grok read it cannot extract gets no notice | Probable: shell commands through `exec_command` and `shell`; the record path is matched inside the command text | `tool.execute.after` appends to the tool output for `read`, `grep`, and `bash`, reusing the arguments the before hook saw when the after event carries none |

The Codex renderer removes Claude-only matchers and lets normalized payload adapters filter
the actual tool. The OpenCode renderer translates both slash and bare canonical skill names,
blocks unknown, disabled, or below-floor operative models, and derives local MCP paths from the plugin
module. Its compatibility page names each host gap instead of claiming nonexistent
hooks. The Grok behavior above is local runtime evidence from installed version 1.0.13 and
`~/.grok/docs/user-guide/10-hooks.md`. The deterministic evals prove accepted output shapes
and side effects; they do not claim that a fresh live external model turn was run during this
change. Evidence: `scripts/build-codex-marketplace.mjs`,
`scripts/build-opencode-dist.mjs`, and `evals/grok-build-compat/run.mjs`.

## External dependencies

The repository has no runtime third-party package dependency. Model-driven deep review and
OpSec review execute locally, not on this repository's GitHub runner, and the gate names no
provider: a receipt records whichever reviewer identity ran it. The local
review gate needs only Git, Node, ignored receipt storage, and an available local reviewer.
GitHub review examples remain opt-in consumer integrations. Evidence: `scripts/check-no-deps.mjs:24-28`
and `scripts/local-review-gate.mjs:1-39`.

`ctags` and `codegraph` are optional external tools, not dependencies. `preflight.mjs` prints
each one as present or absent beside its other capability lines, and their absence never fails a
preflight. `context-query.mjs` spawns one only when `refresh --provider` names it, and without
one the index falls back to its own line rules. Evidence: `scripts/preflight.mjs:93-99` and
`scripts/context-query.mjs:207-212`.

## Operational limits

The context compiler sets a 30-second timeout for repository-map, import-graph, and Atlas commands. It limits subprocess output to 64 MiB. Evidence: `scripts/context-snapshot.mjs:52-59` and `61-105`.

The runtime receipt chain has a 32 MiB limit. Each configured stable prefix has its own byte
limit. Stable-prefix files must be regular stage-0 tracked UTF-8 text without linked
components. Evidence: `scripts/context-index-lib.mjs:82-110` and
`scripts/runtime-lib.mjs:148-172`, `303-351`.

## Record tooling distribution

`records.mjs` and `record-lib.mjs` are canonical root scripts. The vendor manifest copies them byte-identically into the code-ops-suite package. Codex and opencode renderers then carry that package into their generated host projections.

Record tooling uses Git and Node built-ins only. It stores generated inventories, citation baselines, curation JSONL, and semantic indexes beneath the documentation hub. Historical record bodies remain at their registered repository paths.
