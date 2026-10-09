# Changelog — code-ops-suite

All notable changes to this plugin are documented here. Versions track
the source plugin manifest and matching marketplace entries.


## 2.79.1
- The dispatch guard advises, without denying, when an `implementer` execution brief has no `Anchors:` block, and names the `co brief --anchors` command. `Anchors: none (<reason>)` silences it.
- Workflow `agent()` calls to the `implementer` get the same anchors advisory: a literal or template prompt without `Anchors:` is named by call index, and a prompt the hook cannot read is reported as unchecked.
- The `atlas` domain digest in `DOCS_MANIFEST.json` ignores the per-section stamp fields `atlas-check.mjs stamp` writes (`verifiedAt`, `verifiedDigest`, `claims`), so a restamp no longer forces a second manifest sync. Section prose, slug, file and scope still change the digest, and an unexpected manifest shape is hashed raw. The docs-manifest eval adds stamp-only, prose, scope and slug cases with three mutants.
- New `PostToolUse` hook `digest-post.mjs` (matcher `Bash|Read`) replaces a long `Bash` result with its digest through `hookSpecificOutput.updatedToolOutput`, keeping the `tool_response` shape. It skips output that is already digested, interrupted, an image, persisted by the host, or under the threshold: 4,000 characters on the lead thread (`CODE_OPS_DIGEST_POST_LEAD`) and 8,000 on a subagent thread (`CODE_OPS_DIGEST_POST_SUBAGENT`). The raw output stays in the digest store. `Read` results are digested only with `CODE_OPS_DIGEST_READ=1`. `CODE_OPS_DIGEST_POST=off` or `CODE_OPS_DIGEST=off` turns it off, and `CODE_OPS_DIGEST_STORE=off` is honored. A live host smoke on 2026-10-08 confirmed the Codex host accepts `updatedToolOutput` for `Bash`. The Codex and OpenCode builds omit the hook.
- The digest store helpers (`storeDir`, `storeOff`, `writeStore`, `appendReceipt`) move from `digest.mjs` into `digest-lib.mjs`, shared with the new hook. The CLI behavior is unchanged.
- The dispatch guard reads a `Workflow` `agent()` call's options from the second argument when it is an object literal, and from the first argument otherwise. `CODE_OPS_WORKFLOW_ARGS=first` restores the first-argument reading. The `Workflow` decision row gains `workflowArgs`.
- Behavior change: the dispatch guard now finds a Workflow agent's transcript under `subagents/workflows/<workflow id>/`. A `Round budget:` line in that agent's brief now binds it, with the stop at 1.5 times the budget. Such an agent previously ran under the 40-round default and stopped at 60 rounds whatever its brief said. The round warning names the transcript layout it read.
- New advisory redispatch note (gate id `redispatch-note`). A dispatch whose description and Scope hash match an earlier dispatch that reported and left a report path adds one note naming the report. The agent ledger writes the hash as `scopeHash` on each `dispatched` row. The note never denies, and `CODE_OPS_REDISPATCH_NOTE=off` turns it off.
- The compact snapshot holds its 12,000-character total on long sessions with a words elision step. It drops the oldest operator words down to the newest 3 prompts and shows one count line.
- The compact snapshot states a missing run folder as `not recorded (no run folder resolved); do not assume none` for decisions and grants, instead of an empty section.
- The compact snapshot infers a run folder for a session no `SESSION.json` names, from the session's time window. Everything read from it is labelled `inferred, unverified`, its grants are never rendered as authority, and the file goes to the home directory. `CODE_OPS_SNAPSHOT_RUN_FALLBACK=off` disables the guess.
- The compact card adds one gap line on the `compact` source when the run folder is inferred or unresolved, telling the lead to tag `Grant:`, `Decision:`, and `Next:` lines in `RUN_LOG.md`.
- CONTRACTS.md and INFRASTRUCTURE.md document the new hook, the seven new switches, and the guard and snapshot changes.
- The dispatch guard holds every Agent or Task call to an `effort` of low, medium, or high. The check ran only inside the routing review, so an agent whose brief lists no Tier, such as mech, probe, or explorer, accepted `max` or `xhigh`. The dispatch-guard eval adds max on explorer, xhigh on probe, a miscased High on mech, and a silent medium.
- The `explorer` agent declares `effort: medium`, the Haiku 5.5 default, and lint check 30 now requires an `effort:` on every agent, the light rung included. Haiku 5.5 takes an effort setting, so an omitted value inherited the session dial. The lint eval adds a Haiku agent with no effort.
The handoff draft now lists the open rows of PLAN.md, or warns when it cannot read a source. The init step records the host session id from CLAUDE_CODE_HOST_SESSION_ID.
- The handoff ledger records first-hop session names and not-dispatched markers. `dispatch-ledger.mjs skip` declares a contract unit that the run chose not to dispatch, and the marker carries a reason. `check-handoff` lists each marker, and refuses a marker for a unit that already has a row, a repeated marker, a marker for a unit outside the contract, and a malformed marker. `run-runtime` no longer reports a declared unit as pending and prints `not dispatched <id>: <reason>`. The handoff skill tells the lead to supply the host agent id when it records a dispatch. `artifact-grammars.md` and `CONTRACTS.md` state the marker grammar.
- The documentation manifest can keep each domain digest in its own file, `98 System/Digests/<id>.<source|content>.<first 16 hex>`, which holds the full SHA-256 digest, under the top-level key `"digestStore": "files"`. Two branches that restamp the same domain then merge with no conflict on GitHub, and `check` still fails the merged tree as stale until `sync` runs. `docs-manifest.mjs migrate` moves a fresh manifest to files mode. The merge driver, the pre-commit hook, and `integrate-branch` stage digest-file additions and deletions. A manifest without the key behaves as before.
- The compact card names the recall tool after a compaction: `transcript_recall`, or `co recall search --session <id> --terms <words>`. The line prints when recall is on, the payload carries a session id, and its transcript path is a file. It does not wait for the index, because the first recall call builds it.
- The PreCompact and SessionEnd hooks share one recall prebuild helper, `hooks/recall-spawn.mjs`, instead of two copies.
- Transcript recall reads subagent transcripts: `--agent <id>` (and `agent` on the `transcript_recall` tool) resolves `<session>/subagents/agent-<id>.jsonl`, indexes its sidechain rows as the main thread, and keeps that index in its own directory. A main-session index still skips sidechain rows. An agent id that is not 1 to 64 letters, digits, `_` or `-` is a usage error.
- A records adoption batch whose source commit left `HEAD` history after a squash merge now validates while the commit object survives and its bound content matches.
- `co brief` prefills the `Round budget:` line with the agent's measured default from `AGENT_ROUND_BUDGET` in `route-unit.mjs`: implementer 60, explorer, reviewer, and tracer 40, verifier 35, mech and web-researcher 30, probe 25, mech-review 15. An unlisted agent keeps the 40-round fallback. A 14-day reading across 3,761 operatives found 40% hit their budget warning, and 45% of implementers, whose median spend was 39 calls against a median budget of 40 (MEASUREMENTS.md, "Round budget stops, 2026-10-08").
- The dispatch guard's round-budget warning no longer reads as the stop. At the budget an operative writes its checkpoint now, then finishes the unit if it can before the hard stop at 1.5 times the budget; otherwise it reaches a consistent state and returns. Warned operatives had made a median of one call after the warning. The hard stop, the warning cadence, and the controller-bound text are unchanged. The OpenCode lifecycle plugin's warning matches, and always asks for the checkpoint, because that plugin reads only the environment budget and not the brief's.
- The `implementer` agent, `CONVENTIONS.md`, and `subagent-trade-offs.md` state the same rule, and say to split a unit before dispatch when it plainly needs more than about 60 tool rounds.
- `co run open` records a retention class (`--retention evidence|working`, default from `--skill`), `co run retention` raises a class (lowering needs `--operator`), and `co run retention-check` fails a `working` run that a tracked file cites outside its `CLOSEOUT.md`. The run index shows the class.
- `compact-snapshot.mjs` masks a whole private key block, not only its BEGIN line. The redaction scanner flags only the BEGIN line, so the base64 body lines of a key pasted into operator words or a tagged RUN_LOG line reached COMPACT_SNAPSHOT.md unmasked. The new exported `redactBlocks()` replaces every line from BEGIN through END with one `<REDACTED:secret-shape>` marker, and a BEGIN with no END masks to the end of its text. `maskTexts()` runs it before the scanner, so every caller gets it.
- The compact-snapshot eval adds a planted multi-line key, terminated and unterminated, that fails if any body line reaches the snapshot. A mutant copy without the block pass must leak every body line.
- The dispatch guard denies `git stash` (except `list` and `show`), `checkout`, `switch`, `reset`, `restore`, `clean`, `merge`, `rebase`, `pull`, `cherry-pick`, `am`, and any git verb with `--autostash` inside a subagent, because they rewrite the working tree the lead shares with other operatives. A verb with `--help` or `-h`, and `git clean` with `-n` or `--dry-run`, still pass. The `implementer` and `mech` definitions name the read-only alternatives for a baseline: `git show HEAD:<path>`, `git diff`, or a separate worktree. Off switch: `CODE_OPS_SUBAGENT_GIT=off`.
Transcript recall: `co recall` and the `transcript_recall` MCP tool find and open exact earlier detail in the host transcript after compaction, with no model call. Every answer ends at the original bytes, checked by sha256, and fails closed on a rewritten file. The index holds masked labels and byte offsets only. The PreCompact and SessionEnd hooks start a detached incremental build; `CODE_OPS_RECALL=off` disables it.
- `co handoff draft` refuses while the program ledger holds a stale open row: a row the two previous handoffs both carried, or whose `Hop:` is older than one handoff, with no `Forwarded-to:`, `Next:`, or close. `--allow-stale` drafts anyway and records an override line.
- The routing card warns when the session loaded an older code-ops-suite than the host plugin cache holds, so the operator starts a new session. It is advisory and fails open.
- `CODE_OPS_DIGEST_READ=lead` digests long `Read` results on the lead thread only and arms a `Write` guard: a whole-file `Write` to a path whose last `Read` was digested is denied until a ranged `Read` of that path. The `on` values behave as before. Off by default.
- New `co build-graph check|plan` validates a program's `BUILD_GRAPH.json` and fails closed on unordered units that share a path, a missing done-when or gate, a cycle, or a generated path in scope. `plan` prints the dependency waves. Repository-only.
- New `co gh`, `co fetch`, `co until`, `co each`, and `co show` commands (`scripts/co-run.mjs`) do in one shell call what took the lead several. Each exits with the child's own nonzero code, caps its output, and prints what it dropped. `co until` defaults to a 100 s timeout and stops at once when its command cannot start.
- `co brief <agent> --anchors <path[:line]>...` appends an `Anchors:` block holding a current outline of each named file, capped near 2,500 characters. The `implementer` agent re-validates each anchor before it relies on one.
- `§16` Workflow fan-out: an operator who invokes `ship`, `everything`, `remediation`, `codebase-audit`, `calibration-run`, or `distill` as a slash command or by name opts in to Workflow for fan-outs of three or more independent units. Those skills now say so. A skill the lead loads on its own is not an opt-in, and every `agent()` call names a suite agent type.
- `§1` sends any read-only ssh session, and any run of five or more dependent read-only commands, to the `probe` agent in one brief. A relaunch past the round budget uses `co brief --continue`.
- Skill and agent descriptions are shorter, to cut session-start context.
- `co brief <agent> --continue <report>` prefills a relaunch brief from the prior operative's checkpoint report. It carries the Scope line and adds a `Continues:` line and the `Done so far:`, `Remaining:` (with its next action), and `Dirty paths:` blocks. Carried text is quoted, capped near 4,000 characters, and marked `(not in checkpoint)` where the report lacks a part. An unreadable report exits 2. The `implementer` agent names the flag for relaunches. New eval `evals/brief-template`.
- `cost-split --since` counts each message by its own timestamp, in the main thread and in subagent threads. Before, it kept a whole session whose last message fell in the window, which overstated a one-week lead figure by about 10 percent.
- `cost-split` prints cost per merged PR from local git history (`--repo`, default `--cwd`) and adds `perPr` to `--json`. `--all` skips the section with one line.
- The `cost-split` context table and `--json` add turns over 250K and compaction counts per group.
- The context ceiling now reads as a backstop for a missed host compaction. The Claude contract says auto-compaction normally holds context under the 250,000-token window. The non-Grok ceiling denial says compaction has not run and that an operator `/compact` reopens dispatch. The handoff card's gate sentence adds "or the host compacts".
- Plugin version conflicts in `plugin.json` and the marketplace file now resolve through the derived merge driver.
- `context-index-lib.mjs` exports `receiptSha256`, the receipt digest that `judgment-evals.mjs`, `local-review-gate.mjs` and `runtime-lib.mjs` each defined. `runtime-lib.mjs` re-exports it for its callers. The digest bytes are unchanged.
- The rendered agent files for the second host no longer open with a doubled blank line, because the renderer trims the leading blank line of each agent body.
- `subagentFilesFor` in `transcript-lib.mjs` also reads the agents a Workflow run writes under `subagents/workflows/<run>/`, one level deep. So `cost-split`, the context audit and the session receipt now count Workflow agents. A Workflow agent groups by the `agentType` in its sibling meta file, or `unknown` when that file is missing. On the local corpus this added about 1,049 transcripts that were skipped before.
- `cost-split` counts each message id once across every file it reads. Before, a forked or resumed session counted about 1.3 percent of messages twice. This rule covers usage, Haiku tier pricing and advisor tokens. A line with no message id still counts per line.
- The cost-split eval adds a nested Workflow tree and a forked pair that shares ids, each with a mutant. The context-audit eval asserts the nested file list.

## 2.61.0
- The explorer, reviewer, and mech agents name the file:line link standard in their Return section. A report cites code as `[name](repo-relative/path:line)`. The Handbook page `standards/file-line-links.md` states the form and points to where its grammar lives.

## 2.60.0
- The `implementer` agent declares `effort: medium` instead of `high`. A paired replay of four merged PRs, one sample per arm, finished three of four with passing gates at medium against two of four at high, with 18% fewer output tokens. The priced saving was about 5%, because the medium arms made more requests. A judgment unit still routes to high, and the brief's `Effort:` line with a matching Agent `effort` delivers it. The `subagent-trade-offs.md` routing table matches.
- The dispatch guard reads the Agent call's own `effort` (CLI 2.1.292 and later) as the effort the dispatch runs at, and falls back to the frontmatter effort when the call passes none. A brief `Effort` above that effort still denies, and the denial now points to the Agent `effort` input as well as to Workflow `agent()`. An Agent `effort` other than low, medium, or high denies. The dispatch-guard eval adds four cases, and its implementer calls pass `effort: 'high'` for their judgment brief.

## 2.59.0
- `records.mjs` writes a random `lease.nonce` file into the collection mutation lock at acquisition and makes it part of the lock identity, beside the device and inode. A filesystem such as ext4 can give a removed and recreated directory the same inode, and stale-recovery restore copies `owner.json` with its token. Before this change, such a replacement passed as the original lease and the "durable mutation completed ... do not retry" path never fired. A lock from an older version carries no nonce, and stale recovery still compares it by device and inode.
- The record-collections eval adds a same-inode case. It refills the lock directory in place with the same token, so it reproduces inode reuse on every platform and fails against the previous library. The remove-and-recreate case now passes whatever inode the filesystem assigns.

## 2.57.0
- New `compliance` subcommand of `context-audit.mjs` counts, from the two supported transcript formats, operator prompts, dispatch calls by tool, guard denials, Workflow launches with and without a Run-contract line, briefs without a `Round budget` line, and authority-bearing shell commands (`git push`, `gh pr create`, `gh pr merge`, `gh release`). It prints counts and ids only, never prompt, command, brief, or result text. Subagent threads, unreadable files, and transcripts of the other hosts are counted apart as skipped. Flags: `--json`, `--out`, `--session`, `--host`, `--all`.
- `context-audit.mjs` now runs its command line only when invoked as a script, and exports the pure counting helpers, so the eval imports them. The eval pins `RUN_CONTRACT_LINE` to the dispatch guard's literal and fails when the two differ.
- The `context-audit` eval gains fixtures for both formats with a seeded sentinel string that must never appear in any output. MEASUREMENTS.md pre-registers three compliance rows with decision rules fixed before data.

## 2.56.0
- The Anthropic `light` rung binds `claude-haiku-5-5` in `scripts/model-tiers.mjs`, replacing `claude-haiku-4-5-20251001`. The `explorer` agent declares `model: claude-haiku-5-5` instead of the `haiku` alias, which resolved to Haiku 4.5 in recent sessions. `CLAUDE_ALIAS_TIER` ranks the id `light`, and lint check 30 lets a light agent omit `effort:`, because Haiku 5.5 defaults to medium. Bedrock, Google Cloud, and Foundry still serve Haiku 4.5, so the dated id stays in `ACCEPTED_MODELS` as a `light` pin and a historical stamp keeps its rung. The Copilot host ladder and its `haiku` specialist are unchanged, because Copilot availability of Haiku 5.5 is unverified.
- The Anthropic price notes carry the 1-hour cache-write rates (Sonnet 5.5 $4, Opus 5.5 $8, Haiku 5.5 $0.20), the batch rates, and the Haiku 5.5 rates above a 100,000-token prompt. The Sonnet 5.5 cache read records the pricing table value of $0.20, which the page prose contradicts. `REGISTRY_VERIFIED_AT` stays at 2026-10-01 because models.dev did not list `claude-haiku-5-5` on 2026-10-07.
- The `subagent-trade-offs.md` binding table and price lines match the new light rung. `evals/FLOOR_TABLE.md` records that the weak arm has not been re-measured on it.

## 2.55.0
- The dispatch guard adds one advisory for a `Workflow` script that makes two or more `agent()` calls, or any call it cannot read, and has no readable `Run contract: <path>` line. The line may be bare or in a comment. The path resolves against the session directory and must name a JSON file with a non-empty `runId`. The note gives the call count against a guideline of 10 and how many calls set no effort. It never denies, and a script the guard cannot parse skips it.
- A `Workflow` decision row gains a `contract` flag, true when the script carries a `Run contract:` line, and the gate table gains the `workflow-contract` id. The dispatch-guard eval covers the advisory, the silent forms, each bad-path case, and the row flag. CONTRACTS.md describes the advisory.

## 2.54.0
- The ship Phase 2 text and the implementer, reviewer, explorer, and mech agents carry short examples of the touch-improve outcomes. The ship text shows improved, none-in-scope, and net-negative report lines, and says the reviewer reports a net-negative file as Should-fix. Each agent carries one example sized to its role.

## 2.53.0
- `check-vault-standard.mjs --render` also writes `80 Runs/INDEX.md` on a manifest v3 hub whose `80 Runs/` folder exists. The page lists each run folder newest first with its retention tier, its age, a status, and relative links to `RUN_LOG.md`, `TASKS.md`, and `reports/`. The status is the last `Verdict:` or `Status:` line already in a run's `CLOSEOUT.md`, `EXECUTIVE_SUMMARY.md`, `RUN_LOG.md`, or `TASKS.md`, else the `TASKS.md` checkbox count, else `-`. Tier and age reuse `listRunTiers`.
- `--render --now <YYYY-MM-DD>` fixes the day the ages count to, so the page repeats byte for byte. Check mode never compares the page, and exempts it from the note rules only while it carries the generated marker.
- `docs-manifest.mjs` exports `readRunIndex` and the pure `renderRunIndex`. The vault-standard eval covers dated and undated folders, each tier edge, missing artifacts, an absent `80 Runs/`, a non-v3 hub, and the `--now` usage errors. `RUN_RETENTION.md` documents the page.

## 2.52.0
- New `co churn` command (`scripts/churn.mjs`) reports the circling measures over a git window and the run folders: the re-fix share, reverts, fix-of-fix commits per merged PR split into restamps and review fixes, repeated `Next:` lines, and ids reopened within one program. It is report-only and always exits 0. Two `git log` calls cover any window.
- Over the D-009 window (`3c1fa907`, 2026-09-06 to 2026-10-06) it reproduces the baseline git measures exactly. The "Circling" entry in MEASUREMENTS.md gives the command and the run-folder readings.
- A new churn eval pins each signal on a scratch repository, with a mutation control. CI runs it in one Ubuntu shard and one Windows shard.

## 2.51.0
- `check-vault-standard.mjs` gains rule 16, the decision register. A vault that carries `20 Decisions/REGISTER.md` keeps it whole: ids come from the D, ADR, DEC, EVO, and RBS families and stay unique, every `DEC-<n>` cited in the vault has a row, every decision note and ADR has a row, and each row has a valid date and status. A committed link in a Source cell must resolve. A run folder or program ledger is a code-span path under `80 Runs/`, checked for form only, and a link into that gitignored folder fails. A vault with no register sees no change.
- This repository adds `20 Decisions/REGISTER.md` with 108 rows for its decision notes, ADRs, and program ledgers.

## 2.50.0
- `docs-manifest.mjs runs` lists each run folder under `<hub>/80 Runs/` by retention tier: `active` (0 to 30 days), `distill-ready` (31 to 180), and `archive` (181 or more). It ages a folder from its `YYYY-MM-DD` name prefix and falls back to the folder mtime when the name has no valid date. The command is read-only and takes `--now <YYYY-MM-DD>` for a repeatable report. `runRetentionTier` and `listRunTiers` are exported for other scripts.
- The new operations page `RUN_RETENTION.md` states the tiers, the age limits, and the fallback. The docs-manifest eval tests each limit on both sides and the mtime fallback.

## 2.49.0
- The dispatch guard appends one decision row to `guard-decisions.jsonl`, beside the session-receipt ledger, for each output that denies or advises. A row holds ids and counts only: the gate ids that fired, the contract-rule ids they back, the tool, the decision, and a Workflow call count. `CODE_OPS_RECEIPTS=off` stops the rows, and a write error fails open.
- The dispatch-guard eval fires every gate id in the guard's table, including the peer note through a seeded presence board, and fails when a reworded message no longer matches its gate.
- The legacy path library denies an edit under a derived tree. It uses the manifest's `derived` entries when it lists any, and the built-in list (`.agents/`, `codex-marketplace/`, `opencode-dist/`) otherwise, each entry only where its generator script exists, so the deny stays live while `docs-manifest.mjs` does not accept the `derived` disposition.
- The "Dispatch guard hook" section of CONTRACTS.md documents the row file, its fields, the off switch, and the derived path deny.

## 2.48.0
- `scan-overbuild.mjs` now reads removed lines and prints a touched-file delta advisory after its tells, for the touched-file duty. It runs the pass-through shape and the exported-helper pattern over each touched source file's removed lines, and marks the file `IMPROVED` (removes some, adds none), `WORSE`, or `MIXED`. A removal reports its base line, and `--json` carries the result as `delta`. The advisory adds no hit and never changes the exit code, and the tells and their exit codes are unchanged.

## 2.47.0
- `route-unit.mjs` is the one source of unit kinds. `CONTRACT_KIND_OF` maps each route kind to the kind a run contract records, and `run-contract.mjs` derives its accepted kinds from it. A bad kind now fails with the allowed list and names the contract kind to record for a route kind.
- Version 4 contract units accept an optional `size` (`S`, `M`, or `L`) and `roundBudget`, and briefs may carry a `Size:` line. Every size defaults to the 40-round budget, because no unit has recorded a size yet. An advisory fires when a budget sits below the measured median for its size, and it stays silent until a median is measured.
- The bundled `artifact-grammars.md` reference lists the optional unit `size` and `roundBudget` fields.

## 2.46.2
- The bundled `subagent-trade-offs.md` reference now states thirteen shipped agents and lists every one in its Kind table, including `mech`, `mech-review`, `probe`, and `web-researcher`. It also says a unit that runs an eval or writes temporary files goes to `implementer` or `mech`, never `probe`, because `probe` is read-only.

## 2.46.1
- `records.mjs` reuses Git reads within one run. It resolves HEAD to an object ID once, caches the tracked-path list, and reads citation and index blobs in one `cat-file --batch`. The record-collections eval makes 23% fewer Git calls (15,376 to 11,844) and runs about 25% faster (608 s to 457 s).
- `record-lib.mjs` clears these caches on any Git command that can change state and on every file write. A library caller gets the cache only if it calls `enableGitReadCache`, so other scripts keep reading live state. The index, the worktree, and receipt bindings are never cached.
- A new eval case stages and commits inside one process and checks that the cached reads refresh.

## 2.46.0
- A branch-name rule blocks branches that start with an AI tool name (`claude/`, `codex/`, and similar) or end in a generated token such as `beautiful-lehmann-0bd3b1`. `scripts/branch-name.mjs` owns the rule and its `check` command.
- The traceless hook applies the rule to commands that create or rename a branch, commit, push, or open a pull request, and blocks with the rename command. The OpenCode traceless plugin applies the same rule.
- The tracked `pre-commit` hook checks the current branch, and a new `pre-push` hook checks each pushed branch, so hosts without the tool hook are covered. The CI traceless step checks the pull request head ref. The rule has no off switch.

## 2.45.1
- `route-unit.mjs` classifies `scripts/doctrine-passages.mjs`, `scripts/layout-manifest.mjs`, and `scripts/check-duplication.mjs` as the gate-script surface, because lint check 14 and check 7 now read the pinned doctrine passages and the layout paths from those files.

## 2.45.0
- The compaction snapshot now carries what a handoff carries. It adds four sections read from tagged `RUN_LOG.md` lines: decisions with their rejected options, authority grants, in-flight `file:line` boundaries, and the next command. The header gains a `Run:` line and counts for the new sections. The next command is never cut, grants stay whole while the snapshot fits its 12,000 characters, and every new line passes the same redaction pass as the transcript text.
- `CARRIED_FIELDS` in `scripts/compact-snapshot.mjs` is the one list that maps each handoff `Write` field to its snapshot section and tag. `co snapshot --fields` prints it, the handoff skill cites it, and the eval fails when a handoff field has no entry.
- The compact card reads a snapshot as fresh when the host has not yet flushed the boundary row, provided the snapshot was written at or after the newest boundary. `snapshotState` keeps its strict two-argument form. The card also prints `snapshot also holds:` and, for a partial snapshot, `Snapshot partial: missing <inputs>` with the rebuild command.
- The standard card names the four tags. The checkpoint advice on every host, including both Grok notes, asks for `Decision:`, `Grant:`, `In flight:`, and `Next:` lines.
- `run-contract.mjs init` records the session in `SESSION.json` (`--session`, `--host-session`, or the host session environment variable), so the run folder is found by session id. It leaves a file that names another session unchanged.
- OpenCode compaction push carries the same four tag lines, read by the same rules, so OpenCode keeps parity.
- Fixes in touched files: the compact-snapshot eval trims trailing space from a fixture grant, and each pushed OpenCode open-item and dispatch line is cut at 200 characters at its source.
- Review fixes: past the total budget, the snapshot keeps the newest grants within their 800 characters and adds one `N older grants in RUN_LOG.md` line, so 40 long grants no longer write a file past 12,000 characters. The OpenCode compaction push replaces secret shapes (bearer tokens, `api_key=` values, GitHub tokens, AWS keys, private key headers) with `<REDACTED:secret>` in the tag, open-item, and dispatch lines it copies. Both tag parsers also accept the colon outside the bold (`**Decision**:`).

## 2.44.0
- The implementation loop replaces the report-never-fix rule with the touch-improve rule. An operative leaves every touched file better in modularity, performance, and quality. It fixes defects found in touched code in the same change. It reports problems outside touched files as follow-ups.
- The ship Phase 2 text and the implementer, reviewer, explorer, and mech agents carry the touch-improve duty. Each report states, for each touched file, improved (what), none-in-scope (why), or net-negative (why).

## 2.43.0
- A merge restamps its documentation manifest by attestation. `derived-merge.mjs reconcile` runs on every merge, including one the merge driver never sees, and restamps a domain only when each parent already carried correct digests for it. A domain either side left stale stays stale, and the commit is refused with the stamp and sync commands.
- A rebase gets the same restamp. The new `.githooks/post-rewrite` hook calls `derived-merge.mjs rewrite`, which attests against the old tip and the new base and writes the manifest into the rebased tip. `install-git-hooks.mjs` installs it.
- `docs-manifest.mjs` reads three snapshots: the working tree, the index (`--index`), and a commit tree (`--attested <rev>,<rev>`). `check --index` hashes the bytes a commit would hold, and `sync --index --only <id>` stamps one domain from the index. A plain sync names the paths where the working tree and the index differ.
- The pre-commit hook restamps the atlas content digest when it is the only stale digest and the atlas gate and the claims gate both pass. A stamp made after the manifest sync no longer needs a second sync. Any other drift still aborts the commit.
- A commit that stages any file under the Atlas folder now runs the full atlas gate and the manifest check. A commit partway through a rebase, cherry-pick, or revert skips them.
- The pre-commit hook runs the freshness checks once, at the end, after the merge regeneration, the vendored sync, the renderers, and the reconcile. The atlas restamp is the last write on every path.
- `CODE_OPS_DIGEST_AUTOFIX=off` (also `0` or `false`) turns off the atlas restamp, the Atlas trigger, the merge reconcile, and the post-rewrite restamp. The freshness checks stay on.
- `INFRASTRUCTURE.md` states the Atlas trigger and the switch, and its switch intro no longer counts the variables.

## 2.42.2
- The `conform` global scope now names the one authored source, `global-contracts/AGENTS.source.md`, and the three renders that `scripts/render-global-contracts.mjs` writes from it. Edit the source, render, then run `sync-global.mjs`.

## 2.42.1
- `docs-manifest.mjs sync` stamps digests only for domains that drifted, so parallel feature PRs stop colliding on the whole `DOCS_MANIFEST.json` digest table. Pass `--base <ref>` to further limit stamping to domains whose sources or content paths differ from that ref; pass `--all` to restamp every domain.
- `integrate-branch.mjs` runs `docs-manifest.mjs sync --base <ref>` so the normal integrate path stays scoped.

## 2.42.0
- On Grok, the host compacts near 184,000 tokens, at 72 percent of the 256,000-token window. At 150,000 tokens the handoff card checkpoints and waits for that compact.
- A typed prompt past 200,000 tokens stays blocked until `/compact`, a handoff command, or a live `Continue-until:` bound, because that compact did not run.
- After a compact, the next tool result names the newest compaction segment. A later climb toward 184,000 tokens is a new session pointed at that segment.
- `atlas-check.mjs retarget` rewrites a citation whose anchor moved to one line. A deleted or repeated anchor stays for judgment.
- The code standard says to leave changed code better than you found it, inside the change, in modularity, performance, and quality.

## 2.41.2
- A field denial now opens with the missing brief labels. Grok keeps the start of a hook denial and drops the tail, which hid those labels from the retry.
- A Grok ceiling denial opens with `/compact`, the unlock that host can run. The assessed-command line stays after it.
- `spawn_subagent` and `spawn_agent` run the same Tier and surface checks as Agent and Task. On Grok a valid Tier is not compared to the Claude model in the agent file.
- A Grok session's context is `contextTokensUsed` in `signals.json`. The last `inputTokens` row is the billed call size, so a 40,000-token window was reported past the price line.

## 2.41.1
- A Grok compact admits the next typed prompt that the 200,000-token block would refuse. That prompt records the ceiling band it sits in. A missing or stale token reading no longer leaves the session unable to take a message. The next 150,000-token band blocks again.

## 2.41.0
- On Grok, context relief is a suite compact. At 150,000 tokens the handoff card asks the operator to run `/compact` and writes `COMPACT_SNAPSHOT.md` first, then names that file on the next tool result so it outranks the host summary. A typed prompt past 200,000 tokens is blocked until `/compact`, a handoff command, or a live `Continue-until:` bound. That record unlocks later prompts in the same ceiling band. The next 150,000-token band blocks again. A host compact records the same assessment. A handoff is for new work, a failed compact, updated plugins, or a host change.
- `spawn_subagent` launches are recorded in the agent ledger. The subagent return check runs on Grok as a `systemMessage`. A collision note names a dashboard reply. `send_subagent_message` to a handed-off child is denied.
- The Grok contract no longer tells the lead to set a persona or a reasoning effort on spawn. Session effort is `[models].default_reasoning_effort`.

## 2.40.2
- The Codex/OpenAI ladder binds light to Luna 6, mid and strong to Sol 6.1, and premium dispatches to Astra. The default frontier binding stays Sol 6.1.
- The model registry and routing reference now describe the same bindings, and the route-unit eval covers the new premium selection.

## 2.40.1
- The derived-file merge driver now runs inside linked worktrees. `derived-merge.mjs install` registered the driver by a path relative to the checkout that ran it. Git runs a merge driver from the top level of the worktree doing the merge, and every worktree shares one local config, so a merge in a nested worktree such as `.claude/worktrees/<name>` failed with `MODULE_NOT_FOUND` and fell back to a text conflict. The driver is now registered by an absolute, double-quoted path. A copy tracked inside the repository is anchored to the main working tree, so removing a linked worktree cannot break it.
- `derived-merge.mjs check` and `install-git-hooks.mjs --check` resolve the registered script and fail, naming the path, when it is relative or missing. Before, `check` passed whenever the value mentioned the script. Adopters on 2.40.0 should run `derived-merge.mjs install` again, and again after a plugin update moves the scripts dir.

## 2.40.0
- `distill` vault mode closes the gaps the first real-scale calibration run (R-013) found.
  - `state plan <n> --none` records an empty plan, so a vault with no synthesis page can finish phase 7. `done` still refuses a batched phase nobody planned.
  - `state checkpoint` of a batched phase with unresolved batches names them and says `reopen` resumes them. The batch verbs on a checkpointed phase say to run `reopen` first.
  - `state done 2` refuses until every row of the relocation plan is applied, so a run with no applied wave can no longer pass phase 2.
- `docs relocate plan` now refuses a manifest below version 3 with the same message as `apply`, and the message names the upgrade.
- `check vault` keeps files under `99 Archive/` out of the triage queue, because an archived draft keeps its status.
- The `distill` skill states the version 3 upgrade order, the status vocabulary to declare, the repository-root `sources:` globs and their digest stamp, the `decides` rule for workers, and how to finish phase 6 when every ledger is legacy.
- The calibration protocol says to measure a skill that writes in a throwaway clone, with commits granted and line-ending conversion off.

## 2.39.0
- `distill` vault mode now runs phase 8 and the maintain pass. `co docs distill baseline` writes `98 System/DISTILL_BASELINE.json`, sorted and dateless, and refuses on a loss, an ambiguity, a count mismatch, an unreachable note, or a missing `98 System/TRIAGE.md`. `state done 8` runs the same check, with findability always required. The baseline copies each inventory it cites into `98 System/DISTILL_INVENTORIES/`, so the gate runs in CI and a fresh clone, where the run folder is absent.
- `co docs distill gate` is a read-only check of the tree against the baseline. It exits 1 on a new loss, a new unreachable note, a changed inventory, or a moved triage pointer.
- `state maintain-start`, `maintain-round`, `maintain-checkpoint`, and `maintain-done` run the maintain pass after phase 8. The round that reaches the budget checkpoints the pass, and `maintain-done` ends only on a passing gate check.

## 2.38.0
- New derived-file merge driver, `scripts/derived-merge.mjs` (vendored). During `git merge` and `git pull`, a conflict on a vendored script copy, a host distribution file, or `DOCS_MANIFEST.json` no longer stops the merge. The driver records the conflicting versions, and the commit hooks regenerate the files from the merged sources. A failed regeneration puts the conflict back in the index, so the merge cannot be committed with a stale file. `DOCS_MANIFEST.json` text-merges with its digests blanked, so both sides' authored edits survive. The atlas manifest keeps conflicting on purpose. Intake logs merge with `merge=union`.
- `install-git-hooks.mjs` installs the `pre-merge-commit` and `post-merge` hooks and registers the driver, and its `--check` fails while the driver is missing. `conform` gains an install step for the driver and routes state-surface drift to `distill`.
- New `evals/merge-driver` eval: clean and conflicting merges, a failed regeneration and its recovery, a rebase fallback, and mutants.

## 2.37.0
- `distill` vault mode (`vault <hub>`) runs phases 1 to 5 and 7 of the docs-vault backfill: inventory, relocate, classify, chain, drafts, and synthesis. Phase 6 is program mode, run once per ledger. Phase 8 and the maintain pass are not built, and the skill stops after phase 7.
- `co docs distill state` records each vault-mode phase in `state.json` and refuses an out-of-order start, a checkpoint with no artifact, and a `done` with no review note. The end of phases 2 and 5 runs the no-loss check over every inventory. Phases 3 and 7 plan batches of 25, and one defect in a batch sample sends the batch to full review.
- New `evals/distill-vault` fixture and deterministic state eval, with 7 planted defects, 6 decoys, and 13 mutants.

## 2.36.0
- The compact snapshot reads Grok transcripts: a `user` line with a `prompt_index` in `chat_history.jsonl` and a `user_message_chunk` in `updates.jsonl` both count as operator prompts, so a Grok PreCompact snapshot keeps the operator words.
- The Codex snapshot line on the handoff card now says the Codex PreCompact hook does not fire, as the 2026-10-01 capture showed.

## 2.35.0
- The routing card ends with the session's `Routing:` line once a judgment dispatch is on the ledger, and `handoff draft` writes the same line under In-flight boundaries, so a STARVED or OVERUSED verdict reaches the successor.
- `run-cost-audit` gains a routing lens: it compares each unit's ledger rung and effort with `co route` and cites every starvation and overuse flag.
- The global contract states the Grok effort dial: every xai rung is one model, so the lead sets the persona's `reasoning_effort` from the brief, since `spawn_subagent` takes no effort parameter, and strips `model` from spawn calls when model inheritance is on.

## 2.34.0
- The dispatch guard enforces task-based routing for agents whose `Brief requires:` lists Tier. The five strong-floor agents (implementer, reviewer, tracer, verifier, privacy-reviewer) now require `Unit:`, `Tier:`, `Effort:`, and `Route basis:` lines, and `co brief` prints them with the allowed values and a `co route` hint.
- The guard derives the surface from the brief's Scope paths, stripping `file:line` and `#L` anchors, and reads the attempt from the agent ledger. It denies a Tier or Effort below the route unless a `Route override:` line is present. An override never clears a surface trigger. The guard also denies a model override below the agent's floor or inconsistent with the Tier, a contradicted or unknown surface, an Effort above the agent's frontmatter, any literal `xhigh` or `max`, and a second frontier dispatch, including from Workflow scripts.
- Each reviewing agent has a minimum kind (`AGENT_MIN_KIND` in `route-unit.mjs`), so a review cannot be declared as lighter work to avoid the premium rung. `co route --agent` applies it too.
- Over-routing, a raised kind, an unrankable model override, and a non-literal Workflow model or effort draw advisories. The blanket model-override advisory is gone.
- The routing summary declares overuse only after at least 4 judgment-bearing dispatches.

## 2.33.0
- New `route-unit.mjs`, reached as `co route`, picks the tier and effort for one dispatch from its kind, ambiguity, reversibility, and the surface its Scope paths touch. It prints `Tier:`, `Effort:`, and `Route basis:` lines ready for a brief, plus the model each host binds at that tier. Review on a security, gate-script, or public-contract surface, a high-ambiguity irreversible unit, and a retry after a failed strong attempt route to premium.
- `model-tiers.mjs` gains a premium binding per provider at strong rank: Opus 5.5 on Anthropic and Copilot, and the pinned Sol model on OpenAI. Providers without a premium model collapse it to strong and say so. The registry snapshot is dated 2026-10-01.
- The OpenCode renderer builds its ladder from the tier order alone, so a specialist binding is no longer dropped, and the lifecycle plugin recognizes the pinned Sol model.
- Lint and the model-registry check cover the premium binding. A new route-unit regression eval, with mutants, runs on Ubuntu and Windows.

## 2.32.0
- Effort tops out at `high`. A task-based Run Contract rejects `xhigh` and `max` for the lead and for every unit, and a frontier peer exception now requires `high`.
- The OpenCode lifecycle plugin accepts `low`, `medium`, and `high`. It clamps `xhigh` or `max` to `high` and says so in the directive.

## 2.31.0
- Agent-ledger launch rows record the dispatch routing: `unit`, `requestedTier`, and `requestedEffort` from the brief's `Unit:`, `Tier:`, and `Effort:` lines, the `appliedModel` and `appliedEffort` actually used with their source, and an `ok`, `under`, or `over` flag. No prompt text is stored.
- New `attemptOf` and `routingSummary` exports count a unit's retries and print the `Routing:` line with starvation and overuse advisories.
- Under Grok the ledger hook records each subagent stop, mapping the camelCase `subagentId` and `subagentType` a live capture confirmed. A Grok launch still records nothing.

## 2.30.0
- New `distill-check.mjs` script, reached as `co docs distill`. `inventory` lists every file under a docs hub with its byte size. `no-loss` proves each listed path is still in place, moved through `FORWARDING.json`, or archived with a link from `99 Archive/`, and fails on an ambiguous or missing path. `findability` counts the hub files that no index page links. Each subcommand takes `--json`.
- New `distill-check` regression eval, run on Ubuntu and Windows.

## 2.29.0
- Payload capture also switches on through a `capture.on` flag file in the agent ledger directory, for hosts whose hooks do not inherit the shell environment. A captured line records the host from environment variable names, the key paths, and four allowlisted values (`hook_event_name`, `tool_name`, `agent_type`, `subagent_type`). No other value is stored.
- The PreCompact hook captures its payload too, so a host that delivers `transcript_path` to compaction can be confirmed.

## 2.28.0
- New `distill` skill, program mode only. It rewrites one program ledger into its finish line, at most 12 active items that each block a finish-line check, live decisions with `DEC` ids and dispositions, and a backlog. Every line that leaves the live ledger lands verbatim in the archive or the backlog, and the lead reads every disposition in `LEDGER_DIFF.md`. Vault mode is not built, and the skill says so and stops.
- New `evals/distill-program` fixture: six planted ledger defects and three decoys, checked by the fixture-drift guard.

## 2.27.0
- The collision note warns on surfaces two programs share. A `## Peers` section in PROGRAM.md declares paths, globs, and `process:` names per peer program, and an edit, a `git merge` or `git push` diff, or a kill command that touches one names the peer's live head session. Peers are discovered from the presence board, never configured.
- The routing card lists up to four live peer programs after a compaction and at startup or clear, with a `reply owed` marker from a fresh snapshot.
- The handoff check warns when a decision marked `Agreed-with: <slug>` has no matching entry in the peer program's ledger.

## 2.26.0
- The dispatch guard checks each `agent()` call in a Workflow script on its own. A call with no `agentType` or a wide literal type is denied unless the script states a `Wide-surface reason:`, and a literal `effort` of `xhigh` or `max` is denied with no escape. A call whose options cannot be read gets an advisory, and a script that cannot be parsed falls back to the script-wide test.
- New `CONVENTIONS.md` §16, Workflow fan-out: when a Workflow may run, how batches enter the dispatch ledger, and the per-call rules. The `everything`, `ship`, `calibration-run`, `codebase-audit`, and `remediation` skills cite it.

## 2.25.0
- A `PreCompact` hook, `compact-snapshot.mjs`, writes a masked state snapshot just before the host compacts: operator words, running shells, workflows, wakeups, and agents, open items, and peers owed a reply. It goes in the run folder when git ignores that path, otherwise in the home state directory keyed on the repository root. `CODE_OPS_COMPACT_SNAPSHOT=0` turns it off.
- `co snapshot` builds the same snapshot on demand. The Codex context card asks for it, because the Codex `PreCompact` payload is unverified.
- The compact restore card reports the snapshot as fresh, stale, or absent, and prints the git state, the latest `Next:` line, the active item count against the 12 cap, and up to 4 peers owed a reply. A fresh snapshot replaces the open-item lines.
- `handoff draft` warns on stderr about each peer owed a reply and seeds running shells, workflows, and wakeups from the snapshot under In-flight boundaries.
- The context card on Claude and Codex asks for a checkpoint at the next safe boundary instead of a handoff, because host auto-compaction is the relief. Grok keeps its handoff point at 200,000 tokens. When the ceiling gates new dispatches, the card on Claude and Codex names `code-ops-suite:handoff assess`.
- The context card marker, the session record, and the ceiling assessment are keyed on the repository root, so a changed shell directory no longer fires the card twice.

## 2.24.0
- `co agents pending` merges the hook rows with the run's `DISPATCH_LEDGER.md` rows on every host, names each entry's source, and prints the sources it read on stderr. `--run <dir>` names the run folder.
- `co agents settle <id> --failed --reason <text>` records a lost agent as failed, so it leaves the pending list. `handoff draft` names it beside waiting and `--pending-agents-ok`.
- At SessionEnd the receipt hook marks the session ended in the agent ledger and records its pending agents in the receipt row. The next SessionStart card lists workers left pending by an ended session in the same directory, never by a live one.
- The SessionStart compact restore finds its run folder through `SESSION.json` when the session has no home record.
- `CODE_OPS_AGENT_LEDGER_CAPTURE=1` records the key paths of each hook payload shape per host, never a value, as evidence for host parity rows.
- A new read-only `co burndown` prints a program's active items against the cap of 12, its backlog, and `OVER CAP` or `GROWING` flags.

## 2.23.0
- Auto-compaction is the routine context relief on Claude and Codex. The handoff skill, the user-wide contract, and the handoff card select CONTINUE or COMPACT on token pressure. A handoff is reserved for new work, a clean session that loads updated code-ops plugins or contracts, a host change, or a failed compaction. The Compact Instructions keep agent ids, peer threads, and authority grants. Grok keeps its 200,000-token handoff point. On Claude the card adds one line while `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is unset. The user-wide contract gains a Compact Instructions section.
- The SessionStart compact restore lists the run folder's unchecked TASKS.md lines, at most 12, and the pending agents.
- `check handoff` check 19 enforces program convergence. A PROGRAM.md with a `## Finish line` fails a handoff with more than 12 open items, an item without `Blocks: F<n>`, or a Blocks id not on the finish line. Items moved to BACKLOG.md carry forward as deferred. The check and `co handoff resume` print a burn-down line, flag `GROWING`, and list items unchanged for five hops.
- A new agent ledger hook records each Agent or Task launch on PostToolUse and each report on SubagentStop, with the dispatch ledger statuses `dispatched`, `reported`, and `failed`. `co agents pending` lists agents with no report. `handoff draft` refuses while an agent is unreported unless `--pending-agents-ok` is passed, which records each agent under In-flight boundaries. `CODE_OPS_AGENT_LEDGER=0` turns the hook off.

## 2.22.0
- `co docs relocate` moves a legacy docs tree into the vault. `plan` writes RELOCATION_PLAN.md and .json with the routing, kind, and reason for each file, and lists runtime-read references separately. `apply` runs one wave per legacy root: `git mv`, `relocate-root` events, FORWARDING.json, reference rewrites, the manifest root set to `removed`, and a register refresh. It never rewrites record bytes, `80 Runs/`, PROGRAM.md, or HANDOFF.md, and refuses a dirty tree or a stale base. `forward` rewrites a branch that predates a wave, and `integrate-branch.mjs` runs it when the manifest has a removed root.
- `co docs gate` step 6 fails when a removed legacy root exists on disk, when FORWARDING.json is invalid, or when a tracked file outside history names a relocated path.
- The dispatch guard denies an edit under a removed legacy root and names the forwarded location. `CODE_OPS_LEGACY_PATHS=off` turns it off. The handoff card adds one context line when Read, Grep, or a shell command opens a decision record that is no longer in force, naming its status, the records that replace it, and the register. `CODE_OPS_READ_NOTICE=off` turns it off. Both run in existing hook processes; the OpenCode lifecycle ports both.
- The vault check exempts record bytes under a manifest record-collection root from the frontmatter rule, and the rendered register carries frontmatter.

## 2.21.0
- The dispatch guard adds a warn-only collision note. An edit of a path that another live session claimed or edited within 6 hours names that peer and gives a ready `SendMessage` line, once per path per peer per session. A `git pull`, `merge`, `rebase`, or `push` lists the live peers on the branch and their recent edits that overlap uncommitted files. The note never denies. `CODE_OPS_PEER_GUARD=off` turns it off.
- A change feed records `git push`, `gh pr merge`, hub-file edits, and `records seal` start and land events under the home store. The handoff card delivers at most 3 new lines per call, filtered to the peer's branch and edits. A seal that starts on a base head another seal holds prints a warning first. `CODE_OPS_FEED=off` turns the feed off.
- `run open` and `handoff resume` print a `program overlap:` block when another live program lists the same scope document, and suggest `co program merge` for two or more shared paths. `run open --program <PROGRAM.md>` records the ledger for other sessions.
- `scripts/bench-hooks.mjs` measures p50 and p95 added latency for every hooks.json entry. MEASUREMENTS.md records the baseline and the after-PR figures.

## 2.20.0
- `co docs gate` runs the docs checks in order: manifest, records, vault standard, and draft and staleness rules, then ledger checks 11 to 18 on every tracked open program. An untracked ledger gets only the check-14 UNLANDED warning. Steps 6 and 7 print as skipped until later releases.
- The gate ratchets against `98 System/GATE_BASELINE.jsonl`. `--baseline-init` writes the first baseline, a new violation fails, a fixed one leaves the baseline, and the baseline never grows. `--check` never writes.
- Under a v3 manifest, `check-vault-standard.mjs` takes statuses from `drafts.statuses`, requires a resolving `superseded-by` link, fails a draft marked PROMOTED or SUPERSEDED, and fails a page whose `sources:` changed after its `sourceDigest:`. `--render` writes `10 Design/INDEX.md` and the `98 System/TRIAGE.md` queue, and the check fails when either is stale. A v2 manifest sees no new failure.
- `conform` documents installing the docs gate into an adopter and removing it as one reviewed commit. `integrate-branch.mjs` runs the gate with `--check` on a v3 repository.

## 2.19.0
- `co decide promote DEC-<n> --program <slug>` stages a decision record in records intake, sets the ledger disposition to `promoted:<record id>`, and renders the register. It refuses a grammar-1 ledger, an unknown id, and a decision that is not `pending` or `local`.
- `co program close <slug>` writes `CLOSEOUT.md`, marks the ledger `Status: closed`, and updates `80 Runs/INDEX.md`. It refuses while a decision is pending, an open item is not forwarded to an operator-owned successor, a handoff is unconsumed, or a promoted id is not sealed on the base branch.
- Handoff check 14 fails a `promoted:` id that resolves in neither `state.json` nor intake. Resume warns `UNLANDED` for an id not yet sealed and reports `DRIFTED` for an id superseded or amended since `Verified-at`.
- A missing scope document or pointer path falls back to `98 System/FORWARDING.json`. A forwarded hit reports MOVED, and an invalid forwarding file fails the check.

## 2.18.0
- `co program split <slug> --into <a>,<b> --assign <id>=<child>,...` writes a grammar-2 ledger per child and marks each parent open item and pending decision `Forwarded-to: <child>/<id>`. It refuses while any item is unassigned.
- `co program merge <from> --into <to>` imports the source's requests, scope documents, open items, and pending decisions under fresh ids with `Was: <from>/<id>`, marks the source `Status: merged into <to>`, and lists each imported pending decision to settle. It refuses a running head without `--head-ended`.
- Handoff check 9 accepts an id carried by a `Forwarded-to:` or `Was:` trail. Checks 9 and 13 read the predecessor's ledger when a split or merge changed the program.

## 2.17.2
- Lint resolves `co.mjs` commands that take no verb, such as `co brief`, to their script. It fails a reference to a domain the verb table does not carry.
- `check-vault-standard.mjs` validates `drafts.statuses` with the same slug pattern as `docs-manifest.mjs`, so the two scripts accept the same values. A digit-led slug is valid, and a trailing or doubled hyphen is not.

## 2.17.1
- `co program archive` exits 1 whenever the ledger stays over its 32 KB cap, including when nothing can move. It inserts moved entries into an existing `PROGRAM.archive.md` in place, so prior archive prose survives, and it keeps a moved entry's blank-line-separated continuation paragraphs. It reads CRLF ledgers and keeps each file's line ending.
- Handoff check 17 compares a predecessor open item carried as id and title against the nearest ancestor handoff that holds its full line, so an owner or done-when change recorded only in the ledger needs `Revised:`.

## 2.17.0
- The Claude strong and mid rungs bind to Sonnet 5.5 (`claude-sonnet-5-5`). Agents that declared `opus` now declare `claude-sonnet-5-5`, which serves the Claude strong rung, and every non-haiku agent declares `effort:` at most `high`. Lint check 30 rejects an agent effort above `high` and a non-haiku agent with no effort. Opus 5.5 stays accepted at the strong rung.

## 2.16.0
- Records carry meaning (W2). Under manifest v3, inventory entries gain a `meaning` object (`kind`, `title`, `topic`, `key`, `decides`), records gain `amends`, and curation validates the closed decision status set. Curation events are typed: an event with no type reads as `curate`, and `relocate-root` moves a whole collection while each record keeps its identity path, with membership, check, history, and lineage following the moved root.
- Intake and seal: `records intake` stages a record or curation change outside the chains, and `records seal` admits it in one commit on the base head. A stale basis is refused with both lines named, and `records curate` under v3 routes to intake off the base head. `records render --register` writes `20 Decisions/REGISTER.md` and `98 System/Records/state.json` with pending-seal marks. The library validates the `FORWARDING.json` schema.
- `records.mjs` accepts manifest v3 (closeout tracking, `removed` legacy entries without a target); it rejected every v3 manifest before.

## 2.15.0
- Ledger grammar 2: a `PROGRAM.md` with `Grammar: 2` gains an Open items section, and `check-handoff.mjs` runs checks 11 to 13 and 15 to 18 on it (decision ids, hops, and dispositions; no stale pending decision; predecessor decisions carried; one-clause decision lines; `Revised:` on a changed owner or done-when; unique ids). Check 16 fails closed under grammar 2 and still warns under grammar 1, and check 4 reads a carried item's owner and done-when from the ledger.
- `co handoff draft` fills each open item's `Anchor:` from its cited line on a grammar-2 ledger, writes active lines back to the ledger, and lists stale pending decisions for disposition. `--program` gives a first hop its scope digests.
- New `co program archive` moves closed items, settled decisions, and older requests to `PROGRAM.archive.md` (DEC-32), and exits 1 when the ledger stays over 32 KB.

## 2.14.0
- The vault Standard moves to version 5. It splits the hub into a state layer and a history layer, adds the four-clause decision invariant, the `<domain>/<subject>` topic key, and the closed decision status set. Record bytes stay irreversible, but a collection root may move by a `relocate-root` event (decision note D-004).
- `docs-manifest.mjs` accepts manifest v3, which requires standard-version 5. It adds `runs.tracking: closeout` with `retain` globs, a `drafts` block with `maxAgeDays` and `statuses`, a `state` map of surfaces with word budgets, and the `relocated` and `removed` legacy-path dispositions. Every new field fails closed, and a v2 manifest validates unchanged.
- `check-vault-standard.mjs`, `check-doc-citations.mjs`, and `docs-extract.mjs` read a v3 manifest. Under v3, draft statuses come from `drafts.statuses`.
- A null `legacyPaths` entry is reported as a validation error instead of crashing the check.

## 2.13.0
- A repo-keyed presence board records each live session: name, host session id, branch, worktree, run folder, claimed paths, recent edits, a one-line task, and a heartbeat. It lives under `<home>/.claude/code-ops/`, one file per session, and holds repo-relative paths only. A record with no heartbeat for 30 minutes reads as idle.
- `co board` lists the board, and `co board claim`, `release`, and `task` record explicit claims and the task line. A resume claims the program's scope documents.
- The session record store moves to the repository key, so `co handoff live` and the peer guard see sessions in linked worktrees. Readers still read the old working-directory key.
- On Claude and Codex the peer guard rewrites a message to a handed-off session so it reaches the live head, with a notice, instead of denying it. Grok keeps the deny, and OpenCode runs no peer guard. `CODE_OPS_PEER_GUARD` switches off the redirect and every board write.
- The edit hook and SessionEnd write the board, and the OpenCode build records edits through `tool.execute.after`. Measured added latency stays under 50 ms at p95 on each path (MEASUREMENTS.md).

## 2.12.1
- The handoff card gives the write-the-handoff advice for an autonomous session only on Grok, where prompts are counted apart from cards. Where the card runs at prompt submit, each card follows an operator prompt, so two cards in a row no longer claim that no prompt arrived.
- The ship skill rebases onto the base only before the first push. A published branch merges the base in instead, and a non-fast-forward rejection fetches, merges the remote branch and the base, and pushes once more. It still never force-pushes.
- `dispatch-guard.mjs register` prints a `dispatch-guard CAPPED:` line on stderr when a bound budget exceeds the default budget's stop, naming where the hook will warn and deny. The bound warning names both budgets.
- The dispatch-guard eval notes and CONTRACTS.md state the 1.5 times stop, the register cap, and that derived paths match same-tree by count only.

## 2.12.0
- The ship skill syncs before it pushes: fetch, rebase onto the upstream base, and push, with one retry on a non-fast-forward rejection. A rebase conflict or a second rejection stops the ship, and it never force-pushes. A rebase that moves HEAD re-runs the gates before the push.
- The dispatch guard and the OpenCode lifecycle plugin stop a subagent at 1.5 times its round budget, rounded down and at least one call past it, instead of twice the budget. The checkpoint warning still arrives at the budget.

## 2.11.1
- `co handoff draft` records a sha256 prefix for each dirty path, and `check-handoff.mjs` reports `same-tree:` only when every recorded path still matches its hash. A dirty record without hashes never reports same-tree, so an older handoff re-verifies.
- Both `git status` calls pass `--untracked-files=all` again, so a file added inside an untracked folder counts as a change. `SCOPE_DIGESTS.md` beside the handoff is left out of the comparison.

## 2.11.0
- The handoff point moves from about 350,000 to about 225,000 tokens in the handoff skill, the global contract, and `MEASUREMENTS.md`, which pre-registers the window comparison that re-checks it one week after release. The 150,000-token bands and the 300,000-token ceiling are unchanged, and the ceiling now catches a session that chose CONTINUE and overran.
- The handoff card fires on first reaching the handoff point (200,000 on Grok) and says to hand off at the next phase boundary. With no operator prompt since the last card, it says to write the handoff instead of assessing again.
- An assessment that returns CONTINUE past the point records `Continue-until: <N> tokens` or `Continue-until: <N> turns` in the run log. The card stays quiet until the bound passes, then fires once. A malformed bound sets no bound.

## 2.10.0
- `co handoff draft` writes `SCOPE_DIGESTS.md`: a hash, `Verified-at:`, and a digest per scope document, carried forward while the hash is unchanged. `co handoff resume` refuses an unfilled digest and reports each document unchanged, changed, or missing, so an unchanged document is not re-read.
- `check-handoff.mjs` reports `same-tree:` when HEAD matches and the dirty set equals the paths the handoff recorded, not only on a clean tree.
- The vendored `citation-lib.mjs` resolves a `file:line` citation whose path holds a comma, and re-checks confinement after widening a spaced or comma path, so an escaping path such as `../a,b/x.md:1` reads AMBIGUOUS instead of FRESH.

## 2.9.0
- Section 4 of `CONVENTIONS.md` adds the operator-shell rule: a neutral command goes in a `bash` block, which keeps the desktop Run button, and a PowerShell-only command goes in a copy-only `powershell` block in PowerShell 5.1 syntax.
- A new pinned passage requires every reply to link each repository file, run folder, open-item pointer, and PR it names, with a PR as its full URL.
- The routing card names `co brief <agent>`. On a live payload from a host other than Codex it adds `operator shell:`, which `CODE_OPS_OPERATOR_SHELL` overrides, and on Windows a quoting-trap line.
- `co brief <plugin>:<agent>` prints the brief template from the agent's `Brief requires:` line. A dispatch-guard field denial ends with the missing `Label:` lines ready to fill, and the binding and counter denials state their fix.
- `check-handoff.mjs` warns, without failing, on an open-item `Pointer:` that carries no `Anchor:` (check 16), and `co handoff resume` shows the warning. `co handoff draft`, `co run open`, and `integrate-branch.mjs` print a `links:` block.

## 2.8.0
- New `web-researcher` agent (`WebSearch, WebFetch, Read, Grep, Glob`, `sonnet` floor) answers one scoped question from public web docs, cites a URL per claim, and treats fetched pages as untrusted data. New `probe` agent (`Bash, Read, Grep, Glob`, `sonnet` floor) runs read-only shell probes such as `ssh`, `kubectl get`, and `gh api` GET calls and escalates instead of running a mutating command. Leads route web research and shell probes to them instead of a general-purpose agent.
- The handoff skill hands off on context grounds only past about 350,000 tokens, at a phase boundary. Below that line, token pressure selects CONTINUE or COMPACT, and quality triggers still select HANDOFF at any size. CONTINUE also covers remaining work that fits in about 100,000 more tokens, because a hop costs several million tokens to write and resume. The 150,000-token band, the 300,000-token ceiling, and Grok's 200,000 line are unchanged.
- Resume on `same-tree: yes` trusts the script summary: it does not reopen FRESH files or anchors or re-run gates recorded as passing at the same HEAD, and it starts the first open item in the opening round. It reads the request history in `PROGRAM.md` only when the tree moved.

## 2.7.0
- New `peer-guard` PreToolUse hook denies a cross-session message to a peer that already handed off, or wrote a handoff not yet resumed, and names the live successor. `CODE_OPS_PEER_GUARD=0` turns it off.
- `handoff draft` keeps the session's own base name ahead of the `PROGRAM.md` title, so a hop no longer renames itself. It carries the predecessor's decisions, traps, and carried context forward as lines to confirm.
- `handoff resume` and `run open` accept `--host-session <id>` and record it as `hostSessionId`; `handoff live` resolves it. Resume prints a `links:` block of markdown links and a closing `set title:` line.
- The dispatch guard binds a brief's `Round budget:` line, read once from the subagent's first transcript entry and clamped to 120. Its warning and stop require a checkpoint of done items, dirty paths, the next edit, and gates run. The implementer agent stops new edits on the warning.
- The vendored `records.mjs` and `record-lib.mjs` batch and cache fixed-object git reads, cutting git process starts per call by about 31%.

## 2.6.1
- The vendored `cli-lib.mjs` adds `exitOnHelp`, so the vendored `preflight.mjs`, `repo-map.mjs`, `import-graph.mjs`, `worker-brief.mjs`, and `records.mjs` print their usage line and exit 0 on `--help` or `-h`.
- The vendored `check-vault-standard.mjs` skips notes that git ignores, found with one `git ls-files --others --ignored` call. Tracked notes are always checked.

## 2.6.0
- The SessionStart card lists up to 3 pending handoffs by session name on a fresh session and treats the session as new work unless the operator resumes one. It prints a `this session:` line.
- After compaction, the card names the session's own run folder from its session record.
- `co run open` opens a run folder and writes the session record. `co handoff resume` accepts a session name, seeds a successor run folder, and writes a version 2 `HANDOFF.consumed` that records the session, the successor run, and the name.
- A handoff may carry `Session: <name> HO <n>` and `Hop: <n>` lines. `check-handoff.mjs` requires the two as a pair, with the Session name ending in `HO <Hop>`. A handoff without them still passes.
- `co handoff draft` refuses to write into a consumed run folder or one another session owns. `co handoff live` finds the live head of a handoff chain.
- On OpenCode, an `enabled` list that matches no host model binds no chooser model and warns. It no longer falls back to the full catalog.

## 2.5.0
- Conform surface 3 runs `atlas-check.mjs check --gate --claims-gate`. A STALE section, or a claim that is MOVED, DRIFTED, or GONE, makes the surface DRIFTED, never CONFORMANT.
- `CONVENTIONS.md`, the vault standard, and the atlas reference state that a FRESH section does not vouch for a claim reported DRIFTED or GONE. That claim is a lead, and its cited line is re-read before use.
- The vendored `digest-lib.mjs` rejects a prototype key such as `toString` as a shape name and applies the default head and tail when a count is missing. It is now type-checked.
- The vendored `acceptance-lib`, `citation-lib`, `symbol-lib`, and `cli-lib` pass `noUncheckedIndexedAccess` through guards and destructuring. Their behavior is unchanged.

## 2.4.1
- `records.mjs re-review` accepts a prior review whose source commit sits on a side branch rather than in the history of HEAD, as long as the commit still exists. The examined commits then start at its merge base with HEAD. It still refuses a prior source commit that no longer exists.

## 2.4.0
- `records.mjs re-review --collection <id> --record <path> --reviewer <name> --rationale <text> [--at <iso>]` re-reviews one admitted path whose current bytes equal the reviewed digest but whose history gained content transitions, such as an edit later restored. Before this release, `check` reported `adoption review history drift` for that path, and no command could clear it.
- The command appends a receipt to inventory `reReviews` and leaves the original review in place. The receipt records the new history profile, the prior profile digest and source commit, the path commits examined, the reviewer, and the rationale. It refuses a dirty worktree, a path without a review receipt, changed bytes, an unreachable prior source, and history without new transitions.
- `check` compares a re-reviewed path against its newest receipt and holds the `reReviews` chain append-only. Every other drift still fails.

## 2.3.0
- The dispatch guard denies a suite-agent dispatch whose brief lacks a field from that agent's `Brief requires:` line. It resolves agents across all four plugins, and `CODE_OPS_DISPATCH_GUARD=warn` turns the denial into a warning. A field counts only as a label at the start of a line or as a heading, so `Out of scope:` does not satisfy Scope. The implementer and mech agents no longer describe required brief fields as optional.
- A new advisory `SubagentStop` hook, `subagent-report.mjs`, notes a report whose first line lacks a declared verdict token or that exceeds its Report cap. `CODE_OPS_SUBAGENT_REPORT=off` disables it.
- Session receipts record a `skills` count per skill id, and `context-audit receipts` totals them.
- Skill descriptions are 160 characters or fewer; lint enforces the cap.
- The vendored `cli-lib.mjs` owns the shared Windows shim spawn helper and `sha256`; `run-proof`, `digest`, and `sync-global` use it.

## 2.2.0
- `run-contract.mjs init --run <ignored run dir> --lead-model <id>` starts a version 4 run contract. It prepares the context snapshot, writes host capabilities with every state `unknown`, and derives `head`, `runId`, the lead tier, and the runtime block. It leaves the objective, non-goals, quality, and units empty, so `check` fails until the lead fills them. It refuses to overwrite without `--force`. `co run contract init` reaches it.
- `CONVENTIONS.md`, `everything`, and the vendored run-contract references now name the init path.

## 2.1.1
- The resident context reads a compact boundary's `postTokens` as the post-compaction size, labeled `compaction`, until the next usage record.

## 2.1.0
- `conform` global scope now edits the marketplace's `global-contracts/` sources and installs them with `scripts/sync-global.mjs`, instead of editing the home files in place. The approval checkpoint is unchanged.
- The global targets now include the Grok Build rule `~/.grok/rules/code-ops-global.md`, because Grok ignores the Claude global files.
- The repo contract procedure names the `@AGENTS.md` import form as the preferred pointer pair, because Grok Build loads both file names.

## 2.0.0
- Breaking: four overlapping skills are merged, and the plugin ships 30 skills.
- `conform` absorbs `adopt-standards` and `adopt-global-standards`. Choose `scope: repo` (the default) or `scope: global` for the user-wide contracts.
- `pr-review` is removed. Use `rigor:deep-review` with `bar: standard` for the all-lens senior review.
- `normalize` gains a concept mode, `normalize concept <name>`, which closes one concept implemented divergently. It replaces `rigor:consistency-closure` and runs the strict consistency gate.
- `full-sweep` is removed. `everything` takes `plugins: suite,rigor,privacy`, defaulting to every installed plugin, skips and names the phases of an absent plugin, and adds the `assess-only`, `full`, and `feature` tracks and the leak incident path.

## 1.92.0
- Handoffs carry program lineage. `HANDOFF.md` opens with a `## Program` section naming a program ledger at `<runs root>/programs/<slug>/PROGRAM.md` and the predecessor handoff. The ledger holds the program goal, request history, scope documents, decisions, and closed items, capped at 32 KB.
- `check-handoff` fails when a handoff drops the predecessor's request or leaves a predecessor open item neither carried forward nor closed. Open items use stable `OI-<n>` ids.
- The handoff draft prefills the Program section and carries the predecessor's open items forward. The session-start pickup line names the program ledger to read first.

## 1.91.2
- The changelog drops a placeholder entry and repeated version headings. Structural lint now rejects both.

## 1.91.1
- The context-size reader returns unknown when a compaction marker (a Claude `compact_boundary` row or a Codex `compacted` row) is newer than the last usage record. The handoff-card nudge no longer reports the pre-compaction size on the first prompt after `/compact`, and the dispatch guard no longer gates on it. The first post-compaction usage record is read as before and re-arms the handoff band.

## 1.91.0
- The session model leads. A run contract records the lead model, tier, and effort; a lead below strong prints a warning, and every operative floor still holds. Convention §1 and the routing card follow the same rule.
- The suite ships `mech` for exact edits and gate runs, and `mech-review` for checking a mechanical diff against its spec, both at the sonnet floor. Every agent carries a `## Contract` section with the brief fields it requires, its edit class, its verdict tokens, and a return example that lint checks.
- Each skill reads only the CONVENTIONS sections it cites, plus the writing standard. Exploring skills consult the atlas and the symbol index first, and the index skips vendored script copies.
- The context ceiling defaults to 200,000 tokens on Grok and 300,000 elsewhere. The round stop keys on the Grok child session. `modelClassOf` places `gpt-6-sol` as frontier. The OpenCode chooser lets a specialist row set a tier only when no ladder row binds the model.
- `co handoff draft` summarizes dirty paths by directory and lists at most 20 hand-authored paths.
- CI type-checks opted-in scripts with TypeScript 7.0.2 under `strict`. The code standard names TypeScript 7 as the TypeScript floor.

## 1.90.0
- The OpenCode distribution ships a model ladder for a metered GitHub provider, with a starter profile and per-model prices. The lifecycle chooser ranks candidates by measured cost first, then by priced workload cost, then by name pattern. The cost report prices cache writes.
- `co handoff draft` writes a handoff note with the mechanical facts filled and `[FILL: ...]` placeholders for judgment. `co handoff resume` runs the redaction scan, register revalidation, runtime status, and handoff check in order. The handoff skill is smaller, opens with the assess step, and adopts a `TASKS.md` convention. The handoff check rejects a note that still carries an unfilled placeholder.
- The dispatch guard reads Grok hook payloads, including camelCase fields and the `spawn_subagent` tool.
- `lib-docs` resolves installed versions for npm, pnpm, yarn, Python, Rust, Go, and .NET from the lockfile first. A miss exits 3 and lists the searched paths.
- The code standard adds a strictness floor that a repository adopts and never lowers, per language. The overbuild scan adds advisory tells for new suppressions, placeholder comments, and emoji in code, and reports net lines. Benchmarks report the median absolute deviation. Convention §11 requires a current-docs lookup before code that depends on a library.

## 1.89.0
- The dispatch guard gates the lead's own dispatch past a context ceiling. At 300,000 tokens of resident context, a new `Agent`, `Task`, or `Workflow` dispatch is denied until `code-ops-suite:handoff assess` runs. The assessment unlocks dispatch until the next 150,000-token band. `CODE_OPS_CONTEXT_CEILING` takes `off` to disable the gate or an integer of at least 150,000 to move it. A host without a skill tool records the assessment with `dispatch-guard.mjs assessed --session <id> --band <n>`. OpenCode records it from the `skill` tool or the typed handoff command. A 10-day audit found lead turns above 300,000 tokens spending 2.68 billion of 3.69 billion lead input tokens.
- The dispatch guard denies a `general-purpose`, `claude`, `fork`, or unnamed agent type unless the brief carries a `Wide-surface reason:` line. A `Workflow` script whose `agent(` call names no `agentType` is denied the same way. General-purpose operatives carried 29% of the audit's input tokens.
- The unregistered round stop moves from three times to twice the round budget on every host. Reviewers averaged about 90 rounds, under the old 120-round stop.
- `CODE_OPS_DISPATCH_GUARD=warn` turns each deny into an advisory, except a deny for a malformed or unavailable controller binding.
- The handoff nudge adds that new dispatches stay gated once context reaches the ceiling.
- Each agent definition carries a `Report cap: at most N words` line: 600 for `reviewer` and `implementer`, 400 for `explorer`. Lint check 25 fails an agent with no cap or a cap outside 100 to 800 words.
- Run Contract version 4 accepts an optional `orchestration.singleUnitReason` of at most 20 words, which lowers `minOperatives` and `minParallel` to 1. Without it the two-operative floor holds.
- `check-handoff.mjs` prints `same-tree: Verified-at matches HEAD on a clean tree` when the handoff's sha is HEAD and only the handoff file is dirty. A same-tree resume accepts FRESH anchors without re-reading each file. Register revalidation still runs.
- The dispatch brief template gains `Report cap` and `Wide-surface reason` lines. `MEASUREMENTS.md` pre-registers the ceiling gate and wide-type deny against the audit baseline and records the startup-context split with its operator levers.

## 1.88.0
- The session routing card stays a short route list. `full-sweep` reads only the convention sections its opening paragraph names.
- On Grok Build, headless Grok, and the ACP agent, the handoff nudge is a PostToolUse note read from `updates.jsonl`. UserPromptSubmit stdout stays discarded. The session receipt records `handoffCard` from its switch. The handoff skill reads four convention sections instead of the whole file.
- The default ladder now pins Claude Opus 5.5 at strong, GPT-6 Luna at light, GPT-6 Sol at frontier, and Grok 4.7 on every xAI rung. Previous pins and the reseller spellings still satisfy the same floors. Grok Build 0.1 is a light specialist, not a default rung.
- OpenCode ships `plugins/code-ops-lifecycle.js` and `code-ops/cost-report.mjs`. The system cards stay byte-identical across model calls. Handoff, routing, and dispatch notes ride on the next tool result or user turn. The cost ledger is checked with `cost-report.mjs --check`.
- The model-floor gate resolves a tier clone to its base agent and a reseller model by bare id. A model the verified table does not name still fails closed.
- On Grok, where hook stdout is ignored, the lead assesses continue, compact, or hand off at 150,000 tokens and again before 200,000, because Grok 4.7 bills double above that line.

## 1.87.0
- Assess whether to continue, compact, or hand off using task state and observed host capabilities.
- Replace token-band restart instructions with assessment reminders while preserving marker, rearm, and pickup behavior.
- Preserve durable state before transitions, distinguish recommendations from execution, and cover version 3 and 4 runtime recovery.

## 1.86.0
- Bind explicit worker budgets to known agent identities and expose sanitized control receipts while preserving unbound host fallbacks.
- Add task-based routing decisions with role floors, bounded frontier exceptions, selective worker context, and separate cache-charge reporting.

## 1.85.1
- `record-lib.mjs` now parses both path fields in a Git copy record (`C<score>`), matching rename handling. Earlier releases read only the source path. The copy then looked like a source modification. `git log --follow` detects copies. Adding a file at least 50% similar to an adopted immutable record therefore changed its history profile. `records.mjs check` then reported `adoption review history drift`, which repository-side changes could not clear.
- Adoption history profiles ignore copy records. A copy is a plain add of its destination, which the exact-path pass already reports, and it never joins the lineage of its source.
- Reviews from releases through 1.85.0 can store the old reading. This mostly affects empty files, which Git reports as `C100` copy chains. `records.mjs check` accepts such a review only when it equals the old reading exactly. The bound includes only copies in commits reachable from the review's `sourceHead`. A later copy cannot drift the source. Other mismatches still fail, and `adoptionHistory` is exported so both readings share one history pass.

## 1.85.0
- The `SessionStart` routing card ends a fresh session with one line naming the newest pending handoff: the file, the date it was written, and the direction to resume from it, verify its claims, and open the reply with a five-heading recap. Discovery reads two bounded directory levels under each `<repo>-docs/80 Runs/` and the repository's own `80 Runs/`, treats a run folder holding `HANDOFF.consumed` as already picked up, and ignores anything older than 14 days. `CODE_OPS_HANDOFF_PICKUP=off` drops the line and leaves the rest of the card.
- `check-handoff.mjs` requires three more headings — Scope and constraints, Work completed, and Key findings — so the first six sections answer what an operator asks a resumed session. "Goal and state of play" must carry a non-empty `Request:` line holding the operator's original request verbatim, and every Key findings bullet must carry a `CONFIRMED`, `PROBABLE`, or `SPECULATIVE` label. The size cap is 8 KB.
- `check-handoff.mjs --consume` writes `HANDOFF.consumed`, one ISO timestamp line, beside the file and only after every check passes, which retires that handoff from the routing card's pickup line. A write failure is reported rather than swallowed.
- The `handoff` skill writes the sections in resume order, ends the write with a resume line, and directs a resumed session to recap under five headings before other work.
- The handoff card escalates with the band. Band 1 advises a handoff at the next workstream boundary; band 2 and higher asks for the handoff in this session and for no new workstream, because a session at that band already declined the first boundary.
- `hooks/dispatch-guard.mjs` runs at `PreToolUse` and binds the brief's Round budget. Inside a subagent it counts that subagent's tool calls in one append-only file per agent, warns at the budget and every further 20 rounds, and denies further calls at three times it. On the lead's own dispatch it only advises, on a `model` override, a wide-surface or context-inheriting agent type, and a brief naming no Round budget. `CODE_OPS_DISPATCH_GUARD` takes `off` to disable it or `warn` to lift only the hard stop, and `CODE_OPS_ROUND_BUDGET` overrides the 40-round default. It fails open on every other path and never denies a main-thread call.
- Session receipts record two more arms, `handoffPickup` and `dispatchGuard`, each read from its own switch the way the existing arms are. A guard set to `warn` records the arm on, because only the hard stop is lifted.

## 1.84.0
- Every session receipt records the handoff card as an arm, read from `CODE_OPS_HANDOFF_CARD` the way the digest, ladder, and index arms are read. Grok rows record it off, matching the hook's own host coverage.
- A receipt also carries `handoff`: the highest band the session's marker file reached, and whether the transcript shows the operator running `code-ops-suite:handoff` after the first prompt. A first-prompt command is a resume, and a quoted marker is not a run, so neither counts. Only the two values are stored, never transcript text, and any failure leaves band 0 with the hook still exiting 0.
- The handoff marker keeps a `peak` field, so a re-arm after a compaction lowers the live band without hiding that the session was nudged. `handoffMarkerPath` and `handoffPeakBand` in `transcript-lib.mjs` are the one definition both hooks read.
- `context-audit.mjs receipts --by-arm` groups by the handoff arm too and reports, per arm, how many sessions were nudged and how many of those handed off, which is the ratio the pre-registered decision rule reads. A row written before these fields existed still aggregates and counts in neither figure.

## 1.83.1
- The Codex render states that a role holding an edit tool edits only inside its brief's Scope. It told the `implementer` that it may write only report and repro files, which contradicted the agent's own definition.
- The changelog no longer carries two leftover placeholder bullets from the version bump script, so `integrate-branch.mjs` stops reporting a pending changelog item on a clean tree.

## 1.83.0
- The `implementer` agent ships for build, fix, and refactor units, with tools `Read, Edit, Write, Bash, Grep, Glob` and an `opus` floor in `AGENT_MODEL_FLOORS`. A transcript audit on 2026-09-18 measured general-purpose operatives starting each turn near 57,000 tokens against 18,000 to 24,000 for restricted-tool agents, and those operatives carried 787 million of one day's tokens.
- The conventions, the routing card, and `subagent-trade-offs.md` state that a dispatch costs resident context multiplied by turn count. They route build work to the `implementer`, keep breadth agents at their declared tier, and require a round budget in each brief.
- The dispatch brief template gains a Round budget field, 40 tool rounds unless stated. An operative past its budget checkpoints to its Report path and returns, and the lead continues the unit in a fresh operative.
- The handoff card nudges at 150,000 tokens of resident context and every further 150,000-token band, down from 200,000, because 71% of lead input-side tokens were spent above 200,000. `MEASUREMENTS.md` records the amendment, and the value stays SPECULATIVE.
- `context-audit.mjs` reports context shape per thread, spend by context band, cache rewrites, and subagents by agent type, and `--all` merges every project under the host transcript root.

## 1.82.0
- The OpenCode Zen free ladder binds every operative rung to `muse-spark-1.3-contributor-free`: light, mid, and strong share one model, so no operative dispatch routes below its floor. The lead stays unset and inherits the session model. The rendered `opencode-dist/opencode.json` binds every agent to that model with no top-level `model`. The routing table names the flat operatives beside the flat xAI row.
- The `opencode` provider pin is verified against the host `opencode models` list on 2026-09-17.

## 1.81.0
- `check-handoff.mjs` resolves every `path:line · Anchor:` pointer against the working tree through the resolver it now shares with the register gate in `citation-lib.mjs`, and prints one status per pointer. GONE, DRIFTED, and AMBIGUOUS fail closed. MOVED warns, or fails under `--strict-anchors`. A `Verified-at` sha that is not HEAD is an advisory, and `--root` makes the check independent of the working directory.
- `revalidate-register.mjs` reads the Severity field value alone, so a composite line such as `Severity: medium · Confidence: high` no longer reads as load-bearing and deflated at once. The anchor grammar accepts a doubled-backtick span, so an anchor copied from a line that contains a backtick parses. A backslash is still not an escape.
- The artifact grammar reserves the `LEAD-` prefix for lead-authored findings, and the `full-sweep` merge step says so, because nothing mints ids at merge time and a lead-filed finding collided with a slice id.
- A context snapshot under the `exclude` or `allowlist` untracked policy derives its identity from the files the policy admits, so a new untracked file no longer moves the snapshot id. The receipt still records how many untracked files the tree carries. The default `metadata` policy is unchanged.
- `run-runtime.mjs` requires `context.snapshot`, `context.bundleDir`, and the dispatch ledger to sit on repository-ignored paths, as the capability descriptor and receipt chain already did, and `init` prints an advisory when the contract itself is visible to Git.
- `run-contract.mjs` reports only an identifier mismatch as context snapshot drift. Generator drift, atlas drift, an unsupported untracked entry, a symlink escape, and a git timeout keep their own message and say that a new receipt will not clear them.
- A version 2 or newer contract accepts the optional `context.maxScopeShare`, a number above 0 and at most 1 that raises the 0.25 share of the repository index one unit may hold. The recursive-glob and risky-prefix triggers ignore it, and an oversized bundle still refuses rather than truncating.
- A version 4 contract refuses a refutation panel with an even number of seats, or one that repeats a lens across seats. A single refutation unit on a target is not a panel.
- `atlas-check.mjs` preserves a manifest's own indent and end-of-line on every rewrite, and the atlas skill, the atlas reference, and the calibration protocol tell a run to ignore or relocate the atlas folder on a target whose formatter scans JSON.
- `atlas-check.mjs check` prints an advisory for a sentence that compares two code sites while citing fewer than two of them and counts it in the summary line. No exit code changes. The atlas skill and reference require a comparison to cite both sites so the pair registers as two claims.

## 1.80.0
- `dispatch-ledger.mjs add` accepts `--contract <path> --unit <D-NNN>`. The row takes the contract unit id instead of the next serial id, and its role, model, brief, and artifact must match the unit. Under a version 4 contract, `add` requires `--actor-id`, refuses an actor already bound to another unit, and binds the journal to the contract run. A bound ledger refuses an unbound `add`, and a bound `update --status redispatched` requires an actor.
- `run-contract.mjs reconcile` accepts `--in-flight`. It rejects the version 4 journal violations that are permanent once they occur, and admits planned units that have not reported. `run-runtime.mjs` checkpoint, replan, resume, and verify use it instead of `--strict`, so a multi-wave run can bind a mid-run contract revision. Finalization stays strict.
- Version 4 in-flight and final reconciliation reject a journal add that is not bound to the contract run.
- A replan that skips a revision names the bound and required revisions, and states that bundles pin the contract revision.
- `CONVENTIONS.md` directs version 4 dispatch through `add --contract --unit`.
- The bundled `reference/artifact-grammars.md` states that a version 4 contract-bound `add` records `runId` in the dispatch journal, and that replay rejects a journal mixing bound and unbound adds.
- The vendored `revalidate-register.mjs` reads a register citation whose path carries spaces in unquoted prose, a Location field, a markdown link target, bold, or quotes. The longest space-joined extension that names a real in-root file wins over a shorter tail, so a same-named file elsewhere no longer captures the citation. Escaping, traversal, and dot-segment forms still read AMBIGUOUS.

## 1.79.0
- New `hooks/handoff-card.mjs` runs at `UserPromptSubmit` and is on by default, off with `CODE_OPS_HANDOFF_CARD`. It reads only the transcript tail. When resident context crosses a 200,000-token band, it suggests a handoff once per band and re-arms after compaction. Claude and Codex run it, Grok ignores its output, and OpenCode has no equivalent event. The threshold is pre-registered in `MEASUREMENTS.md` as uncalibrated.
- The `handoff` skill adds three sections. Open items carry an owner and a done-when check, Authority records grants that do not carry into the resumed session, and Carried context points at files that hold conversation-only analysis. A handoff no longer restates git history, and it stays under a 6 KB cap. Resume asks the operator to re-grant authority before publishing.
- New `check-handoff.mjs`, reachable as `co.mjs check handoff`, fails a handoff with a missing section, an item without an owner or done-when check, an imperative item, or a size over the cap.
- `provider-parity-audit` accepts `--since <sha>` to scope a follow-up audit to changed surfaces and their projections, and it carries forward unchanged host profiles.
- The vendored `revalidate-register.mjs` reads a backslash traversal, a backslash drive letter, a traversal before a dot-led or dash-led segment, an in-root symlink to an outside target, and an escaping prefix longer than its scan window as AMBIGUOUS instead of FRESH.

## 1.78.0
- The plugin now bundles six execution specs under `reference/`: artifact grammars, the atlas technique, the calibration protocol, the fleet standard, the subagent trade-offs routing table, and the vault standard. They are byte-identical copies of the hub pages, and both host packages carry them.
- Skills that fill or check those specs read the bundled copy. Other hub pages are linked as documents in the code-ops repository, and target-repository atlas and ADR paths name the `<repo>-docs/` hub.
- `check-vault-standard.mjs` points a stale `Standard.md` at the bundled vault standard. `atlas-check.mjs`, `calibration-metrics.mjs`, `estimate-run-cost.mjs`, `run-proof.mjs`, and `skim.mjs` print plugin-relative paths instead of repository-root commands.
- `provider-parity-audit` declares that it runs in the code-ops repository. `local-review-gate` Track B documents `--matrix` for a matrix tracked in another repository.
- Lint check 24 fails when shipped text names a path that resolves only inside a code-ops checkout, or when a bundled reference drifts from its hub page.

## 1.77.5
- The vendored `revalidate-register.mjs` now reads a citation whose first segment starts with a dot, such as `.github/workflows/validate.yml:1`, as the whole path instead of dropping the dot and reporting AMBIGUOUS.

## 1.77.4
- `run-contract.mjs` now rejects a calibration block whose lead model serves both the strong and frontier rungs, because such an arm runs the frontier model and cannot measure a strong-versus-frontier gap. The error names the model.
- The generated tier page now states that version 4 run contracts require a frontier lead, that a calibration block is the only exception, and that contracts take bare model ids.
- The calibration protocol states that a point release keeps its family class name in the `config:` line while it serves the same rung.

## 1.77.3
- The pinned report-persistence passage now states that a brief's report path governs over any default reporting instruction in an agent definition.
- The `reviewer` and `explorer` bodies name the shell, search, and file-read tools by capability instead of by host tool name.
- The generated role contract header states each role's write capability, derived from the canonical tools list, and the generated compatibility page and README list every bundled hook command with its purpose.
- The `transcript-lib.mjs` and `context-audit.mjs` comments name each host's transcript directory, so the projected copies no longer point at a wrong path.

## 1.77.2
- The repository contract now names the hook event and skill-id form each host uses, and the infrastructure page gives store paths under the host home.
- The `provider-parity-audit` skill drops the repository-root `grok plugin validate` probe, which found no manifest and checked nothing. The per-plugin validations remain.

## 1.77.1
- The `enforce-traceless` hook now blocks an attribution trailer passed as a second `-m` value, a `--message=` or `--trailer` value, or an inline `gh pr create --body`. It runs the vendored `scan-ai-tells.mjs` in its new `--command` mode, which scans the raw command plus each message, trailer, title, body, and field value that `git commit`, `gh pr create|edit|merge`, or `gh api` would publish, each on its own line. Heredoc detection is unchanged, and a trailer phrase outside a published argument still passes.
- The hook header now names its real fail-closed backstop: the new `Traceless publishing (PR commits, title, body)` CI step, which scans every pull request's commits, title, and body.

## 1.77.0
- Version 4 contracts accept an optional `calibration` block for arms (b) and (c) that requires a strong lead, read-mode units, and artifacts outside every scope. Under a valid block, units may run at the lead tier but never above it.

## 1.76.0
- New pinned `CONVENTIONS.md` §15, Code standard. It carries the house code standard's core clause: design every change first, write the smallest correct solution, abstract only on evidence, measure before micro-optimizing, comment reasons, verify in proportion to risk, and never repeat an unchanged check.

## 1.75.0
- An operative with a write tool now writes its report to the path its brief names and returns only a pointer, so the lead no longer re-emits report bodies; a read-only operative still returns its report inline for the lead to persist. `dispatch-ledger.mjs update --status reported` gains `--report` and `--sections`, which refuse a missing, empty, or section-less report file and leave the row and journal unchanged.

## 1.74.1
- `revalidate-register` now reads citations with bracketed route segments such as `[id]` and `[...slug]` and route groups such as `(auth)` as the full path, instead of reporting an in-repo file as escaping root. A register item citation inside backticks may also carry spaces in its path. Refutation receipts now read their cited path and line correctly, so a valid REFUTED receipt passes and a traversal citation still fails confinement.

## 1.74.0
- Substantive runs now use an enforced frontier-lead and strong-operative graph. Version 4 run contracts require multiple operatives, a real parallel wave, lower-tier operative routing, explicit independent-validation relationships, and nonempty operative artifacts before finalization.
- Security campaigns declare distinct exploit families and terminal hypothesis states. The new attack-chain compiler bans history and advisory shortcuts, requires direct implementation evidence and realistic privilege-to-impact closure, traces reverse collisions to terminal nodes, and ranks open chains for independent validation.
- Hook payload adapters accept Claude and Codex command, edit, and session shapes. Codex projections preserve machine-readable agent floors and host-native settings and storage prose, while OpenCode projections translate portable skill references and expose only capabilities backed by its runtime API.
- Provider-parity repairs stop claiming ignored passive-hook output, restore Codex child-rollout accounting, parse Grok usage updates, preserve cross-host standards paths during rendering, and keep read-only operatives within their declared tools. Regression coverage now includes every `co.mjs` domain and the digest hook's context overhead.
- `provider-parity-audit` now covers Claude, Codex, installed Grok, and OpenCode across hooks,
  agents, skills, scripts, settings, manifests, both renderers, generated distributions, and
  documented API gaps. It separates output-shape probes from live external-turn evidence.

## 1.73.0
- Orchestrated runs gain partial acceptance, bounded runtime status, per-unit token envelopes, and attributed model and reasoning-token observations. These controls preserve continuity across compaction and make overruns visible without expanding worker context.
- Context bundles can compile verified unit views, and `worker-brief.mjs` builds deterministic two-part briefs with separate invariant, unit, and total byte limits. It fails instead of truncating, rejects portable path aliases that could overwrite an input, and verifies both source and output hashes before reuse.
- Context auditing normalizes Claude and Codex usage into provider-neutral categories. The cost estimator binds each runtime receipt chain to its finalized contract and can apply a dated operator-supplied price snapshot. It reports only an attributed observed subtotal, never a provider-invoice total, and refuses unrelated model history.
- The Anthropic frontier binding advances to Fable 5.1. Interaction doctrine now favors safe action over unnecessary clarification, while preserving checkpoints for consequential decisions and new authority.
- Global-standard adoption now maintains Claude's byte-identical global pair and Codex's host-specific `AGENTS.md` as separate contracts. It consolidates repeated prose while preserving rule meaning, preventing future refreshes from recreating cross-host drift.

## 1.72.1
- Astra is an explicit premium frontier specialist for bounded architecture, refutation, and cross-domain synthesis. Sol remains the ready-made OpenAI lead, so ordinary runs do not inherit Astra's 2.5-times token price. Shared model capability and rank helpers admit the specialist without misclassifying repeated-rung models during acceptance.
- The Codex renderer caps its projected `SessionEnd` timeout at the desktop host's three-second ceiling while preserving the canonical Claude timeout. A renderer regression pins the host-specific transform.
- Hook documentation distinguishes the intentional traceless-publishing block from the six fail-open hooks and corrects the storage-variable taxonomy.
- The Moonshot light tier advances from the retired `kimi-k2.5` registry id to `kimi-k2.6`; every non-CLI provider pin resolves in the 2026-09-13 models.dev snapshot.

## 1.72.0
- `digest.mjs` passes a short output through raw: an output of at most `--passthrough-below` bytes (default 1536), or one the digest cannot make smaller than the raw bytes, is printed on its own streams with no trailer, no raw file, and no receipt row. `--passthrough-below 0` turns pass-through off and `--json` never passes through. The session measurement of 2026-09-03 found 77 of 84 receipted commands paid more in trailer than they saved, which is what this closes. The digest hook's context line and `evals/digest` pin the new contract.

## 1.71.0
- The plugin README and all 34 skill pages move onto the house writing standard: no em-dashes and no semicolons in prose, one instruction per sentence, active voice, noun-phrase headings, and Done-when sections written as vertical lists rather than semicolon chains. The pinned always-gated clause in `everything` stays byte-identical.
- The pages that touch the context-economy mechanisms now name them and their off switches. The README gains the `co.mjs` entrypoint and `cli-lib.mjs`, `skim.mjs`, the PreCompact preservation hook, and the session receipts with `context-audit.mjs receipts --by-arm` and `--purge-before`. `full-sweep` names `skim.mjs` and `context-query.mjs` at Phase 0, `run-cost-audit` reads the receipt ledger by arm, and `codebase-audit`, `pr-review`, `normalize`, and `ship` name `co.mjs scan overbuild` as the mechanical floor under the size-and-boundary lens.
- The README's code-economy bullet reaches the scan domain through `co.mjs scan overbuild` and `co.mjs scan deferrals` instead of the direct script paths.
- `calibration-run` names the two `lesson:` line shapes as the parser's literal grammar, and writes the handover config line as a class template rather than two model names.
## 1.70.0
- `CONVENTIONS.md`, both agent definitions, and the pinned doctrine sentences rewritten to the house writing standard: no em-dashes and no semicolons in prose, one instruction per sentence, and headings as noun phrases. Meaning is unchanged, and every pinned sentence moved in the linter table, the eval mirror, and every listed copy in one commit. `CONVENTIONS.md` §1 and §2 now name the session mechanisms that are on by default and their off switches, and the stale "opt-in" note on the `index-refresh.mjs` hook in `context-query.mjs` is corrected.
## 1.69.0
- `model-tiers.mjs` gains the `opencode` provider: the OpenCode Zen free ladder (`ling-3.0-flash-fin-free` light, `nemotron-3.5-lightning-free` mid, `mimo-v2.5-free` strong) with the lead unset, and it becomes `DEFAULT_PROVIDER`, so the rendered `opencode-dist/opencode.json` binds every agent to a free model that clears its floor and carries no top-level `model`. The lead inherits the session model and a fresh install costs nothing.
- A provider may leave `frontier` null (`leadInherits`) and declare `registry: 'cli'` with a `verifiedAt` date. The renderer then omits the top-level `model`, MODEL_TIERS.md says the lead is unset, `check-model-registry.mjs` skips the models.dev fetch for that provider, and `evals/opencode-dist` pins the unset lead and the publish-command ask rules on the default config.

## 1.68.0
- `scan-overbuild.mjs` writes its tree-grep patterns with POSIX classes, because `git grep -E` on macOS runs the system regex, which has no `\s`, `\w`, or `\b`, so the single-implementor and duplicate-helper tells matched nothing there. The first macOS host-eval run found it.

## 1.67.0
- `symbol-lib.mjs` is now the single source of the definition rules and the import extraction for all four readers. `repo-map.mjs` takes its definition table from `CODE` and keeps only the Markdown heading row, and `import-graph.mjs` takes both the extraction and the resolution from `imports()` and walks exactly the extensions `IMPORT_EXTS` names. Map and graph output over this repository is byte-identical to the copies it replaces.
- `imports()` covers JavaScript, Python, Go, and Rust, and its edge carries `relative` and `dynamic` beside `spec`, `target`, and `names`. So the graph still separates an unresolved path in the tree from a package name, and still notes a non-literal `import(...)` rather than dropping it, while the index sees the same edges.
- `evals/context-query` gains a Go file and a Rust file whose relative edges `blast` must resolve, pinning the shared extraction from the index side.

## 1.66.0
- The `scan` domain moves onto `cli-lib.mjs`: `scan-ai-tells.mjs`, `scan-narration.mjs`, `scan-redaction.mjs`, `scan-injection-tells.mjs`, `check-autofix-scope.mjs`, `scan-overbuild.mjs`, and `harvest-deferrals.mjs` drop their hand-rolled argv loops for `parseFlags` and `parseOrDie`. Every flag, positional, exit code, and message stays as it was, and the seven regression evals pass untouched.
- `parseFlags` gains three opt-in rule keys: `many` for a repeatable flag, `raw` for a flag whose own check must see a smuggled option, and `missing` for the wording a caller already pins.
- `debug`, `handoff`, `pr-split`, `run-cost-audit`, and `ship` invoke these scripts as `co.mjs scan <verb>` instead of by path. The direct paths still work.
- `lint-plugins.mjs` resolves a façade reference through co.mjs's verb table, so `co.mjs scan <verb>` carries the same bundling requirement as the direct path, and a verb the table does not carry fails closed.

## 1.65.0
- The output digest, the index refresh, and the ladder card are on by default. Each hook runs unless its switch (`CODE_OPS_DIGEST`, `CODE_OPS_INDEX`, `CODE_OPS_LADDER_CARD`) holds `off`, `0`, or `false`, which a user or a repository sets in the host environment. The session receipt records each arm as on unless its switch said off, and the measurement page's control is a run with the switches off.
- The SessionStart card carries three more lines from the current-model prompting guide: say what you are about to do and close with a recap that stands on its own, only you see a command's output, and the context-economy rules in one line.
- The workflow gains a macOS job that runs the host-facing evals on the weekly schedule and on demand, never per pull request, because the operator works on Windows and macOS and macOS minutes cost ten Linux minutes.

## 1.64.0
- `context-audit.mjs receipts --purge-before <ISO date>` is the receipt ledger's retention: it rewrites the ledger keeping rows at or after the date, through a scratch file renamed over the original, and reports the count removed. Nothing purges on its own.
- The digest rewrite contract says how to mirror a read-only allow rule for the wrapped form: pin the script name and the family with a wildcard, never a bare `node` rule.

## 1.63.0
- Atlas freshness reaches claim granularity. A claim is a `path:line` citation in a section's prose. `scripts/atlas-check.mjs stamp` records one per citation in `MANIFEST.json` as `{ file, line, anchor }`, with the anchor copied verbatim from the cited line: trimmed, backtick-free, at most 80 characters, and replaced by the `<REDACTED-LINE>` sentinel on a credential-shaped line.
- `atlas-check.mjs check` prints each section's claim report beneath its freshness verdict, classified by `revalidate-register.mjs` over one temporary register the check deletes when it ends. Two freshness mechanisms become one: the atlas and a findings register cannot disagree about what a drifted citation is. A section citing nothing reports `claims: none`.
- `--claims-gate` exits 1 on any claim the classifier did not call FRESH, an unclassifiable one included. It is separate from `--gate`, and the digest verdict keeps its existing meaning. A malformed claim fails the manifest closed.
- `atlas-check.mjs scope <slug> --suggest` prints the depth-1 importers of a section's scope, read from `context-query.mjs blast --json`, as a pathspec list for `add --scope`. It writes nothing and exits 1 when no symbol index exists.
- `scripts/judgment-evals.mjs` gains `--mode register`. A matrix fixture declares `arms`, a list of model tiers, and the planner compiles one unit per tier against the same skill and answer key, naming the tier in the id the score receipt is keyed by. `evals/judgment-matrix.json` declares the arm on `bug-garden`. Trend and floor expansions are unchanged.
## 1.62.0
- `context-query.mjs refresh --provider ctags|codegraph|none` adds two optional fidelity providers, detected at use and treated as data. With `ctags` an installed Universal Ctags runs over the files about to be parsed and its definitions merge into a file only on a line the line rules left free, each marked `source` and mapped onto the index's own kinds. `codegraph` is detected and reported, not ingested. A provider that is absent prints one line and the line rules stand alone, so a refresh never fails for a missing tool. The index records the providers its definitions came from and `status` prints them.
- `preflight.mjs` prints `ctags` and `codegraph` as present or absent beside its other capability lines. Neither absence can fail a preflight.
- `scripts/context-query-mcp.mjs` is the `code-ops-query` MCP server: a newline-delimited JSON-RPC 2.0 stdio server offering `context_query` and `context_refresh`, so a host with no shell reaches the same index. Every bad request answers with a JSON-RPC error rather than a process exit.
- The Codex renderer derives `.mcp.json` from the canonical manifest instead of a hand-kept list, and its check fails when a declared server or its bundled script is missing.
- `evals/context-query-mcp` pins the server end to end; `evals/context-query` gains the provider contract.

## 1.61.0
- `hooks/session-receipt.mjs` records `arms` (which of `CODE_OPS_DIGEST`, `CODE_OPS_LADDER_CARD`, and `CODE_OPS_INDEX` the session ran under) and `contextAtEnd` (the tokens the last assistant message carried in) on every row. `context-audit.mjs receipts --by-arm` groups rows by that record and prints per-session means, so an arm reads against its control. The measurement page pre-registers the schedule and the decision rules.

## 1.60.0
- `scripts/context-query.mjs` is the query-able symbol index: `find`, `callers`, `callees`, `blast`, and `explore` answer with `file:line` anchors, one-line signatures, and edge lists over a home-directory index keyed by content sha, never a verbatim dump. A call resolves same-file, then through an imported name (aliases included), then tree-wide as ambiguous, else unresolved, and the ceiling is printed on every edge result. A result touching a file changed since the build carries a stale banner. `explore` stops at `--budget` with `BUDGET_EXCEEDED` and appends bodies only under `--with-source`.
- `scripts/symbol-lib.mjs` holds the definition rules, definition spans, call sites, and import edges. `skim.mjs` now imports its rules from it, so the outline and the index agree.
- `hooks/index-refresh.mjs` is a third opt-in hook, at `PostToolUse` on Edit, Write, MultiEdit, and NotebookEdit: with `CODE_OPS_INDEX` on it re-indexes the edited file with a five-second budget and prints nothing.
- `co context query <command>` reaches the tool; `evals/context-query` pins the contract end to end.

## 1.59.0
- `scripts/scan-overbuild.mjs --git <range>` is the mechanical floor under the ladder: eight deterministic tells on a diff (a burst of small new files, a one-implementor interface, a pass-through function, an unrecorded dependency, an oversized test file, an unread root config key, a duplicate export, and commented-out code), advisory except the unrecorded dependency, which exits 1. `--exclude <prefix>` drops derived copies, and a byte-identical vendored copy never counts as a duplicate. `evals/overbuild-garden` scores it at a 0.9 recall bar with zero decoys over legitimate extractions and proves the eval can fail.
- `scripts/harvest-deferrals.mjs` collects `deferred(<ceiling>, <upgrade path>)` markers from comments into `DEFERRALS_REGISTER.md`, in the grammar `revalidate-register.mjs` re-greps, with ids that survive a line move. `--check` reports drift. `evals/deferral-harvest` pins the shape, the decoys, and the ids.
- `hooks/ladder-card.mjs` is a second opt-in hook, at `SubagentStart`: with `CODE_OPS_LADDER_CARD` on it hands an implementer-class subagent the ladder as a ten-line card and stays silent for every read-only type. The host field it reads was verified against the installed bundle. It is an experiment arm decided in Phase 6.
- `co scan overbuild` and `co scan deferrals` reach the two scripts.

## 1.58.0
- The implementation loop carries the code-economy ladder: the objective is ordered (correctness and the safety floor, module boundaries, measured performance, readability, then size), and a change climbs six rungs before new code is written. Both sentences are pinned byte-identically across the code-ops-suite, rigor, and privacy-opsec-suite conventions. A deliberate simplification is marked `deferred(<ceiling>, <upgrade path>)`.
- `pr-review` and the quality lenses gain a size-and-boundary lens, `normalize` rule F extracts only on the ladder's evidence, and the dispatch brief template carries a `Size discipline:` line for implementer briefs.

## 1.57.1
- `hooks/digest-rewrite.mjs` drops `gh api` from the allowlist, because an API answer is read by a parser and a digest of it is the wrong tool. One boolean now decides both the `--no-store` flag and the context line, so a command carrying a literal `--no-store` argument with the store on keeps its recovery hint.
- `scripts/digest.mjs` and the contracts, data-model, and infrastructure pages state that `--no-store` or `CODE_OPS_DIGEST_STORE=off` outranks `--store` and `$CODE_OPS_DIGEST_DIR`.

## 1.57.0
- `hooks/digest-rewrite.mjs` is a second `PreToolUse` Bash stage that rewrites an allowlisted simple command into a `digest.mjs` run through `updatedInput`, so tool output enters the context compressed and receipted. It is opt-in and off everywhere: without `CODE_OPS_DIGEST` set to `1`, `on`, or `true` it exits 0 before reading the payload. A repository turns it on through the host environment.
- The rewrite is narrow by contract. One optional leading `cd <dir> &&` becomes `--cwd <dir>`; anything else carrying a pipe, list, redirect, expansion, subshell, or heredoc passes through, as does a token outside the bare or plain double-quoted forms, a command word outside the family allowlist, a `gh` call asking for structured output, a command already wrapped in the digest, and any command over 2000 characters. The hook returns no permission decision, because the installed host re-runs its whole permission evaluation against the rewritten command.
- `scripts/digest.mjs` takes `--cwd <dir>`, which becomes the working directory for the spawn, the Windows shim lookup, the in-repository frame test, the default store slug, and the receipt row. A `--cwd` naming no directory exits 2.
- `evals/digest-hook/run.mjs` pins the switch, the rewrite shape, the pass-through set, the absent permission decision, and `--cwd` end to end, and proves the pipe refusal can fail by removing it from both guards.

## 1.56.0
- `scripts/digest.mjs` runs a command, writes the raw output to a local receipt store, and prints a shape-keyed compression of it: unified diffs, compiler and linter diagnostics, test-runner output, stack traces, log streams, tables, file listings, and JSON each get their own detector and stages, and an unrecognized shape passes through under a line cap. The child's exit code always becomes the digest's exit code, every elided region prints the `sed -n 'A,Bp'` that recovers it, and the trailer names the exit code, the shape, the before-and-after line counts, and the raw file's sha256.
- The compression is loss-bounded by contract, not by intent. `digest-lib.mjs` computes the must-keep line set before any stage runs, and no stage may drop or rewrite a line in it: every error, failure, or refusal line, the final line, failing test names and the summary, diff and hunk headers, and one line per file that had a diagnostic. `evals/digest/run.mjs` proves retention and reduction together over an eleven-file corpus, and proves the contract can fail by applying the tail cap alone.
- `co context digest -- <cmd>` reaches the same script through the entrypoint façade.

## 1.55.0
- `scripts/skim.mjs` prints a file's outline — Markdown headings with flat section spans, code definitions with import and export rows, top-level JSON keys with array lengths, JSONL record keys, and a marker preview for unstructured text — so an operative reads `--range A,B` instead of the whole file. Outline mode prints names and headings, never bodies; an outline past `--max` ends with a `+N more` line. `co context skim` reaches it.
- The "Skim huge files, then deepen" convention now names the tool that does it.

## 1.54.0
- The model review gates are opt-in. `ship` asks at its first checkpoint whether to run them, recommends yes only for a high-risk surface or a delegated review, and otherwise ships on the deterministic chain and the lead's own diff read. `local-review-gate` opens with a checkpoint and never starts from another skill's judgment. `pr-split` follows the same rule per branch. The conventions carry the rule as a safety rail.

## 1.53.0
- `scripts/co.mjs` is one entrypoint over the canonical scripts: `co <domain> <verb> [args...]` resolves the verb to a sibling script through a static table, rewrites `process.argv`, and imports it, so the wrapped script's exit code and output are its own. `co --help` lists every domain and verb; an unknown domain, an unknown verb, or a verb whose script this plugin does not vendor exits 2.
- `scripts/cli-lib.mjs` collects the flag parser, usage and exit helpers, git wrapper, and file walker that the canonical scripts had rewritten one per file. No script migrates onto it in this release; it ships beside `co.mjs` so the first domain migration is a one-file diff.

## 1.52.0
- Doctrine aligned with the current frontier-model prompting guidance: operatives batch independent tool calls in one round, the lead dispatches in the background and continues independent work, every plugin's conventions carry a finish-the-turn check, the implementation loop keeps changes and committed tests to what the task asks, edits are surgical, and a sourcing brief never runs at low effort. Effort level names are declared non-portable across model generations.
- A `PreCompact` hook prints the six-item preservation instruction, which the host reads as the compaction's custom instructions, and tells the summary to leave redaction markers as they stand. `handoff` keeps the developer's constraints and open promises in their exact words.
- `session-receipt.mjs` honors `CODE_OPS_RECEIPTS=off`. The context-audit eval now proves `receipts --all` against a second directory, pins the order of the largest results, and covers the off switch. Data-model and observability citations corrected.
- The narration scanner reports mannered prose as an advisory, and the writing standard gains its definition and a formatting rule.

## 1.51.0
- `context-audit.mjs` reads the host's local session transcripts and reports exact token usage by class (input, cache read, cache creation, output, thinking), deduplicated by message id, with main and subagent threads apart. It also reports context characters by tool, Bash output by command family, repeat reads, and the largest results. Output is sanitized by default; `--raw` keeps truncated commands and paths for local inspection.
- A `SessionEnd` hook appends one receipt row per session to `~/.codex/code-ops/session-receipts.jsonl` (or `$CODE_OPS_RECEIPTS`): tokens by class, tool calls, model mix, and wall time. It prints nothing to the model, sends nothing off the machine, and fails open. `context-audit.mjs receipts` summarizes the ledger.
- `transcript-lib.mjs` is the shared parser behind both, vendored with the plugin.

## 1.50.0
- Run Contract v3 adds an explicit host-capability policy, a bounded ordered stable prefix, and a runtime receipt location while preserving v1 and v2 compatibility.
- Long-horizon runs can initialize, checkpoint, replan, resume, verify, and measure one hash-chained runtime record without duplicating dispatch, acceptance, Atlas, snapshot, or handoff authority.
- Cache acceleration remains host-owned. Code Ops emits exact cache-ready prefix bytes, records managed or unavailable fallbacks, and aggregates normalized provider cache token telemetry when the host exposes it.
- Runtime receipts and default metrics retain only the capability-descriptor digest, states, and policy outcomes. Capability initialization refuses Git-visible or linked outputs before writing raw provenance. Stable prefixes reject linked or non-regular index entries, and context snapshots reject hidden Git-index state.
- `local-review-gate` moves deep review and OpSec judgment before PR creation. Exact base, HEAD, binary diff, report, reviewer, and receipt identities bind optional GitHub commit statuses to the reviewed SHA.
- One tracked judgment matrix now plans provider-neutral local trend and model-floor runs. Deterministic scoring writes a digest-bound receipt; hosted Actions no longer spend model time on review or calibration.
- Local review and judgment planning reject hidden Git index flags before reading worktree state. Ignored authority outputs cannot portably alias tracked Git paths. Judgment authority paths also reject linked components and physical output aliases, with lossless device and inode comparison on Windows. Runtime authority paths reject portable and physical aliases, while receipt replay accepts only exact SHA-1 or SHA-256 object IDs.

## 1.49.1
- The shipped pull-request workflow example now pins checkout and the Codex action to reviewed immutable commits.

## 1.49.0
- Record history profiling batches HEAD tree lookups and historical blob hashing. Receipt-source checks and reachable-blob recovery use bounded batch reads; historical blobs above the 32 MiB batch ceiling fall back to individual reads under Git's existing 64 MiB process bound. The 32 MiB current-record policy is unchanged.
- Per-command caches reuse repository completeness, manifest history, and object format without crossing operation boundaries. Every authority check remains fail-closed.
- At 213 cases, the Windows record eval fell from 1,031.356 to 659.283 seconds (36.1%). The 200-record profile fell from 42.553 to a median 8.634 seconds.
- Windows CI now allows 20 minutes because this release expands the record contract from 165 to 227 platform-applicable cases. The timeout preserves the complete workload and bounded hosted-runner headroom; the 213-case measurement above is optimization evidence, not the final suite runtime.
- The traceless scanner excludes box-drawing glyphs and non-pictographic topology arrows while still blocking bare BMP and supplemental pictographs, default emoji, flags, variation-selector emoji, and keycaps. `--emdash-baseline-rev` measures net dash-count growth against the same tracked path at an ancestor commit. Arbitrary baseline files are rejected, and hard tells still scan the complete current text.
- Authority verification re-derives native exact-path history, batch-introduction commits, introduction-state manifests, and complete predecessor bindings. Reachable adoption sources must contain the reviewed candidates, the bound manifest, and the complete candidate history profiles. Operational classification parses the canonical Git-index manifest, so checkout filters cannot substitute worktree-only policy. Native writes reject visible worktree drift and staged manifest movement during the transaction. A fresh v3 collection cannot claim a v2 migration.
- Every generated-authority writer uses shared post-write semantic verification and restores the prior generated state on failure. The manifest index snapshot is checked at both transaction boundaries, including when history is shallow. Stale-lock recovery binds directory identity and preserves a replacement lease. Ordinary cleanup failures retain durable success, while lost ownership exits 3 with an explicit do-not-retry result.
- Genesis review slots require receipt version 1. Incremental authority batches require their embedded receipt version 2, so a receipt cannot select its own authority schema.
- Adopted collections now accept committed immutable paths through reviewed incremental admission.
- Inventory v3 records exact-once authority membership in one hash-chained history. Curation status stays in its separate ledger.
- Empty incremental deltas are write-free no-ops unless `--require-delta` requests strict intake.
- The first non-empty v2 mutation records a receipted migration without changing existing authority objects.
- Authority batches reject record or artifact provenance that contradicts the admission type. Native objects bind a reachable pre-admission tree that proves their paths were absent. V2 migration alone preserves provenance-less legacy artifacts.
- Every authority writer uses one clone-wide collection lock, optimistic bindings, and atomic rollback.
- Vault guidance directs scheduled recovery to unique branches in isolated worktrees and freezes adopted archive paths in place.

## 1.48.3
- Record-prefix checks now mask fenced examples and unambiguous top-level indented blocks while leaving inline, list, and ambiguous indented IDs visible. Citation extraction retains its broader indented-block exclusion. Blockquote- and list-scoped fences stop at their container boundary, invalid backtick info strings remain prose, and genuinely unterminated top-level fences fail before any citation path can hide later references.

## 1.48.2
- Record conformance now hashes canonical stage-0 Git blobs and separately checks semantic index-to-worktree divergence. Batched, binary-safe Git snapshots preserve immutable authority across `autocrlf`, mixed historical line endings, and clean/smudge filters without hiding staged or unstaged changes. Individual collection blobs over 32 MiB fail closed before content loading.
- Native append, citation verification, curation ledgers, legacy pointers, and adoption-review manifest bindings use the same Git boundary. Review-plan errors and guidance now state that receipt paths must be repository-relative and ignored.

## 1.48.1
- Atlas checks reuse tracked paths already present in each scoped digest and cache repeated immutable revision pins. The normal seven-section check launches 11 fewer Git subprocesses without changing digest bytes, liveness rules, or fail-closed behavior. Optional `check --stats` output makes the process budget executable.

## 1.48.0
- Record adoption now anchors identity to the reviewed current exact-path admission. Delete-and-readd and rename-back histories adopt the surviving path incarnation.
- History profiling follows promotion lineages and first-parent merge diffs. Per-path queries own rename evidence, while bounded exact-path batches add non-rename events. Path, event, batch-count, and process-argument ceilings keep the work bounded.
- Scope classification v2 adds stable scope IDs, glob arrays, and exact tracked-path arrays. Exact paths outrank broad globs. Version 1 keeps exact-one semantics.
- Adoption separates partition validity from history readiness. Historically revised immutable candidates require a current digest-bound review plan. Inventory v2 preserves the receipt, exact-path introduction commit, and citation baseline commit.
- `classify` returns `{ classificationStatus, adoptionReadiness, rows }`. Invalid classification takes precedence over unavailable history. Callers do not need to infer status from row details.
- Post-adoption checks apply one rewrite-tolerant rule. They verify original-candidate coverage, current bytes, classification, risk consistency, rationale coverage, and non-increasing risk counts.
- Native append accepts only new record and immutable-artifact paths without reachable history. Existing paths route through reviewed adoption.
- Incomplete history warns during ordinary checks and fails strict verification as infrastructure. `sourceHead` cannot select weaker verification.
- Regressions cover promotion, path reuse, long Windows arguments, refusal atomicity, receipt tampering, inventory monotonicity, migration, and content-preserving history rewrites.

## 1.47.1
- Record commands canonicalize an aliased repository root once at entry while retaining physical containment checks for every descendant write. Cross-platform regressions prove ambient junctions or symlinks work and linked output paths still fail before mutation.
- The record-collection eval now reports executed and expected case counts on success and unexpected aborts, initializes fixtures inside the failure boundary, and safely reports non-Error throws.
- Documentation citation checks now validate recognized commit fields as complete, object-format-aware commit IDs with durable `HEAD` ancestry. Shallow history is an infrastructure failure, fenced examples and third-party pins stay outside the grammar, and the original line-citation coverage remains intact.
- Legacy authored-document stamps were semantically reviewed against a durable base. Four stale claims were corrected, and the documentation-hub ADR now cites its reachable merge commit.

## 1.47.0
- **Vault standard v4 preserves immutable evidence without preserving a second documentation authority.** Manifest-v2 record collections assign permanent Git-index-derived IDs, freeze adopted bytes, capture citation state and mutable-target digests, and expose semantic indexes from the authored hub. The records engine fails closed on incomplete classification, shallow adoption, immutable drift, broken curation chains, and lost complete-history evidence.
- **Documentation extraction stays bounded as evidence collections grow.** One exact repository map still serves the run, while affected collections contribute only their generated inventory and index. Record bodies are fetched by ID when a domain needs them, and unchanged collections create no dispatch.
- **Migration is explicit and recoverable.** Adoption happens before authored moves, corrections append full curation state, legacy pointers require mechanical evidence, tombstones require explicit adoption, and Git object IDs remain regenerable locators beneath authoritative SHA-256 digests.

## 1.46.0
- **Atlas freshness now survives squash merges and branch deletion.** Default stamps add a versioned `verifiedDigest` over exact scope declarations, the raw staged index, and the raw index-to-worktree delta. A matching digest is the only FRESH result for digest-backed sections; `verifiedAt` remains diagnostic, and legacy sections retain commit-diff behavior until refreshed.
- Default stamps require scoped changes to be staged and refuse unstaged, unmerged, assume-unchanged, skip-worktree, or submodule checkout ambiguity. Scoped diffs override `diff.ignoreSubmodules`, so local configuration cannot hide a changed gitlink. Regressions cover hidden staged divergence, explicit historical stamps, exact scope binding, pruned feature history, and clean post-commit reuse.

## 1.45.0
- **Repository docs now have one physical and mechanical authority.** `code-ops-docs/` contains the handbook, techniques, ADRs, guides, atlas, architecture, contracts, data model, engineering standards, CI, infrastructure, observability, and the explicit design-system verdict. `DOCS_MANIFEST.json` maps every domain to its source evidence and fails on stale digests or legacy authored Markdown.
- **Runs reuse exact repository context.** A content-addressed snapshot caches the repo map, import graph, and atlas freshness once. Unit bundles add direct blast radius and fail explicitly on broad or over-budget context. Version 2 run contracts bind every bundle to the repository state.
- `repo-docs` plans extraction from the changed-source intersection, so unchanged documentation domains receive no dispatch. New regression gates run on Linux and Windows.
- Repository-local Markdown links now fail CI when their exact-case target is absent, keeping the consolidated hub portable across Linux and Windows.
- Review hardening closes fail-open dependency, citation, manifest-plan, empty-scope, and version-2 cost-history cases. Reverse vendored-script parity now rejects undeclared plugin copies and missing helpers referenced from every plugin-owned runtime surface.
- Context receipts preserve Unicode rename/copy paths, canonicalize aliased symlink roots, parse live Atlas freshness output, and report exact serialized bytes. Documentation gates reject vacuous source globs, prevent working-note exemption by manifest extension, and validate Obsidian wikilinks alongside Markdown links.

## 1.44.0
- **Run contracts join intent, execution, and acceptance.** The new `run-contract.mjs` validates a versioned objective, quality vector, budgeted work graph, routing, dependencies, and disjoint writes before fan-out. It reconciles planned units with the dispatch ledger, records owner-qualified acceptance attempts, and writes a successful result only after every blocking criterion and planned dispatch passes.
- **Cost history now has a completion boundary.** `estimate-run-cost.mjs` excludes contract-backed runs until a matching successful result exists, while preserving legacy ledger history. Active or failed contract runs are named separately instead of contaminating the next estimate.
- `full-sweep` compiles substantive Phase 0 plans and reconciles them at wave boundaries. New regression coverage pins the contract compiler, lifecycle filtering, and Linux/Windows execution.

## 1.43.6
- **`run-proof.mjs` spawns npm-style `.cmd`/`.bat` shims on Windows** — `record` and `verify` could not run `npm` on win32: a bare name did not resolve and `npm.cmd` throws EINVAL under Node's shim hardening, so a passing gate chain left no receipt. Both paths now resolve the executable (bare names via a PATH-only `where` lookup, so the repo under audit cannot plant a hijacking shim) and, when it is a shim, rewrite the spawn to `cmd.exe /d /s /c` with quoted, caret-escaped arguments and `windowsVerbatimArguments`. Receipts still record the original tokens, replay screening is unchanged, a relative shim path is made absolute (so `NoDefaultCurrentDirectoryInExePath` cannot break it), and a path-qualified missing shim still exits 127 with no receipt. The proof-receipts eval gains win32 shim checks and now runs in the Windows CI job.

## 1.43.5
- **Consent is one rule in every context — the list-context indent-cap lift is removed** — 1.43.4 lifted the consent line's three-space cap inside an open list, which reopened the hole 1.43.3 had closed: a four-space example under a bullet enrolled a repo that had declined in writing. Enrollment authorizes fleet mode to write to a member, so a false consent costs more than the false decline the lift fixed. The cap is now three spaces everywhere. Inside a list, indentation beyond the item's boundary is presentation or code, never enrollment, and the author rule — write consent flush and undecorated — carries the case. Recorded as an amendment on `code-ops-docs/40 Engineering/Techniques/fleet-standard.md` and on decision D-003.
- **A fence opener closes an open list** — the list flag was never cleared by a fence line, so list context survived past the point the rule set's own close condition ended it, and an indented fence marker below the block opened a fence that never closed. A consenting repo below it reported as a deliberate decline.
- `evals/fleet-standard/` flips the three open-list shapes to declines, adds the reported in-list enrollment reproduction as a fourth, and pins the fence-closes-a-list case that the previous eval could not distinguish.

## 1.43.4
- **The documented parsing rules are now the specification of the consent format** — `code-ops-docs/40 Engineering/Techniques/fleet-standard.md` gains "The parsing rules are the specification": the checker implements the spec, a renderer that displays a contract differently does not govern enrollment, and an uncovered edge case is closed by amending the page and the checker together rather than by matching a renderer. Author-facing guidance is two rules that make the edge cases irrelevant: write consent as a flush undecorated line, and show the phrase in an example only inside a flush fenced block. Recorded as decision D-003.
- **A fence closes only at the quote depth that opened it** — the blockquote prefix was stripped on every line including inside an open fence, so `> ``` ` inside an open bare fence ended the block and the decline below it read as consent. That is the fail-open direction. The reader now records the opening fence's quote depth and tests closers at that depth only.
- **An open list no longer suppresses a genuine consent** — a four-space line inside a list is list content, not code, but the consent matcher kept its three-space cap and refused a line the reader had already called markup. A consenting repo was reported as a deliberate decline. The cap now lifts exactly where the reader has ruled the indent is list content, and nowhere else.
- `evals/fleet-standard/` gains the mirror nesting of the blockquoted-fence cases in five forms, the consent-after-a-closed-blockquoted-fence case, three open-list consent shapes, and the mutation partner proving the lifted cap belongs to list context alone.

## 1.43.3
- **One reader decides what is code, so no markdown shape can enroll a repo by accident** — `check-fleet.mjs` recognized fenced blocks and nothing else, so two ordinary ways of showing the phrase still read as consent. A four-space or tab-indented example enrolled the repo, because the consent pattern's tolerated prefix swallowed the indent. A fence written inside a blockquote never opened a block at all, while the consent pattern did tolerate a `>` marker, so the two disagreed about leading decoration in the fail-open direction. The line stream now strips a blockquote prefix before any leaf test, recognizes indented code blocks where CommonMark starts one, and lets an open indented block win over a fence marker inside it. The full rule set is stated once in `markdownLines` and mirrored in `code-ops-docs/40 Engineering/Techniques/fleet-standard.md`.
- **The consent line's tolerated decoration stops exactly where code begins** — one bullet or blockquote marker and up to three spaces still count, four do not, so the matcher and the reader cannot disagree again.
- **A pointer names its twin in its first paragraph, not in its first three lines** — a legitimate pointer whose naming sentence sat on the fourth line was reported DRIFTED, and the failure text described nothing the author had done. The window is now the opening run of body lines, which leaves the buried-mention case DRIFTED as before.
- **The pointer's heading rule says what it enforces** — a `###` subheading under `## Fleet` is a section of the pointer's own and is refused; the comment and the standard now say so rather than implying depth is allowed.
- `evals/fleet-standard/` gains the blockquoted-fence and indented-code shapes, the indented-block-over-fence precedence case, the decorated-consent forms that must still enroll, and both pointer cases.

## 1.43.2
- **One fence state machine decides what is code, so a fenced example can no longer enroll a repo** — `check-fleet.mjs` stripped fences with a regex that ended at the first line break, so it removed an opening fence and at most one line after it. A `## Fleet` section that showed the phrase on the second line of a block, after a blank line, inside a `~~~` block, or inside a block left unterminated kept the phrase in the text and read as consent. The checker now walks the contract once and tracks fence state per CommonMark: three or more backticks or tildes open a block, only a fence of the same character and at least the same length closes one, and an unterminated fence suppresses to the end of the file.
- **The section scanner and the consent matcher share that state** — heading detection was fence-blind while the consent test was not, so a contract quoting the `## Fleet` heading it must write closed its own section at the quotation and a genuinely enrolled repo was reported as a deliberate decline. Both now read the same line stream, and a real consent line after a closed fence still counts.
- **A short contract that mentions its twin is not a pointer** — the pointer test was a line cap plus two substring matches, so a short substantive contract opening by naming the other file was reported DRIFTED. A pointer must also name that file in its first body lines rather than in passing, and carry no sections of its own beyond `## Fleet`.
- `evals/fleet-standard/` gains the fence shapes that previously failed open, the fenced-heading case, and both pointer false positives. The earlier fenced case passed only because its phrase sat on the one line the broken stripper removed.

## 1.43.1
- **Consent is the phrase on a line of its own, so documenting the rule no longer enrolls a repo** — `check-fleet.mjs` substring-matched `fleet member: yes` across the whole `## Fleet` section, so a contract that showed the phrase in a fenced example, or quoted it inline while declining in writing, was read as consenting. That inverted the load-bearing rule in the direction that matters: consent is what authorizes fleet mode to write to a member, so the fail-open case authorized edits to a repo that said no. The phrase must now be the whole line, fenced blocks are stripped first, and bullet, blockquote, and indent decoration still count. `evals/fleet-standard/` pins both refusal shapes and the decorated forms.
- **Two pointers naming each other are DRIFTED, not a parity mode** — the pointer branch only asked whether the shorter contract file pointed at the other, so a pair where both files were stubs pointing at each other passed conformant. That is the degenerate case the surface exists to catch: no file is the substantive contract and every host reads a stub.
- **A closed-ATX `## Fleet ##` heading opens the consent section** — trailing hashes left the heading unmatched, so a genuinely enrolled repo was reported as a deliberate decline. It failed safe but told the operator the opposite of the truth.

## 1.43.0
- **`conform` gains a fleet mode, and membership is two-sided** — every skill in the suite operated on one repo, so standardizing several meant visiting each and holding the comparison in your head. A `FLEET.json` manifest now names the members, and each named repo consents by carrying `fleet member: yes` in a `## Fleet` section of its own standards contract. A named repo that has not consented is reported and never touched, a consenting repo the manifest does not name is invisible, and a fleet run never edits a member's consent — a run that could write the phrase it then reads would have a formality rather than a rule. Doctrine propagation is the mode's canonical use: when a source of truth moves here, the fleet run carries it to the repos that agreed to receive it.
- **`check-fleet.mjs` reports the fleet in one table** — it validates the manifest, resolves each member, reads consent, and runs the per-repo checks that exist locally, emitting one `CONFORMANCE_REPORT.md` grammar-(d) row per member per surface, so `calibration-metrics.mjs` ingests a fleet run unchanged. Fail-closed throughout: an unresolvable member, an unreadable contract, or a vault check that could not run reports UNKNOWN and fails the run for a consenting member. A missing vault stays ABSENT and does not fail, because vault adoption is voluntary. The new standard is `code-ops-docs/40 Engineering/Techniques/fleet-standard.md`, pinned by `evals/fleet-standard/`.

## 1.42.8
- **The JSON caveat is eval-pinned and the 1.42.7 entry says what its diff did** — the machine-caveat correction had no coverage (only the prose clause was pinned), and the prior entry claimed a full cause set the compact machine string deliberately does not carry.

## 1.42.7
- **The machine caveat matches the prose** — the JSON caveat still said "recorded no dispatches", the diagnosis the prose correction removed. Both now state the observation rather than a single diagnosis, and the eval regex pins the full prose clause instead of stopping before it.

## 1.42.6
- **Estimator caveats say only what the walk knows** — the depth-cap caveat asserted a ledger exists in a directory the walk never entered, and the empty-ledger caveat diagnosed every zero-row ledger as an aborted run when unreadable rows produce the same zero. Both now state the possibility and the full cause set.

## 1.42.5
- **An aborted run no longer rewrites the estimate** — `estimate-run-cost.mjs` counted a run folder whose `DISPATCH_LEDGER.md` has no parseable rows as a comparable run that cost 0 dispatches. `dispatch-ledger.mjs phase` writes exactly that ledger for a run that opens a phase and dies, so one aborted run pulled the range's minimum to 0, dragged the median down, and — the serious part — satisfied the `n >= 3` guard with a run that proved nothing, suppressing the guess caveat at a true n of 2. Zero-row runs are now excluded from the range and named in a caveat of their own, and the guess caveat fires on the count of runs that yielded rows.
- **The walk says what it dropped** — a `DISPATCH_LEDGER.md` deeper than the bounded walk's three levels was skipped in silence, under a message asserting none existed under the tree. The unsearched directories are now listed, and the not-found line is qualified by the depth it searched.
- **Grammar (a) has one source** — the `DISPATCH_LEDGER.md` row shape had three character-identical copies, and an edit to one would have left the others quietly undercounting dispatches rather than failing. A data-only `scripts/ledger-grammar.mjs` now holds the row pattern, the status set, and the table header; the writer and both readers import it.
- **`--repo-size Infinity` is rejected** — the validator accepted it and echoed it back as a recorded size.

## 1.42.4
- **Cost machinery turns predictive** — the ledger's `role@model` stamp is now machine-parsed on both halves: `dispatch-ledger.mjs check` and `calibration-metrics.mjs` each report a per-model mix and a per-model-*class* mix, resolving stamped ids to canonical rungs through the ladder SSOT so a mix stays comparable after a provider moves its lineup. An id serving several rungs reads `ambiguous` and an id in no pinned ladder reads `unclassified`, rather than being placed by the shape of its name; a bare pre-stamp cell still parses and reads `unstamped`. On top of that parse, a new `scripts/estimate-run-cost.mjs` reads *prior* runs' ledgers **before** a run and prints a dispatch-count range plus its class mix, so Phase 0 scoping has a number instead of only a judgment. It does no token-price math (prices drift), calls an estimate from fewer than three comparable runs a guess in a caveat block, and never fails a run — no history exits 0 with "no prior runs, no estimate".

## 1.42.3
- **Tier-floor carrier for hosts that ignore agent frontmatter** — `scripts/preflight.mjs` now prints every bundled agent’s declared tier floor at Phase 0, so the floors are visible on any host. A new `CONVENTIONS.md` bullet makes the lead route each dispatch at or above its floor by hand where the host ignores `model:` frontmatter, and `run-cost-audit` records a below-floor dispatch as a `tier-routing` FAIL.

## 1.42.2
- **Phase C re-writes the conformance report in place** — the skill said to record closing output "beside the opening verdict", which a producer could read as a second row per surface. Under the grammar's first-row-wins rule that shape would pin the drift rate to the pre-repair verdicts. Phase C now states the single-row rewrite: one row per surface, updated in place, the opening verdict noted in the evidence cell.

## 1.42.1
- **Table parsers reject duplicates and lowercase `n/a` coherently** — in the two conformance grammars a repeated key silently disagreed with the verdict counts (last write won the map, every row fed the totals), and `n/a` in lowercase was the one enum value the row regex refused while `pass` and `fail` sailed through. A duplicate key now counts as unparseable and the first row wins, so the per-key map and the counts always agree, and the result cell is case-insensitive for all three values.

## 1.42.0
- **Conformance is measured, not read** — `conform` recorded its per-surface verdicts as prose, so a repo's standardization drift was a one-off reading that no later run could compare against. Phase A's `CONFORMANCE_REPORT.md` now follows a published table grammar — surface, verdict, checker command, evidence pointer — and `calibration-metrics.mjs` parses it into per-surface verdict counts and a drift rate, under the same zero-parse-is-shape-drift rule the older grammars carry. An `UNKNOWN` surface is reported as unmeasured rather than folded into the drift rate silently.
- **`run-cost-audit` scores orchestration discipline** — the audit priced a run's dispatches but never said whether the run followed the routing doctrine it was priced against. A new phase writes `RUN_CONFORMANCE.md` in its own table grammar, scoring five mechanically checkable rules: every dispatched agent has a ledger row, no row is left dangling, tier routing matches the doctrine and the lint-enforced floors, effort routing avoids low on review and xhigh on breadth, and dated artifacts land in the vault's runs folder when the repo carries a vault. `N/A` is a distinct result from `PASS`, because a rule the run could not violate is not a rule it obeyed. The file gates nothing; it makes discipline a trend.

## 1.41.1
- **The standardization preflight moved inside phase 0 of `everything`** — it shipped as a separate phase 0.5, so it ran after phase 0 had already opened the master registers and closed its checkpoint, while its own body told the run to offer repairs at that closed checkpoint. The instruction could not be followed, and the artifacts it reports on already existed by the time it ran. The `conform` call now sits in phase 0 ahead of the register-opening block and ahead of the checkpoint, written as a qualified reference so the composition map derives the edge, and the repairs are offered at the checkpoint that follows it.

## 1.41.0
- **New `conform` skill — one command for every standardization surface** — the standards contract, the docs vault, and the atlas each had a skill and a checker, and nothing asked whether a repo carried any of them. A repo could pass one surface and fail three, and that only surfaced when a later run needed the artifact that was missing. `conform` assesses all of them read-only in dependency order, records each as CONFORMANT, DRIFTED, ABSENT, or UNKNOWN with the checker output that decided it, and writes `CONFORMANCE_REPORT.md`. Repair is a second phase, delegated surface by surface to the skill that owns it, with a checkpoint between each because repairing one surface changes what the next one reads. Doc alignment runs only against a drift signal, never unconditionally. The global user-scope contract is off unless the developer asks for it. Assess-only is a complete run, and every mechanical check is re-run at the end so the closing state is measured rather than claimed.
- **`everything` opens with a standardization preflight** — a new phase 0.5 runs `conform` assess-only, so the run knows where its own artifacts belong before it produces any, and offers the repairs once at the phase 0 checkpoint.

## 1.40.1
- **The vault checker no longer passes the vaults it was written for** — a profile status was read by scavenging every backticked token on any line naming `profile status`, so a sentence that also listed note types declared all of them as statuses, and a vault extending the vocabulary passed with any of them on a note. Only the token immediately following the phrase counts now. The UPPER_SNAKE artifact exemption also required no underscore, so a `README.md` in any domain folder skipped every frontmatter rule; the pattern now requires one, leaving the vault-root `README.md` as the single deliberate exemption. A numbered top-level folder below `10` that is not `00 Inbox/` is rejected instead of being invisible to every layout rule.
- **The `vault` skill's host-parity paragraph reads correctly on every host** — it named the two contract files and their hosts one by one, which the per-host renderers rewrote into a paragraph that contradicted itself. It now describes the standards-contract pair without naming its members, so the meaning survives the rendering.

## 1.40.0
- **New `vault` skill and a fail-closed vault checker** — the Obsidian vault standard (`code-ops-docs/40 Engineering/Techniques/vault-standard.md`) was enforced by convention alone, so a vault could drift from it and nothing said so. `check-vault-standard.mjs` now decides conformance mechanically: `Standard.md` present and carrying `standard-version`, the machinery folders present, no domain folder numbered into the reserved 80-99 band, at least one domain folder, and `type` / `status` / `updated` on every note. A profile status is honored when the vault's own `Standard.md` declares it in prose, so a profile extends the checker without editing it. The `vault` skill scaffolds, migrates, and checks against that standard, and carries the boundary rule that keeps the atlas and tracked reference docs out of the vault.
- **Run artifacts route to the vault when a repo has one** — `CONVENTIONS §12` now names `80 Runs/YYYY-MM-DD slug/` as the destination in a repo carrying a `<repo>-docs/` vault, filenames unchanged, instead of a second dated tree under `docs/<area>/<date>/`.
- **`adopt-standards` knows about vaults and pointer contracts** — the generated contract gains a documentation section routing to the vault's `Standard.md`, and the skill now states the two accepted `AGENTS.md` / `AGENTS.md` conformance modes: a byte-identical pair, or a pointer pair naming the contract as required reading.

## 1.39.0
- **The calibration config line can record a split lead** — a lead that changes hands mid-run records every lead class in order, plus-separated (`config: lead fable-5+opus-5; operatives opus-5`), instead of omitting the field (lesson L-025, surfaced by R-005). Both grammars extend in lockstep: the note gate's shapes and the graph's ingest grammar plus the run-doc validator, where `config.lead` stays one ordered string checked against its own pattern and an array lead is refused. Only the lead may split; `operatives` stays a single class, and an orchestration-experiment arm still requires a single-lead config. Cross-model attribution splits the lead, so every class that held the session attributes to its provider. `calibration-run` records the handover at Phase 0 and carries it into the Phase 3 note.

## 1.38.0
- **A calibration run now records its harness, not only its model** — the note carries a `host:` line beside `config:`. A lesson can be one model's habit or one harness's mechanics, and the two fail differently; recording only the model left them indistinguishable. `query cross-model` reads both axes and treats either one crossing as a suite defect.
- **Prior fixes are now confirmed, not assumed** — Phase 1 opens the `query unverified` worklist and Phase 4 closes it with a `verified-in` edge for every lesson the run was in a position to observe. Only that edge shows a fix held in the field; the store had 23 shipped fixes behind 3 confirmations, so the loop was measuring its own output rather than its effect.

## 1.37.0
- **New `adopt-global-standards` skill** — the cross-repo counterpart to `adopt-standards`. The global `~/.codex/AGENTS.md` is a cache of this marketplace's doctrine, and nothing re-verified it: when the SSOT pages moved, the cache kept routing every session in every repo by the superseded rule. The skill reads the SSOT pages themselves, anchors each baseline claim to `file:line`, and classifies every divergence as CONTRADICTS, STALE, MISSING, or REPO-LOCAL. A contradicted rule ranks above a missing one because sessions follow it. A fifth bucket, LOCAL-DOCTRINE, covers cross-repo rules the global file already carries that no SSOT page states: the write is additive by default, so those survive untouched and are listed as candidates to promote into the marketplace instead of being pruned to fit the template. Every removal is named with its bucket at the checkpoint. Writes only after that checkpoint, never touches settings or hooks, and stamps the marketplace commit it verified against so the next run computes drift from the log.

## 1.36.0
- **Recording a calibration run is now five steps, not four** — the new final step syncs `evals/calibration-graph/run.mjs`. That eval runs against the real store and hardcodes its answers, so every ingest changes two files. Two consecutive ingests missed the step, which passes every local gate and fails only in CI. Both the protocol doc and the `calibration-run` skill now name the step, and the skill's `Done when` requires the eval to pass.

## 1.35.0
- **New `CONVENTIONS.md` §14, Writing standard** — every skill writes to one house standard. The section pins one term per concept, active voice, and one instruction per sentence. It caps instructions at 20 words and explanation at 25. Clarity outranks conformance, so a writer who breaks a rule states why. Full rules live in `code-ops-docs/40 Engineering/Techniques/writing-standard.md`.

## 1.34.0
- **New optional `config:` Machine-block line** — `config: lead <model-class>; operatives <model-class>`, parsed identically by `calibration-metrics.mjs --validate-note` and `calibration-graph.mjs ingest`. It records the orchestration a calibration run was driven under, which is what makes one run's numbers comparable to another's rather than merely sequential. Optional like `atlas:`: a note without it validates and ingests exactly as before, so the runs recorded before the tier experiment stay valid.
- **The run-document schema gains an optional `config` object** (`{lead, operatives}`, both kebab model-class slugs), fail-closed on a malformed shape. A run that did not record its orchestration omits the field entirely rather than defaulting one — a guessed lead class would silently mis-group a comparison. `query trend` prints a config tail only for the runs that carry one; the rendered table is unchanged.
- **`calibration-run` confirms the orchestration configuration at the Phase 0 checkpoint** and pins the operative tier in every dispatch brief, since a run that re-tiers mid-flight is not comparable to any other.
- **A three-run orchestration-configuration experiment is pre-registered** in the calibration protocol as a baseline gap analysis: a quality baseline, a candidate read against it on fixed axes, and a cost-floor reference. Gaps feed the existing `instrument`/`suite`/`protocol` lesson classes and the remediation loop.

## 1.33.0
- **Model routing is quality-first** (`CONVENTIONS.md` §1, `hooks/routing-card.mjs`): every judgment-bearing sub-agent dispatch runs on the stronger model whatever tier the orchestrator itself is on; only mechanical breadth sweeps and transcription-style work drop a tier. A shallow or failed report costs a redispatch plus the orchestrator's attention, which outweighs the stronger model's price premium.
- **`run-cost-audit` prices under-tiering as a cost, not a saving**: a judgment-bearing dispatch routed below the strong tier is now a finding, reported with the redispatches and discarded reports it caused.

## 1.32.0
- **Tier discipline is enforced at the operative boundary** (`CONVENTIONS.md` §7, `agents/reviewer.md`): an operative may label a finding CONFIRMED only when an executed repro or trace sits in its own transcript; a statically-argued finding caps at PROBABLE and only the lead promotes it. Calibration run R-004 saw six findings arrive labelled CONFIRMED on static reasoning alone, which made the confirmed ratio measure labelling discipline rather than evidence depth.
- **Operative reports are persisted in the turn they land** (`CONVENTIONS.md` §1): the report goes to the run's artifact folder before any other work, because a report that lives only in the conversation is one blocked turn from being lost.
- **Report shape is gated before a unit counts as covered** (`CONVENTIONS.md` §1): a brief that never reached its operative looks exactly like a completed dispatch in the dispatch record until someone reads the report.
- **Refutation panels are staffed by distinct lenses** (`CONVENTIONS.md` §7): an odd panel of identical skeptics can repeat one reader's misread and confirm the wrong answer by majority; correctness, configuration-reading, and reachability are separate seats.

## 1.31.0
- **Failed rate and redispatch rate are no longer mutually exclusive per unit.** A ledger row carries one status cell, so a unit that failed and was then retried read as `redispatched` alone and the pair understated recovery. `calibration-metrics.mjs` now derives both rates from the ledger's write journal when one sits beside it: a unit counts toward the failed rate if it EVER entered `failed` and toward the redispatch rate if it was EVER redispatched, independently. The row grammar is unchanged.
- **The basis is always stated, and a degraded rate is never silent.** The report carries a `rate basis:` line — `journal-derived`, or `snapshot-only` for a pre-journal artifact folder. A journal that is present but carries an unreadable or malformed line is rejected WHOLE (never partly used), its violations printed as `!! JOURNAL`, with the fallback named on the basis line. The dangling rate and the `by status` breakdown still report final status, by definition.
- `--json` gains `ledger.journal { present, derived, violations }` plus `ledger.everFailed` / `ledger.everRedispatched` — the numbers the two rate lines print.

## 1.30.1
- **Four register/refutation grammar fixes, each pinned by a regression case.** A per-entry length budget now terminates its entry at the next entry head, a covered-negative `NO-FINDINGS:` line, or a non-entry heading, so a trailing block is no longer charged to the entry above it; refutation receipts are keyed by an ID at the START of the line, so prose citing a finding is neither an unparseable receipt nor a second verdict; the themed-sibling-report warning walks the artifact folder recursively (bounded by depth, skipping dot-directories and `node_modules`) so per-slice reports in subdirectories are seen; and `calibration-metrics.mjs` no longer reads its own report back as a sibling register.
- **The sanitized-note template prescribes a severity mix the note gate accepts.** The prose half now reads `severity mix c/h/m/l/n as <N/N/N/N/N>` — a bare `0/6/22/9/10` is five slash-separated segments and the path scrub read it as a unix path, so a note written exactly to template failed closed. The scrub itself is unchanged and no less strict.

## 1.30.0
- **`dispatch-ledger.mjs` now journals its own writes**, so a phantom row is mechanically detectable. `add`, `update`, and `phase` append a JSONL entry to `<ledger>.journal.jsonl` before writing the ledger, and `check` replays that journal against the rows: a row with no journaled `add` is reported as `!! PHANTOM` and fails closed without `--strict` — a row minted by a direct or batch artifact edit (often straight at `reported`) was previously indistinguishable from a real dispatch in a finished artifact. A hand-edited status cell (`!! OUT-OF-BAND`), a journaled row deleted from the ledger (`!! MISSING-ROW`), and an unreadable journal line all fail closed too.
- **Pre-journal ledgers keep working.** A journal is created only by the command that creates the ledger; `update` never mints one. An existing ledger with no journal stays unjournaled and `check` reports it as an advisory (exit 0), promoted to a failure under `--strict`. The journal entry is written before the ledger so a crash between the two surfaces as a missing row, never as a phantom.
- The `check` summary keeps its existing sentence and gains a `journal: verified|absent|N violation(s)` tail.

## 1.29.0
- **A calibration run now measures the target's atlas.** `calibration-run`'s baseline sweep opens with an `atlas-check.mjs check` (or an `init` when the target keeps none), hands each section's FRESH/STALE state into the sweep briefs, and refreshes the stale sections in the session that has the context. Four counts come back: sections held, consumed FRESH, refreshed, and falsified.
- **New optional `atlas:` Machine-block line** — `atlas: sections N; fresh N; refreshed N; falsified N`, parsed identically by `calibration-metrics.mjs --validate-note` and `calibration-graph.mjs ingest`. A note without the line validates and ingests exactly as before, so the runs recorded before the atlas leg stay valid; a present line must carry all four counts.
- **The run-document schema gains an optional `atlas` object**, bounded fail-closed like every sibling count group: no negative count, `fresh + refreshed` may not exceed `sections`, and neither may `falsified`. `query trend` prints an atlas tail only for the runs that carry one; the rendered table is unchanged.
- **A falsified section is a lesson, not a staleness report** — the calibration protocol routes it to the existing `instrument`/`protocol` lesson classes, since it means a run was handed a false premise.

## 1.28.0
- **New `atlas` skill.** Maintains a per-repo knowledge cache of judgment-only sections, each carrying scope globs and a verified-at stamp recorded in a machine-readable manifest rather than in prose.
- **New vendored `atlas-check.mjs`** with `init`, `add`, `check`, `stamp`, and `inbox` modes. `add` registers a section (repeatable `--scope`) with a stub file and an `unverified` pin, so a new section is `STALE` until someone stamps it. Staleness is computed by git pathspec diff since each section's stamp, against the working tree — an uncommitted edit to a scoped tracked file counts. A stamp must be an immutable object name (lowercase hex, 7-40 chars, or the `unverified` placeholder): a moving ref such as `HEAD` or a branch name is a fail-closed schema violation, since it would re-resolve on every run and never go stale. That shape rule is backed by a resolution-time rule, since a branch or tag *named* like a sha would otherwise pass it and still move: a value claimed to be a pin must resolve to a full sha that extends it, in `check` and in `stamp --at` alike. An unresolvable stamp reports fail-safe `STALE`; a malformed manifest is fail-closed; the coverage sweep flags unmapped top-level paths as advisories.
- **`ship`'s closing phase refreshes the sections the change made stale**, while the diff rationale is still in-session.
- **`CONVENTIONS.md` gains the stamp-trust rule** — a FRESH section is consumed without re-verification, a STALE one is treated as a lead.

## 1.27.0
- **Calibration runs are recorded as a knowledge graph.** The calibration store under `evals/calibration/` holds one document per run, lesson nodes carrying stable IDs, and edges linking each lesson to the fixes, enforcements, and verifying runs that answer it — so a lesson's fate is queryable instead of buried in prose.
- **`evals/CALIBRATION_TABLE.md` is now a derived view.** The new root-level `scripts/calibration-graph.mjs` renders the table from the store and drift-checks it (`render --check`) alongside `validate` for store integrity.
- **`calibration-metrics.mjs` gains a `--json` emit mode** and fails closed when a sanitized note is missing or malforms its Machine block. Its `paneled:` shape accepts `of unknown eligible`, matching the ingest side that maps an unmeasured denominator to null.
- **`calibration-run`'s closing phase switches from hand-appending a table row** to validate, ingest, render, and graph-validate.

## 1.26.0
- **Item-ID grammar widened and anchored.** An item ID may now carry an optional uppercase round letter between the hyphen and the serial, and is matched only at entry-heading position — line start, after optional heading markers or a table-row pipe — so IDs mentioned inside prose no longer open spurious entries.
- **Per-entry register budget in `calibration-metrics.mjs`.** A `FINDINGS_REGISTER.md`-shaped artifact is measured per entry (advisory 10 / hard 20 non-blank lines, preamble 15/30) with the flat 60/120 file cap as fallback.
- **Sibling-report warning.** `calibration-metrics.mjs` warns when register-shaped entries sit in a non-artifact sibling file, naming the file.
- **Covered negatives replace the zero-parse warning.** A present artifact whose `NO-FINDINGS` lines account for its content is reported as covered negatives rather than warned about as an unparsed artifact.
- **`dispatch-ledger.mjs phase` subcommand.** Writes `> phase: <title> · lead@<model>` markers so the lead model per phase is reconstructable; `check` is fail-closed on a malformed marker.
- `code-ops-docs/40 Engineering/Techniques/calibration-protocol.md` restates the CONFIRMED-ratio rule: an assess-only run caps remediation, not reproduction.
- **`CONVENTIONS.md` dispatch-ledger passage synced** to the stamped `role@model` row form and extended with the write-at-dispatch atomicity clause; the passage is now pinned byte-identically across plugins by `SHARED_PASSAGES` in `scripts/lint-plugins.mjs`.
- **Vendored `revalidate-register.mjs` re-synced** from the canonical `scripts/revalidate-register.mjs` for the widened, heading-anchored item-ID grammar.

## 1.25.0
- **Dispatch-ledger rows are stamped `role@model`.** `dispatch-ledger.mjs add` now requires `--model <resolved-model-id>` and writes it into the role cell, so a run's actual tier mix is reconstructable after the fact and a silent mid-run tier substitution is visible instead of invisible; `check` flags an unstamped row as an advisory (a hard failure under `--strict`). Legacy unstamped rows still parse.
- **Register per-entry length budget.** `scan-narration.mjs` now checks a `FINDINGS_REGISTER.md`-shaped artifact per-entry (advisory 10 / hard 20 non-blank lines, preamble 15/30) instead of against the flat file-level cap — real-scale calibration evidence showed the flat cap wrongly penalized a legitimate many-entry register whose individual entries were tight.
- **`scan-redaction.mjs` gains directory support.**
- **`calibration-metrics.mjs`** warns when a present, non-empty artifact parses to zero items (naming the artifact and pointing at the new `code-ops-docs/40 Engineering/Techniques/artifact-grammars.md`), and adds a tier-mix line to the dispatch-ledger summary parsed from the `role@model` stamp (unstamped rows counted separately).
- **New `code-ops-docs/40 Engineering/Techniques/artifact-grammars.md`** — the SSOT for the three parse grammars (`DISPATCH_LEDGER.md`, `FINDINGS_REGISTER.md`, `REFUTATION_LOG.md`) consumed by `calibration-metrics.mjs` and `revalidate-register.mjs`; handbook technique count 10 → 11. `calibration-protocol.md` now notes CONFIRMED-ratio comparisons are within-track only and links the grammars doc.
- `CONVENTIONS.md` §12's dispatch-ledger example updated to the stamped row form; a sentence on the register per-entry budget added alongside it.

## 1.24.0
- **Skills are model-invocable.** Removed `disable-model-invocation: true` from all skill frontmatter; the harness routes slash input through the Skill tool, and the flag made every skill uninvocable there and blocked scheduled-task invocation. Routing discipline now lives in each skill's "Use when" description, the session routing card, and each skill's own checkpoints — no auto-merge, ever.

## 1.23.0
- **Three new suite self-audit skills.** `calibration-run` (Mode: ASSESS) standardizes a real-scale calibration run against a target repo — isolated preflight, an `assess-only` baseline sweep dispatched per `full-sweep`/`rigor:rigor-sweep`'s own phases, metric extraction, and a fail-closed sanitized-note validation before a row is appended to the new `evals/CALIBRATION_TABLE.md` — enforcing the one-way channel rule from `evals/README.md` mechanically instead of by convention. `run-cost-audit` (Mode: ASSESS) audits a completed run's dispatch counts, artifact sizes, and tier/effort mix against the bounded-wave (`§1`) and length-discipline (`§12`) doctrine, producing an evidence-cited `COST_AUDIT.md`. `provider-parity-audit` (Mode: ASSESS) inventories provider-coupled prose across every plugin's skills/CONVENTIONS/docs and classifies each hit (reconciled-in-render / needs-rewording / intentionally provider-specific) into `FINDINGS_REGISTER.md` — the prose counterpart to `build-codex-marketplace.mjs --check`'s mechanical render parity. New `code-ops-docs/40 Engineering/Techniques/calibration-protocol.md` documents the channel rule, run design, metric table, and sanitized-note template.
- **Phase-0 executor naming extended to the remaining DOCUMENT/AUDIT/IMPLEMENT skills** — `adopt-standards`, `adr`, `api-docs`, `data-model`, `dependency-upgrade`, `doc-alignment`, `feature-discovery`, `feature-implementation`, `normalize`, `onboarding`, `ops-docs`, `performance`, `remediation`, `security-privacy-audit`, and `test-hardening` now name the `explorer` (mapping phases) or an ephemeral implementation operative (fix/build phases) dispatch explicitly, completing the pattern started in 1.22.1 for `architecture` and `codebase-audit`.
- Skill count 25 → 28; handbook, root README, and plugin README counts updated to match.

## 1.22.1
- **`architecture` and `codebase-audit` Phase 0 name an `explorer` dispatch** for stack detection/inventory, handing its summary onward — matching the executor-naming already used in the orchestrators' Phase 0.

## 1.22.0
- **`CONVENTIONS.md` §1 gains a reasoning-effort routing rule** — effort follows ambiguity the same way tier does (low for mechanical/breadth, medium for execution/scoped implementation and flow tracing, high for review and the lead, xhigh reserved for disputed verdicts and critical CONFIRMED calls), cross-referencing `code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md` for the full table instead of duplicating it.
- **Privacy leak gate made an explicit invocation** in `ship` and `debug` Phase 4 — names `privacy-opsec-suite:metadata-leak-audit` scoped to the change's/fix's diff and routes its findings into `FINDINGS_REGISTER.md`, replacing the prior prose-only mention.
- **`researcher` wired into `ship`** — Phase 2 routes new-dependency and library-choice decisions through `researcher:library-eval` and pre-commitment claim verification through `researcher:research-verify`.
- **`explorer` and `reviewer` doctrine clauses pinned against drift** (`SHARED_PASSAGES` extended to `plugins/*/agents/*.md` in `scripts/lint-plugins.mjs`) — escalate-don't-guess, secret redaction, and dense/evidence-cited-report wording normalized across all eight operative agent files and gated so a partial edit fails lint.
- **Phase-0 explorer dispatch named explicitly** in `ship`, `debug`, and `full-sweep` — the stack/conventions detection step now names the operative that runs it (an explorer, handing its summary plus `REPO_MAP.md` forward) instead of leaving the lead to do it inline.
- **`everything` gains its own Phase-0 preflight/repo-map wiring** — it does not delegate to `full-sweep`, so it now runs `preflight.mjs` and `repo-map.mjs` directly, matching the other orchestrators.
- **`debug` gains a scale-down line** matching `ship`'s, plus permission to fold the Phase-2 root-cause checkpoint into the Phase-3 fix report for a trivially-scoped, one-file, obvious-root-cause fix; anything broader still stops for the checkpoint.
- **`CONVENTIONS.md` §7 gains a triage cap** — a phase surfacing more than 5 critical/high findings eligible for a panel checkpoints with the developer on scope before paneling all of them.
- **`CONVENTIONS.md` §12 generalizes the length discipline** — `EXECUTIVE_SUMMARY.md` and other run summaries cap at roughly one page of top findings, with full detail left to the register.
- **New `import-graph.mjs` vendored in** (`scripts/vendored-manifest.mjs`), alongside `preflight.mjs` and `repo-map.mjs`.
- **New `SessionStart` hook (`hooks/routing-card.mjs`)** — prints a hard-capped, 10-line routing card at session start pointing task types at the right skill/orchestrator and naming the standard-operating-mode docs, so the lead defaults into delegating instead of working inline.

## 1.21.0
- **`revalidate-register.mjs` hardened** — its git call now runs under a child-process timeout, blank/whitespace flag values are rejected, and unknown flags exit 2 instead of being silently treated as filenames.
- **`preflight.mjs` rejects unknown flags** (exit 1) instead of ignoring them.
- **`scan-ai-tells.mjs` and `scan-redaction.mjs` hardened** — missing-file/config errors now exit 2 even when hits are also present (previously masked to exit 1), their git calls run under a timeout, and unknown flags are rejected.
- **`run-proof.mjs` and `check-autofix-scope.mjs` reject blank/whitespace flag values** and document their exit contract in a header comment; `run-proof`'s proof-command execution stays deliberately unbounded.
- **`lib-docs.mjs` documents its exit contract** in a header comment and rejects blank/whitespace flag values.
- **`pr-split` now points to the stacked-PR merge procedure** in `code-ops-docs/40 Engineering/Handbook/10-recovery-and-troubleshooting.md` §6.

## 1.20.0
- **New `scripts/repo-map.mjs` generator** — produces a per-repo inventory (`git ls-files -z`) with per-language top-level definition extraction at exact line numbers, announced truncation/binary/unreadable-file handling, and a HEAD-sha freshness stamp; vendored byte-identically into this plugin's `scripts/`.
- **`Map once, search to deepen`** doctrine bullet added to `CONVENTIONS.md` (SHARED_PASSAGES-pinned, id `map-once`) — Phase 0 generates `REPO_MAP.md` once per run and every operative brief gets its path, consulting it before search.
- **`universal-ctags` optional-tool mention** added to `CONVENTIONS.md` §2 — an optional accelerant for symbol-to-location lookups, used if installed, never required.
- **Phase-0 repo-map wiring** — `ship`, `debug`, and `full-sweep` run `repo-map.mjs` after `preflight.mjs` passes and hand the resulting `REPO_MAP.md` path to every operative brief; a failed generation is a noted advisory, not a blocker.
- **`repo-map.mjs` and `preflight.mjs` reject empty or whitespace-only flag values at parse** — previously `--max-file-kb ""` produced an all-skipped map with exit 0, and `--artifact-dir ""` silently skipped the writability probe.
- **`preflight.mjs`'s tool probe falls back to a `where` PATH lookup on Windows** so `.cmd`/`.bat` shims (npm-style tools) resolve without a shell.
- **`REPO_MAP.md` added to the Standard filenames artifact list.**

## 1.19.0
- **Operative-failure ladder** added to `CONVENTIONS.md` (SHARED_PASSAGES-pinned): a dispatched operative that cannot complete its brief escalates through an ordered ladder (retry with a narrower brief, hand back a specific open question, or take the piece over) instead of guessing or silently dropping the task.
- **`DISPATCH_LEDGER.md` convention** — dispatched work is logged so a stalled or dropped operative is visible instead of silently vanishing; `revalidate-register.mjs` gains an advisory `--dispatch-ledger` flag that cross-checks the ledger against the register.
- **Report-ingestion gates** added to `ship`, `debug`, and `full-sweep` — an operative report is validated against its expected shape before being folded into the run, so a malformed or partial report cannot silently pass through as complete.
- **New `scripts/preflight.mjs`** — a Phase-0 gate wired into `ship`, `debug`, and `full-sweep` that checks environment/toolchain preconditions before a skill starts work.

## 1.18.0
- **New skill `adopt-standards`** (Mode: DOCUMENT) — bootstraps or maintains a repo's `AGENTS.md` standards contract so it stays mechanically kept, not aspirational. **BOOTSTRAP** mode (no `AGENTS.md`, or one failing a quick audit) audits real build/test/lint/gate commands (run read-only or CI-cited), architecture, gotchas, and doc-lifecycle rules, then writes the contract in house style. **MAINTAIN** mode re-verifies every claim — commands still run, the gate chain still mirrors CI, enforcement claims are truthful, `line N` citations are swept mechanically (not eyeballed), cited paths still exist — fixing drift and reporting what was stale. House style: `## Never (no gate will save you)` first, `## Before declaring any change done` (verified command chain), post-edit chores, `## Invariants the gates will catch`, and a local-only-docs note, with no duplication of the user's global `~/.codex/AGENTS.md` doctrine.

## 1.17.2
- **Agent doctrine hardening.** `explorer` and `reviewer` now state explicitly that an ambiguous brief, or work outside their scope (edits, execution, a judgment call only the orchestrator can make), goes back to the orchestrator as an open question instead of being guessed at. `explorer`'s evidence-citation rule now points at the plugin's `CONVENTIONS.md` (§9, Evidence standard) for the anchor format; `reviewer`'s report rule states reports return dense and evidence-cited, never raw file dumps.

## 1.17.1
- **Codex distribution.** The repository now renders a tracked native Codex package from this canonical source, with a `.codex-plugin` manifest, marketplace metadata, named skills, explicit manual-invocation policy, bundled MCP server, and the traceless-publishing hook subject to Codex hook trust. `node scripts/build-codex-marketplace.mjs --check` fails on render drift.
- **Traceless scanner recognizes Codex/OpenAI attribution.** The bundled `scan-ai-tells.mjs` now rejects Codex/OpenAI trailers, generation claims, and `Codex CLI` tool markers in the same fail-closed gate used for Claude and other assistants.

## 1.17.0
- **New `PreToolUse` hook `enforce-traceless`.** Blocks a `git commit` / `gh pr create|merge` Bash call at the tool layer when the command text carries an AI/tool tell, running the bundled `scan-ai-tells.mjs` against the full command string before the call proceeds; a hit exits 2 with the scanner's report, otherwise exits 0. Fails open on scanner infra errors (missing/unspawnable scanner) so the hook never blocks a commit for its own reasons; CI (`scan-ai-tells.mjs --git <range>`) remains the fail-closed backstop.

## 1.16.0
- **Token economy (measured, gate-preserving).** Read-once clause for CONVENTIONS (an orchestrator-loaded copy is inherited, not re-read — an `everything` pass instructed ~35 reads of ~15K unique tokens); pre-filter-first register reads (run the checker, then read only non-FRESH entries, wholesale only for synthesis); refutation-panel economy (a SURVIVED verdict whose receipts still pass `--strict --refutation-log` is not re-paneled; panelists get the finding block + cited region inline, never the full register); `everything` no longer preloads sibling skill files (invocation re-injects them). All new doctrine cores pinned in SHARED_PASSAGES.
- **DOCUMENT-mode generators read scoped sections** — `architecture`/`api-docs`/`data-model`/`ops-docs`/`onboarding` read the four sections that bind DOCUMENT mode instead of the full file (the fan-out/fix machinery cannot apply to them). `adr` and `doc-alignment` keep full reads (they log tiered findings).
- **Frontmatter descriptions trimmed** across the marketplace (~26%; every Use-when trigger and sibling disambiguator kept verbatim; all skills are manual-invoke so routing is unaffected).
- **CI: both PR gates cancel superseded runs** (a newer push stops paying for reviews of dead commits) and deep-review skips generated-data-only diffs (in-job check, never paths-ignore — required-check semantics preserved; validate.yml drift-checks those files; opsec-gate still reviews every PR).

## 1.15.1
- **Tier-honesty line moved in-phase** in `doc-alignment` and `normalize` — the post-hardening floor snapshot (evals/FLOOR_TABLE.md) measured that the rule suppresses weak-model tier inflation when embedded at the finding-emitting step (the bug-hunt pattern, 0 inflation) but not as a trailing line (4-9 remained). Placement beats presence; pre-registered iteration, nothing else changed.

## 1.15.0
- **CONVENTIONS restructured for clause visibility.** The dense tier-honesty, independent-refutation, and anchor paragraphs in `§7`/`§9` are now one clause per line (numbered), so an executing model weighs every clause of the conjunctions instead of skimming a 200-word sentence; the refutation protocol carries the identical numbered structure as rigor `§I`. Section headings and every pinned doctrine core are byte-unchanged.
- **New lint check #14: SHARED_PASSAGES drift gate.** The deliberately-duplicated doctrine cores (fan-out throttle, disconfirmation protocols, headless contract, circuit-breaker, non-secret-anchor rule, terminal forms, the always-gated list) are pinned byte-identically across every file that carries them — a partial rollout of a doctrine change now fails CI instead of silently diverging. Caught and fixed one live drift on landing: `everything`'s always-gated copy had drifted from the pinned byte-form (a separate "anything irreversible" clause instead of "destructive/irreversible operations", and no never-auto-merge rider).
- **Tier honesty inlined at point of use** in `doc-alignment` and `normalize` — the baseline model-floor calibration (see `evals/FLOOR_TABLE.md`) measured weak-model tier inflation concentrating in exactly the skills that carried the rule only by CONVENTIONS pointer.
- **`evals/FLOOR_TABLE.md`** — the committed baseline of the pre-registered model-floor calibration: strong tier emitted zero inflated CONFIRMED across 42 read-only cells; the weak tier emitted 62 in control and 27 with skills, splitting on whether the skill inlines tier discipline.

## 1.14.0
- **Weak-model gate batch.** `revalidate-register.mjs` gains an opt-in `--strict --profile <type>` schema gate (mandatory per-item fields; a mangled zero-ID register fails instead of silently vacating the anchor gate), a `--consumed <pre-run>` terminal-state mode (a consumed item never vanishes and closures use `closed-with-proof` / `deferred-with-reason` / `OBSOLETE-AT`), a Panel-exempt severity floor (a sensitive-path finding below high needs an explicit exemption — deflation cannot dodge the refutation panel), refutation receipts (`--refutation-log` validates panel size, tally, and that every REFUTED verdict's guard anchor still greps), and a `<REDACTED-LINE>` anchor carve-out so the anchor rule never forces a secret into a register.
- **New `check-autofix-scope.mjs`** — the auto-apply diff gate: denies always-gated paths (auth/migrations/lockfiles/workflows/schemas), oversize diffs, and export-touching lines before an agent may auto-apply a NOW-SAFE item; fail-closed by default (no flags = deny everything), wired into the §4 auto-safe lane.
- **New `run-proof.mjs`** (execution receipts: a claimed test result with no replayable receipt is narration, not proof) and **`scan-redaction.mjs`** (fail-closed secret shapes over the run's own output artifacts — the §4 radioactive rule gains a mechanical floor; matched secrets are masked in the scanner's own output).
- **Producer/consumer self-checks wired:** `codebase-audit` gates its Done-when on a clean revalidate pass of the finished register; `remediation` and `feature-implementation` gate theirs on `--consumed`; `handoff` scans itself before handover. Guarded by lint check #13 so the wiring cannot silently regress.
- **Evals:** register-staleness extended (strict/consumed/redacted-anchor cases); new `proof-receipts`, `autofix-scope`, and `redaction-scan` regression evals wired into validate.yml.

## 1.13.1
- **Doctrine line untethered from a model name.** CONVENTIONS line 3 now targets "a capable agentic coding agent (e.g. Codex)" — the Opus 4.8 example pinned the suite to a model generation; capability is the contract, and the model floor is measured (see the model-floor calibration workflow) rather than named.

## 1.13.0
- **New skill `handoff`** (Mode: DOCUMENT) — session continuity for long runs. **Write** captures the run's true state as a verifiable `HANDOFF.md` before a context limit / session end / operator change: goal and state of play, every register path stamped `Verified-at: <sha>`, decisions with their rejected alternatives, traps & dead ends (the most valuable and least recoverable session state), and in-flight boundaries with anchored `file:line` pointers. The rule is *state, not instructions*. **Resume** treats every claim as context to verify, not fact to trust — `revalidate-register.mjs` on every named register, anchors checked, contradictions surfaced at a checkpoint. Registers carried findings across phases; nothing carried decisions and dead-ends across sessions until now.
- **Lint check #11: frontmatter angle-bracket injection guard.** `lint-plugins.mjs` now fails any SKILL.md whose frontmatter value contains `<` or `>` — frontmatter is injected verbatim into the system prompt at discovery (before the body is read), so angle-bracketed markup there is a prompt-injection surface no body-level guard sees. Complements the supply-chain-trust agent-ingested-content lens with a mechanical floor for this repo's own skills.

## 1.12.0
- **Anchor delimiter promoted from script comment to spec (`§7` schema, `§9`).** `revalidate-register.mjs` can only parse an `Anchor:` value that is backtick- or quote-delimited; that requirement lived solely in a script comment, so an executing model following CONVENTIONS could emit an undelimited anchor and silently lose the `DRIFTED` gate — the item fell open to plain line-existence checking. The schema and `§9` now state the syntax with a micro-example (`` Anchor: `req.query.accountId` ``); `reviewer` carries it inline.
- **`revalidate-register` warns on an unparseable anchor.** An `Anchor:` label whose value has no delimiter now earns a per-item advisory (`unparseable, DRIFTED check skipped`) instead of being silently ignored. Non-gating; anchor-less registers are checked exactly as before.
- **Eval:** `register-staleness` gains an undelimited-anchor case pinning the new advisory (FRESH status + explicit warning, never a silent skip).

## 1.11.0
- **Cascade circuit-breaker (`§11`).** Three or more fixes in a single run failing verification or spawning new confirmed findings now stop the implementation loop — a cascading cluster is evidence of an architectural problem, not a bug collection. The cluster reclassifies as NEEDS-DESIGN with the cascade chain recorded and options presented at a checkpoint (deferred and reported in headless runs). Wired into `remediation` and `debug`; mirrored in rigor `§H`.
- **`pr-review` scales the review to reach, not diff size.** Phase 0 now traces the change's reach — the dependents and call sites of changed exported symbols, shared types/schemas, and API/DB contracts — and scales reviewer fan-out and depth to it; a small diff in a shared contract is a large review.
- **`dependency-upgrade` closes CVEs on evidence.** "Done when" now requires a fresh advisory re-scan against the final lockfile (the ecosystem's live audit tool) showing no remaining high/critical advisories except those explicitly accepted or deferred with rationale — never inferred from the version bumps alone. `DEPENDENCY_REPORT.md` backs its CVEs-closed list with the re-scan output.
- **`adr` gains a three-prong admission gate (both modes).** A decision earns an ADR only when it is hard to reverse, surprising without context, and the result of a real trade-off; a candidate failing any prong is routed to a named destination (a code comment, the repo's existing docs surface, or a CHANGELOG line) instead of being written up — bounding Backfill mode inside the orchestrators' document phases. Handbook and `code-ops-docs/20 Decisions/ADRs` index updated to match.
- **`remediation` states its cold path.** A missing `FINDINGS_REGISTER.md` stops the run and routes to `codebase-audit` / `rigor:bug-hunt` — never synthesize a register from memory.
- **Evals: pre-registered measurement protocol.** `evals/README.md` now requires every model-in-the-loop measurement to pre-register (before the first scored run) its hypothesis, matched arms, n + stopping rule, metric with a minimum practically-significant delta, and an instrument (saturation) check; reports separate observed-delta-vs-noise from practical significance and end with a validity-threats list. Kills the confounded-arms class of calibration error at design time.

## 1.10.0
- **Independent refutation of load-bearing findings (`§1`, `§7`).** A critical/high-severity or fix-driving finding is no longer reported on the strength of the agent that found it. Before it ships at that severity it is handed to an *independent* sub-agent (a `reviewer`/`tracer` in a new **refutation mode**) that did **not** find it, whose sole job is to kill it by locating a dominating guard/handler in a **different function, file, or boundary** — majority-REFUTED drops the finding or downgrades it to SPECULATIVE with the cited guard. This is the adversarial complement to the (self-run) disconfirmation pass, aimed at the cross-function false-positive class self-review structurally misses; an item already proven by an executed repro skips the panel. Scoped to load-bearing findings, so nits are unaffected.
- **Verbatim-anchor citation gate (`§7` schema, `§9`).** Every finding now carries an `Anchor` — a verbatim substring copied from the cited line — so a citation is mechanically checkable. `revalidate-register.mjs` classifies a citation whose cited line no longer contains its anchor as **`DRIFTED`** (fail-closed), alongside FRESH/MOVED/GONE, turning "never fabricate a location" into a deterministic gate that catches a hallucinated or stale citation before it is acted on. Backward-compatible: anchor-less registers are checked exactly as before.
- **Agents made self-contained.** `reviewer` and `explorer` now carry their load-bearing discipline (verbatim anchor, disconfirmation, locate-the-handler) **inline** rather than by a pointer to `CONVENTIONS.md` a spawned subagent cannot always read; `reviewer` gains an explicit refutation mode. Wired into `pr-review` and `codebase-audit`.
- **Eval:** `register-staleness` extended to cover the anchor gate (a FRESH-with-anchor and a `DRIFTED` case), keeping the new mechanical gate under a deterministic CI guard.

## 1.9.0
- **CONVENTIONS hardened from a real-scale (~140k-LOC) calibration of the suite.** The disconfirmation pass (`§7`) gains two false-positive killers — read the cited line's by-design / accepted-deferred annotation, and *locate* the would-be handler before claiming a "nothing else handles this" gap. The operating model (`§1`) self-throttles the fan-out into **bounded waves**, injects the tool-enforced ruleset **inline** into reviewer prompts, **skims-then-deepens** very large files, and **audits the union of slice skipped-sets** at synthesis. A `claims-vs-enforcement` consistency sub-lens (`§10`) and a **headless / non-interactive contract** (`§3`) round it out.
- **Bundled runtime-script hardening (security + correctness).** `lib-docs` rejects a package `types` value that escapes the package dir and an IPv4-mapped-IPv6 SSRF, and caps an oversized streamed fetch chunk. `revalidate-register` classifies an escaping `Location:` citation `AMBIGUOUS` instead of silently re-rooting it `FRESH`. `lib-docs-mcp` returns `-32600` for a malformed method. `lint-plugins` gains empty-description, orphan-bundled-script, and handbook command-reference parity checks; `check-no-deps` now catches multiline and dynamic `import()` bare imports.
- **New: the suite handbook** under `code-ops-docs/40 Engineering/Handbook/` — the 4-plugin mental model, the orchestrators, registers/tiers, a per-command reference for all 55 commands, plus guides and techniques — kept honest by the command-reference parity gate and a fixture-drift CI guard over every eval answer key.

## 1.8.0
- **Runtime-script hardening (security + correctness).** `lib-docs` is now **local-only by default** (`noFetch=true`; opt in to the library-source fallback with `--fetch` / `noFetch:false`), rejects library names that could escape `node_modules` (CLI + MCP), and restricts the fetch fallback to https public hosts (no loopback/private). `revalidate-register` fixes an off-by-one EOF check, stops parsing standards tokens (RFC/CVE/ISO) and version/host strings as references, resolves bare-filename refs (new `AMBIGUOUS` status), and confines reference paths to the repo root. The `code-ops-docs` MCP wrapper validates its required `library` argument.
- **`scan-ai-tells.mjs` now bundled in code-ops-suite** so the `ship` / `pr-split` / `debug` traceless-PR gate has a mechanical floor even when `privacy-opsec-suite` is not installed.
- **Linter (`lint-plugins`) strengthened:** intra-plugin orchestrators validate against their own plugin, qualified `plugin:skill` references must resolve, single-word skill tokens are checked, and it now catches duplicate marketplace entries, unregistered plugin dirs, missing manifest fields, BOM-prefixed frontmatter, and unbundled script references — plus a new `check-no-deps` CI guard for the zero-dependency invariant and SHA-pinned CI actions.
- **Docs reconciled** (install blocks, eval inventory, §-citations).

## 1.7.1
- **Orchestrators refreshed for the 1.4–1.7 additions.** `full-sweep` and `everything` now wire today's capabilities through every phase: they **generate the reference docs** (`architecture` / `data-model` / `api-docs` / `ops-docs` / `adr`) in their document phase; reference the **automation-level ladder** (`§4`), **evidence tiers + disconfirmation** (`§7`), and the **multi-boundary control-coverage** lens (`§10`) in assess/prove; keep carried registers **fresh** (`§12` — re-validate before consuming, mark obsolete); verify library facts via the **in-house docs lookup** (`§2`); and ship results as a **traceless stacked PR** (`pr-split` → `authorship-hygiene`). The fixed `code-normalization` → `normalize` reference is retained. No change to the individual skills.

## 1.7.0
- **New documentation generators: `architecture`, `api-docs`, `data-model`, `adr`, `ops-docs`** (Mode: DOCUMENT) — produce deep, diagram-rich (Mermaid C4 / sequence / ER), code-grounded docs aimed at senior engineers, governed by a new `CONVENTIONS §13` documentation quality standard (layered exec-summary-first structure, diagrams as first-class, every claim cited + verified, freshness-stamped). They **generate** docs; `doc-alignment` maintains them; `onboarding` stays the newcomer path.

## 1.6.0
- **New skill `current-docs` + bundled `lib-docs.mjs` + a `code-ops-docs` MCP server** — an in-house, local-first alternative to Context7. Resolves a library's **installed** version and returns its real README + exported type signatures with zero network (fetch fallback only); no third-party indexer, no query egress. Wired as the default for the `CONVENTIONS §2` documentation-lookup capability across all three plugins, so every skill verifies APIs against the installed version instead of memory. The MCP server (`resolve-library` / `get-docs`) auto-registers when the plugin is enabled.

## 1.5.0
- **New orchestrators `ship` + `debug`** — task-scoped cross-plugin pipelines that compose the conventions end-to-end. `ship` drives one change (feature or one-off) through design-check → safety-net → implement → prove → privacy-gate → traceless PR. `debug` drives a symptom through reproduce → isolate → root-cause (checkpoint) → `fix-verified` → traceless PR. Both require `rigor`; the privacy phase runs when `privacy-opsec-suite` is installed and the change touches a privacy surface.

## 1.4.0
- **New skill `pr-split`** — carves an existing big branch into a clean stack of small, **independently-green** PRs (dependency/concern/atomicity grouping, green-at-every-step), then composes `privacy-opsec-suite:authorship-hygiene` fail-closed before pushing so the commits/PRs carry no AI/tooling trace. Never auto-merges.

## 1.3.0
- **Register freshness (fixes the proven field failure):** CONVENTIONS SSOT (§12) now mandates re-validating a finding against the current tree before it is written, carried across a phase boundary, or consumed; added a `Verified-at: <sha>` field to the Finding/Idea schemas (§7) and bundled `scripts/revalidate-register.mjs` (reports FRESH/MOVED/GONE/NO-REF). `codebase-audit` + `feature-discovery` stamp it; `remediation` runs it at Phase 0.
- **Evidence tiers + disconfirmation** added to the §7 Finding schema (CONFIRMED/PROBABLE/SPECULATIVE + a disconfirmation pass; only CONFIRMED drives an auto-fix) — borrowed from `rigor`.
- **Automation-level ladder** (`gated`/`auto-safe`/`auto-all` + always-gated categories, never auto-merge) promoted into CONVENTIONS §4.
- **Multi-boundary control-coverage** rule added to the Security lens (§10).
- Standardized the audit→discovery handoff on `FEATURE_OPPORTUNITIES.md` (dropped `FEATURE_IDEAS.md`).
- **Descriptions** rewritten to lead with `Use when…` triggers + scope/ownership clauses (orchestrator scope; cross-skill overlap disambiguation, e.g. performance↔improve-measured, pr-review↔deep-review↔opsec-pr-gate, normalize↔consistency-closure).

## 1.2.1
- **Fix:** `full-sweep` Phase 6 referenced a non-existent `code-normalization`
  skill; corrected to `normalize` (the real skill slug / `code-ops-suite:normalize`).
- **Docs:** the README now lists the `full-sweep` and `everything` orchestrators
  (previously absent from the Skills section); the root README skill count is
  corrected to 14.
- **Packaging:** added an MIT `LICENSE` and a `license` field to the manifest.
- **Tooling:** the marketplace now ships `scripts/lint-plugins.mjs` (structural
  linter) wired into CI, which catches this class of doc/reference drift.

## 1.2.0
- General-engineering suite: `codebase-audit`, `security-privacy-audit`,
  `remediation`, `feature-discovery`, `feature-implementation`, `performance`,
  `test-hardening`, `dependency-upgrade`, `pr-review`, `normalize`,
  `doc-alignment`, `onboarding`, plus the `full-sweep` and `everything`
  orchestrators. `explorer` + `reviewer` subagents; shared `CONVENTIONS.md`.
