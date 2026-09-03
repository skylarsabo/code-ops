# Shell discipline

Two shell habits cost a run more than any other, and both fail quietly. A blocked
compound command loses work that already looked done. A broad `git add` stages local
state the repository was never meant to carry. This page states both rules, the hook
layer they run against, and the reason each rule holds.

## Exec summary (stop here if that is all you need)

- Run hook-gated commands standalone. Never chain them.
- Stage by explicit path. Never `git add -A` or `git add .` where untracked local state exists.
- Read the staged file list against intent before every commit.

## Hook-gated commands run standalone

A `PreToolUse` hook decides on the whole tool call, not on one command inside it. When
a hook blocks a compound command, the host cancels every operation in that command,
including the ones that would have run before the gated call. Nothing partial is
committed and nothing reports what was skipped.

So `git commit`, `gh pr create`, and `gh pr merge` each run as their own call. The
suite's own traceless gate is such a hook: `enforce-traceless` blocks a flagged commit
or PR at the tool layer ([08 · CI and automation](../Handbook/08-ci-and-automation.md)).
Chain a build, a test run, and a commit into one line, and one flagged commit message
discards all three.

The rule costs one extra tool call. The failure it prevents is silent.

## The output digest on the same Bash hook

`hooks/digest-rewrite.mjs` is a second `PreToolUse` Bash stage, and it runs after the
traceless gate. It rewrites an allowlisted simple command into a `scripts/digest.mjs`
run, so the command's output reaches the context compressed and receipted. The rewrite
is on by default.

The rewrite is deliberately narrow. It passes a command through untouched when that
command carries a pipe, list, redirect, expansion, subshell, or heredoc. Keeping each
command simple is therefore what lets the digest apply at all.

To turn the rewrite off, set `CODE_OPS_DIGEST` to `off`, `0`, or `false` in the `env`
block of a `.claude/settings.json`. The same block holds `CODE_OPS_INDEX`,
`CODE_OPS_LADDER_CARD`, and `CODE_OPS_RECEIPTS`.
[Infrastructure](../../50 Platform/INFRASTRUCTURE.md) owns every switch and its default.

## Stage by explicit path

`git add -A` and `git add .` stage whatever the working tree holds. In a repository
carrying untracked local state, a broad add sweeps in scratch directories, local
settings, agent-generated plans, and anything else `.gitignore` did not anticipate.
Name the paths instead. Then read `git status --short` against what you meant to change.

The explicit-path rule pairs with the rule that agent artifacts stay local. Never
force-add a spec, a plan, or a generated document under an ignored path. A `-f` add
defeats the ignore that was protecting it.

## Related

- [08 · CI and automation](../Handbook/08-ci-and-automation.md): the PR gates and the traceless hook.
- [Redaction discipline](redaction-discipline.md): what must not reach a published artifact.
- [10 · Recovery and troubleshooting](../Handbook/10-recovery-and-troubleshooting.md): recovering a run after a blocked or partial step.

*Verified-at: b0ffede*
