# Context hygiene

A long run does not fail when the context window fills. It fails earlier, in the way
the run was recorded, and the full window only exposes it. This page is the discipline
that keeps a run's spend roughly linear and lets it survive compaction, a session end,
or an operator change.

## Exec summary (stop here if that is all you need)

- Durable state lives in files, never only in the conversation.
- Compact at a phase boundary you choose, not when auto-compact fires mid-task.
- A fresh subagent with a tight brief is a better compaction than a summary.
- Batch follow-ups to a live subagent. Its prompt cache expires in minutes.
- At a workstream boundary, rebuild from artifacts instead of carrying history forward.

## Durable state lives on disk

Write findings registers, task lists, handoff notes, and receipts as they are produced.
Anything that exists only in the conversation is lost at the next compaction, and a
rebuilt approximation of a register is not the register. The suite already leans on
this: registers are the SSOT ([04 · Registers and freshness](../Handbook/04-registers-and-freshness.md)),
the dispatch ledger makes a hung subagent visible as a dangling entry, and
`RUN_RECEIPTS.md` replays a proof the transcript can no longer show.

The test is simple. If the session ended now, could the next one continue from the files
alone? If not, the missing piece belongs on disk before the next dispatch.

## Compact deliberately

Auto-compact fires when the window is full, which is rarely a good moment. It lands
mid-task on a bloated context and drops whatever was not written down. Compact instead
at a boundary you pick: after a review lands, before a new workstream opens, once a
phase checkpoint is approved.

When the main context has grown past usefulness, prefer a fresh subagent with a tight
brief over dragging history forward. The brief names the files and the artifacts. That
*is* the compaction, and it carries no accumulated noise.

## Respect the subagent cache

A live subagent holds a warm prompt cache that expires in minutes. Batch the follow-ups
you already know you need and send them promptly. A late follow-up pays full price for
context the subagent still holds.

Reuse a live subagent when the next task builds on context it already carries. Spawn a
fresh one when stale context would mislead it. Reuse is a cost decision, and correctness
outranks it.

## Reconstruction beats summarization

At the end of a workstream, write the handoff note, then start the next workstream in a
fresh session that rebuilds from the artifacts. Exact artifacts beat any summary,
extractive or abstractive, because a summary drops the detail the next decision needs
and cannot say which detail it dropped.

`/code-ops-suite:handoff` captures a run's true state as a verifiable `HANDOFF.md` and
re-verifies every claim before a resume acts on it.

## Related

- [09 · Cost and scoping](../Handbook/09-cost-and-scoping.md) — the levers that fit a run to a budget.
- [Subagent trade-offs](subagent-trade-offs.md) — tier and effort routing, and what fan-out costs.
- [04 · Registers and freshness](../Handbook/04-registers-and-freshness.md) — the `Verified-at` SHA and `revalidate-register.mjs`.
- [Register carry-forward](register-carry-forward.md) — moving a register between runs without carrying stale findings.
- [10 · Recovery and troubleshooting](../Handbook/10-recovery-and-troubleshooting.md) — the dispatch ledger and the failure ladder.

*Verified-at: 189949e*
