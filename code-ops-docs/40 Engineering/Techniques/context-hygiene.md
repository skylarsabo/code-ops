# Context hygiene

A long run does not fail when the context window fills. It fails earlier, in the way the
run was recorded, and the full window only exposes it. This page is the discipline that
keeps a run's spend roughly linear and lets it survive compaction, a session end, or an
operator change.

## Exec summary (stop here if that is all you need)

- Durable state lives in files, never only in the conversation.
- Compact at a phase boundary you choose, not when auto-compact fires mid-task.
- A fresh subagent with a tight brief is a better compaction than a summary.
- Treat a cache as an acceleration, never as durable state.
- At a workstream boundary, rebuild from artifacts instead of carrying history forward.

## Durable state lives on disk

Write findings registers, task lists, handoff notes, and receipts as they are produced.
Anything that exists only in the conversation is lost at the next compaction, and a
rebuilt approximation of a register is not the register. The suite already leans on that
rule: registers are the SSOT
([04 · Registers and freshness](../Handbook/04-registers-and-freshness.md)), the dispatch
ledger makes a hung subagent visible as a dangling entry, and
`RUN_RUNTIME_RECEIPTS.jsonl` replays a version 3 runtime boundary that the transcript can
no longer show.

The test is simple. If the session ended now, could the next one continue from the files
alone? If not, the missing piece belongs on disk before the next dispatch.

## Compact deliberately

Auto-compact fires when the window is full, which is rarely a good moment. It lands
mid-task on a bloated context and drops whatever was not written down. Compact instead at
a boundary you pick: after a review lands, before a new workstream opens, or once a phase
checkpoint is approved.

When the main context has grown past usefulness, prefer a fresh subagent with a tight
brief over dragging history forward. The brief names the files and the artifacts. Such a
brief is the compaction, and it carries no accumulated noise.

Keep the conversation history append-only. Never edit, summarize in place, or remove an
earlier turn, because the host's prompt cache and any bound thinking blocks restart from
the first changed byte. Send a per-turn reminder as a turn-scoped message. Change
instructions with a mid-conversation system message rather than a rewritten system prompt.

When compaction is unavoidable, replace the whole history with one summary plus the new
turn and replay nothing else. Cache reads are cheap on current models, so a later
compaction point often costs less than an early one.

## What the summary must keep

The `PreCompact` hook `precompact-preserve.mjs` hands the host the compaction's custom
instructions, so the summary keeps six items:

1. Every problem met, and how each was handled or resolved.
2. Every option raised, tried, or set aside, and why.
3. Everything asked, decided, agreed, ruled out, or set as a constraint, in the words used.
4. Exactly where things stand: what is covered, settled, or complete.
5. Everything still open, unresolved, promised, or expected next.
6. Names, numbers, dates, paths, commit ids, register ids, and links that resist reconstruction.

The hook prints its text to standard output, because the host reads a `PreCompact` hook's
raw output as those instructions. It fails open, so an error costs the instruction and
never the compaction. The instruction also pins two rules: keep every `<REDACTED:reason>`
marker as it stands, and name a run artifact's path rather than restating its contents.

## Treat acceleration as optional

A live subagent or host may retain reusable context. Batch known follow-ups while that
state is available. Do not rely on retention, duration, or a cache hit without host
evidence. A fresh session must reconstruct the run from durable artifacts alone.

For a version 3 run, declare host capabilities before fan-out. Use a stable prefix only
when the host can inject the exact emitted payload. Record observed cache events in the
runtime receipt chain. Do not treat a prefix, cache, compaction, or host memory as state.

Reuse a live subagent when the next task builds on context it already carries. Spawn a
fresh one when stale context would mislead it. Reuse is a cost decision, and correctness
outranks it.

## Measuring a session instead of estimating it

The `SessionEnd` hook `session-receipt.mjs` appends one row per session to a local
ledger: token usage by class, tool calls, tool-result volume, model mix, wall time, and
the mechanisms the session ran under. The ledger is `~/.claude/code-ops/session-receipts.jsonl`,
or `$CODE_OPS_RECEIPTS`. It sits in the home directory so it can never be committed by
accident, and nothing leaves the machine.

The hook is on by default. To silence it, set `CODE_OPS_RECEIPTS` to `off`, `0`, or
`false` in the `env` block of a `.claude/settings.json`. Read the ledger with these
commands:

- `co context audit receipts` prints the aggregate for the current project.
- `co context audit receipts --by-arm` groups sessions by the mechanisms each ran under.
- `co context audit receipts --purge-before <ISO date>` rewrites the ledger, keeping only
  later rows.

Nothing purges on its own, so retention is the operator's decision, and the purge reports
what it removed. Each row records three arms: the output digest, the ladder card, and the
symbol index. One checkout running with a mechanism and another running without it
therefore compare directly, which is how
[MEASUREMENTS.md](../../55%20Operations/MEASUREMENTS.md) gets its rows. The receipt
contract lives in [CONTRACTS.md](../../35%20Contracts%20and%20Data/CONTRACTS.md), and the
switches live in [INFRASTRUCTURE.md](../../50%20Platform/INFRASTRUCTURE.md).

## Reconstruction beats summarization

At the end of a workstream, write the handoff note, then start the next workstream in a
fresh session that rebuilds from the artifacts. Exact artifacts beat any summary,
extractive or abstractive, because a summary drops the detail the next decision needs and
cannot say which detail it dropped.

`/code-ops-suite:handoff` captures a run's true state as a verifiable `HANDOFF.md` and
re-verifies every claim before a resume acts on it. A version 3 resume also replays its
receipt chain, verifies the current binding, and reuses the latest checkpoint references.

## Related

- [09 · Cost and scoping](../Handbook/09-cost-and-scoping.md): the levers that fit a run to a budget.
- [Subagent trade-offs](subagent-trade-offs.md): tier and effort routing, and what fan-out costs.
- [04 · Registers and freshness](../Handbook/04-registers-and-freshness.md): the `Verified-at` sha and `revalidate-register.mjs`.
- [Register carry-forward](register-carry-forward.md): moving a register between runs without carrying stale findings.
- [10 · Recovery and troubleshooting](../Handbook/10-recovery-and-troubleshooting.md): the dispatch ledger and the failure ladder.

*Verified-at: b0ffede*
