# Shell discipline

Two shell habits cost a run more than any other, and both fail quietly. A blocked
compound command loses work that already looked done. A broad `git add` stages local
state the repo was never meant to carry. This page states both rules and why they hold.

## Exec summary (stop here if that is all you need)

- Run hook-gated commands standalone. Never chain them.
- Stage by explicit path. Never `git add -A` or `git add .` where untracked local state exists.
- Read the staged file list against intent before every commit.

## Hook-gated commands run standalone

A `PreToolUse` hook decides on the whole tool call, not on one command inside it. When
a hook blocks a compound command, every operation in that command is cancelled,
including the ones that would have run before the gated call. Nothing partial is
committed and nothing reports what was skipped.

So `git commit`, `gh pr create`, and `gh pr merge` each run as their own call. The
suite's own traceless gate is such a hook: `enforce-traceless` blocks a flagged commit
or PR at the tool layer ([08 · CI and automation](../handbook/08-ci-and-automation.md)).
Chaining a build, a test run, and a commit into one line means a single flagged commit
message discards the build and the test run too.

The rule costs one extra tool call. The failure it prevents is silent.

## Stage by explicit path

`git add -A` and `git add .` stage whatever the working tree holds. In a repo carrying
untracked local state, that means scratch directories, local settings, agent-generated
plans, and anything else `.gitignore` did not anticipate. Name the paths instead, then
read `git status --short` against what you meant to change.

This pairs with the rule that agent artifacts stay local. Specs, plans, and generated
docs under ignored paths are never force-added, because a `-f` add defeats the ignore
that was protecting them.

## Related

- [08 · CI and automation](../handbook/08-ci-and-automation.md) — the PR gates and the traceless hook.
- [Redaction discipline](redaction-discipline.md) — what must not reach a published artifact.
- [10 · Recovery and troubleshooting](../handbook/10-recovery-and-troubleshooting.md) — recovering a run after a blocked or partial step.

*Verified-at: 189949e*
