---
type: design
status: superseded
superseded-by: "[[Program state, handoffs, and coordination 2026-09]]"
updated: 2026-09-27
tags:
  - design
  - handoff
  - coordination
  - token-economy
---

# Handoff fidelity and session coordination 2026-09

> Superseded on 2026-09-27 by [[Program state, handoffs, and coordination 2026-09]], which merges this draft with its sibling. This file stays as evidence.

Source: a measurement session on 2026-09-27. It compared two 72-hour windows of Claude transcripts across all projects. It then ran six read-only probes over 2026-09-20..2026-09-27: handoff decay, peer coordination, trigger overshoot and resume cost, dispatch friction, hook friction, and peer message content. The operator asked for two improvements and for more improvements from observed usage. The operator chose warn-only collision handling.

Verified-at: c204b17 (2026-09-27)

This design extends W5 of `Docs state and history 2026-09.md`, which is on the unmerged branch `docs/state-history-design`. That design gives decisions stable `DEC` ids, a disposition, and a standard archive. It does not cover open-item text, pointer freshness, program splits, or concurrent sessions. This design covers them and reuses its `Grammar: 2` switch.

## Evidence

Labels follow the user-wide contract. CONFIRMED means executed or directly observed. PROBABLE means two static lines of evidence.

### Handoff decay

Two murmuration chains were traced hop by hop: the console command center chain (22 hops) and the single-tap ledger chain (12 hops).

- No open item was dropped silently. Check 9 of `scripts/check-handoff.mjs` blocks a hop that loses a predecessor item. CONFIRMED.
- Anchor rot. OI-3 kept `Pointer: src/murmuration/control/availability.py:35` from hop 2 to hop 23. The symbol it names moved to `availability_lanes.py`. Check 6 resolves only pointers with an `Anchor:` label (`scripts/check-handoff.mjs:322`), so a bare `Pointer:` is never checked. CONFIRMED.
- Paraphrase drift. Every hop rewrites each item as prose. OI-3 narrowed in meaning, and its owner became ambiguous, with no recorded revision. CONFIRMED.
- Compression. At hop 12 the handoff held 9 items in 74 lines, about 8.2 lines per item. At hop 18 it held 24 items in 87 lines, about 3.6 lines per item. The 8 KB cap is the probable cause. PROBABLE.
- Split gap. The single-tap program split into two programs. Five items (OI-1, 2, 7, 8, 12) moved only through a hand-made `SPLIT-SINGLE-TAP.md`. No ledger or archive names them, so check 9 cannot follow them. CONFIRMED.

### Handoff economics

- The trailing 72 hours were compared with the 72 hours before. Resume overhead fell from 11.8% to 6.8% of chain input. The median predecessor handed off at 292k instead of 209k. Lead mean context per turn rose from 157k to 209k. The share of lead input above 300k rose from 0.5% to 19%. CONFIRMED.
- A replay of the recent window with a handoff at 209k costs 12-15% less price-weighted lead spend, including the overhead of 98 extra handoffs. A sweep put the best point at 200-240k. This is a model, not a measurement.
- The handoff card fired in all 38 sessions that crossed 300k. No session stopped. An autonomous loop drove 17 of them, and operator or peer input drove 16. CONFIRMED.
- One hub session reached 535k while it absorbed peer messages for 12 hours after its assessment. PROBABLE.
- An assessment that chose CONTINUE was followed by a median of 20 more turns. An assessment that wrote a handoff was followed by 11. PROBABLE, because the sample is small.
- A resume spends a median of 13 turns and 36.7k input tokens (p90: 22 turns, 54.6k) before its first real work. Design documents the handoff already summarized are the most common re-reads. CONFIRMED for cost, PROBABLE for cause.

### Session coordination

- 151 sessions produced 235 overlapping same-repo pairs and 507 overlap-hours. CONFIRMED.
- Leads sent about 500 messages to each other, 94% of them in murmuration. Every captured inbound message got a reply or an action. Status updates are the largest class. Explicit file or scope claims are rare. CONFIRMED for counts, PROBABLE for classes.
- Nothing announces a session's branch, claimed files, or recent changes to its peers. The peer guard runs only when a session sends a message. CONFIRMED.
- Collisions:
  - 67 pushes were rejected as non-fast-forward.
  - 7 pulls failed with "local changes would be overwritten". One pair failed 5 seconds apart.
  - 5 merge conflicts hit `DOCS_MANIFEST.json` and an eval runner.
  - Two sessions edited one design document during a 43-hour overlap.
  CONFIRMED.
- The peer guard denied 44 messages to finished sessions. One session was denied 11 times. Two sends failed on names that no longer existed. CONFIRMED.
- The session record store is keyed by the working directory's slug (`sessionRecordPath` in `scripts/transcript-lib.mjs`). A worktree session and a main-checkout session of one repository therefore live in different buckets. CONFIRMED.

### Other friction

- The dispatch guard denied 239 dispatches, and 224 of them were for missing brief fields. Retries took a median of 2 and a maximum of 6. In a byte-compared case, the content was present in prose or on a shared line. `briefHas` requires each label at the start of its own line. CONFIRMED.
- 30 dispatches were denied as wide-surface `general-purpose` dispatches. CONFIRMED.
- Declared round budgets were exceeded often: explorer 45%, `mech` 58%, `implementer` 29%, probe 24%. The implementer carries 83.5% of subagent input tokens. CONFIRMED.
- 16 identical bash-versus-PowerShell quoting errors (`unexpected EOF while looking for matching`) occurred. CONFIRMED.
- The rare dispatch-guard binding denial does not say how to comply. CONFIRMED, n=3.

Not measured: a join of collisions against message traffic, and message delay. Both need a follow-up pass.

## Workstream H: handoff fidelity

Each change applies to a program whose `PROGRAM.md` declares `Grammar: 2`, the switch W5 introduces. In-flight programs stay resumable. The new checks take numbers after W5's check 15.

### H1. Every pointer carries an anchor

- Check 16: every `Pointer:` in `## Open items` and in the ledger carries an `Anchor:`. A bare pointer fails under grammar 2 and warns otherwise.
- `co handoff draft` fills `Anchor:` from the cited line for each pointer it writes, so the rule costs the writer nothing.
- Resume re-resolves every carried pointer. A MOVED anchor is rewritten to its new line in the successor's draft. A DRIFTED or GONE anchor becomes a `[FILL: re-anchor or disposition]` line, so the next hop cannot carry it silently.

### H2. Open items are written once

- An item's text lives once, in the `PROGRAM.md` open-items ledger. `HANDOFF.md` lists the item's id and one clause of what changed this hop. This mirrors W5's check 15 for decisions.
- Check 17: an item whose `Done when:` or `Owner:` differs from the predecessor's text must carry `Revised: hop <n> · <reason>`. The history stays in the ledger.

### H3. Tier instead of compress

- `co handoff draft` sorts items into two groups. Active items were touched this hop and keep full detail. Carried items show only id and title, with full text in the ledger.
- The 8 KB cap then bounds active detail only. Detail no longer shrinks as the item count grows.

### H4. Program split

- `co handoff split <slug> --into <a>,<b>` writes a grammar-2 ledger for each child. It assigns each parent open item and each pending decision to exactly one child as `Forwarded-to: <child>/OI-<n>`.
- Check 9 follows `Forwarded-to:`. The split refuses to run while any item is unassigned. This replaces sidecar files such as `SPLIT-SINGLE-TAP.md`.

### H5. Cheaper resume

- The handoff's scope-documents section records, per document, a content hash and a one-paragraph digest with `Verified-at:`.
- Resume compares hashes. An unchanged document is not re-read. A changed one is re-read and flagged. This extends the same-tree trust that `check-handoff.mjs` already gives FRESH anchors.
- Target: the median resume cost falls from 36.7k to under 25k input tokens.

### H6. Handoff point and follow-through

- Move the documented handoff point from about 350k to about 225k. The 150k card bands stay as they are. D-1 below asks the operator to accept this, because it reverses part of PR #184.
- When no operator prompt has arrived since the last card, the session is running autonomously. There the card at the handoff point says to write the handoff at the next boundary instead of assessing again.
- An assessment that returns CONTINUE past the handoff point must record a `Continue-until:` bound, in turns or in context. The card fires again when the session passes it.
- Routing rule for hub sessions: peers post status to the coordination board (C3) instead of messaging the hub. Messages carry requests, warnings, and handovers only.

## Workstream C: session coordination

All state stays on the local machine under `<home>/.claude/code-ops/`. Nothing adds network traffic. Records hold names, branches, and repo-relative paths only. The hooks follow the suite's fail-open, bounded-read pattern and have off switches.

### C1. A repo-keyed presence board

- Key the board by the repository, not the working directory. A worktree's `.git` file names its common directory, so one file read maps a worktree to its repository without spawning git.
- Store one record per live session: name, host session id, branch, worktree, run folder, claimed paths, recent edits with timestamps, a one-line task, and a heartbeat.
- The existing hooks write it: `handoff-state.mjs` on run open and resume, the PostToolUse edit hook for recent edits, and SessionEnd to mark the record ended. A record without a heartbeat for 30 minutes counts as idle.
- `co board` lists the board. `co board claim <paths>` and `co board release` record explicit claims. A resume claims the program's scope documents automatically.
- Migrate the session record store to the same repository key, so `co handoff live` and the peer guard see worktree sessions too.

### C2. Collision warnings (warn only)

- PreToolUse on edit tools: when another live session claimed the path or edited it within the last 6 hours, add context that names the peer and gives a ready `SendMessage` line. The hook fires once per path, per peer, per session, and it never blocks.
- PreToolUse on `git pull`, `merge`, `rebase`, and `push`: list the live peers on the same branch, and their recent edits that overlap this session's dirty files.

### C3. Change feed

- PostToolUse on `git push`, `gh pr merge`, and edits to shared hub files (`DOCS_MANIFEST.json`, `PROGRAM.md`) appends an event: repository, branch, commit, session name, and changed paths.
- At its next prompt or tool call, each peer gets one line per new event, such as "main moved to <sha> by <name>; it touched files you edited". The line is limited to events that intersect the peer's branch or its edits. This targets the 67 rejected pushes and the stale pulls.
- Status posts (H6) go to the same feed, so they reach a peer only when the peer reads the board.

### C4. Redirect stale messages

- When the peer guard finds that the target has handed off to a live head, it rewrites the message's target to that head and adds a notice. It no longer denies.
- The rewrite uses PreToolUse input modification. Its support per host is UNVERIFIED, so PR 5 must confirm it from current host documentation. Hosts without it keep today's deny.

### C5. Derived-file conflicts

- `DOCS_MANIFEST.json` and other generated files are regenerated, never hand-merged. W5's parallel-sessions table already states this rule.
- `install-git-hooks.mjs` also registers a merge driver that takes either side and regenerates the file. This is repository-local git configuration, so D-3 asks the operator first.

## Workstream U: friction fixes

- **U1. Brief skeleton.** A brief-field denial prints a ready skeleton of the missing labels, one per line, for the exact agent type. `co brief <agent>` prints the full template. The routing card names that command. Label parsing stays as it is. The gate's rule is unchanged, and only its message improves.
- **U2. Binding denial.** The binding and counter denial states the mechanical fix, as the other denials do.
- **U3. Push sync.** The ship skill's push step runs fetch, rebase, and push, and retries once on a non-fast-forward rejection. With C3, this addresses the 67 rejections.
- **U4. Round-budget checkpoint.** At 1x the declared budget, the subagent receives a context line telling it to checkpoint to its report path and return. The hard stop moves from 2x to 1.5x. This tightens a gate and weakens none.
- **U5. Shell trap.** A routing-card line tells sessions on Windows to write multi-line scripts to a file and never to nest quotes in `node -e` inside bash. This addresses the 16 quoting errors.

## Delivery

| PR | Content | Risk surface | Depends on |
| --- | --- | --- | --- |
| 1 | U1, U2, U5, and a check-16 warning (H1, warning only) | Gate messages | None |
| 2 | H1 enforcement, H2, and H3 under grammar 2 | Handoff contract | 1; W5's grammar switch, or its own if W5 has not landed |
| 3 | H4 split and H5 resume digest | Handoff contract | 2 |
| 4 | H6 handoff point, card follow-through, and `Continue-until:` | Hook behavior | None |
| 5 | C1 board and the session-store rekey, C4 redirect | Hooks, public contract | None |
| 6 | C2 warnings and C3 feed | Hooks | 5 |
| 7 | C5, U3, U4 | Git configuration, ship skill, dispatch guard | 6 for C5 |

Each PR bumps `code-ops-suite`, regenerates host distributions, and carries its own eval cases. PRs 2, 5, and 6 touch public contracts or hooks. The operator decides at each checkpoint whether `code-ops-suite:local-review-gate` runs on them.

## Measurements to pre-register

Record these in `MEASUREMENTS.md` before PR 4 and PR 6 land. Re-measure with the same 72-hour window method one week after each lands.

- Price-weighted lead cost per turn, and the share of lead input above 300k. Expected: both fall after PR 4.
- Median resume cost to first real work. Expected: under 25k after PR 3.
- Brief-field denials per 100 dispatches. Expected: under a third of today's rate after PR 1.
- Non-fast-forward push rejections and merge conflicts per overlap-hour. Expected: a fall after PRs 6 and 7.

## Operator decisions

The operator accepted each recommendation on 2026-09-27.

- D-1 The handoff point moves from about 350k to about 225k.
- D-2 A message to a session that handed off is rewritten to its live head. A host without input modification keeps the deny.
- D-3 `install-git-hooks.mjs` registers the derived-file merge driver in each checkout.
- D-4 Status updates go to the board. Messages carry only requests, warnings, and handovers.

## Rejected alternatives

- Accepting brief labels mid-line. It would loosen a gate's parsing. The skeleton in U1 fixes the same friction without touching the rule.
- Blocking edits on collision. The operator chose warn only, and a block can stall an autonomous run.
- A shared network service for the board. Local files cover sessions on one machine and add no traffic.
- Raising the 8 KB handoff cap. Tiering keeps the cap and stops the compression.

## Open items

- DSN-1 The collision and message-traffic join was not measured · Owner: agent · Done when: a pass joins git-mutating calls to peer sends by repo and time, and this section records the result
- DSN-2 PreToolUse input modification per host is UNVERIFIED · Owner: agent · Done when: PR 5 cites current host documentation for each host, or keeps the deny on that host
- DSN-3 The handoff-point replay is a model · Owner: agent · Done when: the pre-registered window comparison runs one week after PR 4
