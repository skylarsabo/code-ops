# Workspace layout

Agents leave files in odd places. A scratch script lands in the repository root. A worktree lands in a
sibling folder, or inside another worktree. Each stray file costs a later session a search and a
cleanup, and some of them reach a commit. This page states the one place each host puts worktrees
and scratch files, how the suite creates and checks that place, and what the suite cannot control.

## Exec summary (stop here if that is all you need)

- Each host works inside one folder at the repository top: its host folder.
- Put scratch files in `<host folder>/.tmp`. Put worktrees in `<host folder>/worktrees/<topic>`.
- Create a worktree with `git worktree add <worktrees>/<topic> -b eng/<topic>`.
- Run artifacts stay in `80 Runs/`. The `.tmp` folder holds throwaway files only.
- The guard only advises. It never blocks or rewrites a call.

## The host folders

| Host | Host folder |
| --- | --- |
| Claude Code | `.claude` |
| Codex | `.codex-work` |
| Grok | `.grok` |
| OpenCode | `.opencode` |
| Copilot | `.copilot` |
| Any other host | `.agent-work` |

Codex differs from the pattern. Codex keeps `.codex/` read-only under workspace-write, even inside
`writable_roots` ([Codex approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)).
So Codex uses `.codex-work`, which it can write.

Each host folder holds two subfolders: `worktrees/` and `.tmp/`. Each of the two carries a
`.gitignore` that holds `*`. A repository therefore needs no tracked change to adopt the layout.

## Where each folder lives

- **Scratch folder.** The path is `<top>/<host folder>/.tmp`, where `<top>` is the root of the current
  checkout. Each worktree has its own scratch folder, so two checkouts never share scratch files.
- **Worktrees folder.** The path is `<main checkout>/<host folder>/worktrees`. It always sits under the
  main checkout, even when the command runs from inside a worktree. So worktrees never nest.

The script resolves both paths without a git process. It follows the `.git` file of a linked
worktree back to the main checkout.

## The resolver

`scripts/workspace-layout.mjs` is the single source for these paths. `co workspace <command>` runs it. The script has three commands:

- `path [tmp|worktrees]` prints the resolved path for the detected host.
- `ensure` creates both folders and their `.gitignore` files. It never overwrites an existing file.
- `check [--strict]` lists each worktree that `git worktree list` reports and labels it in-layout,
  host-managed, or stray. It also reports a host folder that lacks its `.gitignore`. It exits 0
  unless `--strict` is set.

A stray worktree sits outside the worktrees folder and is not host-managed. `check` reports it. It
never moves it, because the worktree may hold uncommitted work.

## The guard

The guard is advisory only. It lives inside `plugins/code-ops-suite/hooks/dispatch-guard.mjs`, so it
adds no hook process. It never denies a call, rewrites a call, or counts toward any dispatch limit.
The advice reaches the model as added context.

The guard speaks in two cases:

- A write tool targets a path outside the repository, outside the temp directory, and outside the host
  home folders. The advice names the host scratch folder. It adds that the path is fine when the user
  asked for it.
- A `git worktree add` places a worktree outside the host worktrees folder. The advice gives the exact
  form `git worktree add <worktrees>/<topic> -b eng/<topic>`. Without `-b`, git names the branch after
  the path, so the form carries the branch name.

The guard stays silent whenever it cannot be certain. That covers a command it cannot parse with
certainty, a variable in the path, a subshell, a tool without a path field, and an unknown tool.
It says each advisory once per session for each directory, so it cannot nag.

On Claude and Codex, `routing-card.mjs` creates the folders at session start in a git repository and
names the paths on the routing card. Grok gets the folders without the card line. Set `CODE_OPS_WORKSPACE_GUARD` to `off`, `0`, or `false` to stop the advisories
and the session setup. [Contracts](../../35 Contracts and Data/CONTRACTS.md#workspace-guard-hook) owns
the exact behavior. [Infrastructure](../../50 Platform/INFRASTRUCTURE.md) owns the switch and the
per-host coverage.

## What the suite does not control

Three limits apply, and each comes from the host vendor's own documentation.

- **Host-created worktrees follow the host.** Claude already defaults to `.claude/worktrees`. Codex
  defaults to `$CODEX_HOME/worktrees` and moves only through an app setting. Grok defaults to
  `~/.grok/worktrees/<repo>/<name>` and has no relocation setting that we found. OpenCode has
  `worktree.directory`, which an operator can set to `.opencode/worktrees`. The suite steers only a
  worktree that an agent creates with `git worktree add`. `check` labels the host-managed ones.
- **The temp directory is not redirected.** The suite leaves `TMPDIR` alone on purpose, because a temp
  folder inside a repository changes what tests and git see. `CLAUDE_CODE_TMPDIR` is ignored in
  project settings, so a repository cannot set it. The scratchpad that a host requires for its own
  session stays allowed. The suite stores under `~/.claude/code-ops/` do not move.
- **Coverage differs by host.** Claude gets the advisory and the session setup. Codex gets the advisory
  for shell commands and for path tools, and the session setup. Codex `apply_patch` has no path field,
  so it stays silent. Grok gets the session setup when a session starts but no card line, because it
  ignores hook output and its stdin is unverified, so the hook uses the process working directory.
  OpenCode gets no setup from the routing card: run `co workspace ensure`. OpenCode also runs none of
  the hooks, so it relies on the written rule.

## Related

- [Shell discipline](shell-discipline.md): staging by explicit path, which keeps local folders out of a commit.
- [Context hygiene](context-hygiene.md): durable state on disk, which belongs in `80 Runs/` and not in `.tmp`.
- [Subagent trade-offs](subagent-trade-offs.md): the verifier and implementer rules that use these folders.
- [Vault standard](vault-standard.md): where run artifacts land.
