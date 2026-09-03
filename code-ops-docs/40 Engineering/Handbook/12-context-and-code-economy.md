# Context and code economy

This chapter is for anyone who runs the suite and wants to know what it does to token cost, code size, and output quality without being asked. It names each mechanism, what it costs, how to read its effect, and how to turn it off. Every mechanism runs on install. Nothing here needs configuration.

## What a session gets on install

The suite compresses at the source and points instead of pasting. Four mechanisms and one instruction card do that work:

- **Output digest.** Every allowlisted simple Bash command runs through `scripts/digest.mjs`. Its output arrives compressed by shape, with a trailer naming the raw file and its sha256, so a truncated result is a pointer and never a loss. Errors, failures, summaries, and headers are kept by contract.
- **Symbol index.** `scripts/context-query.mjs` answers a structural question with `file:line` anchors, one-line signatures, and edge lists. A hook re-indexes each file the session edits. Hosts without a Bash tool reach the same index through the `code-ops-query` MCP server.
- **Ladder card.** An implementer subagent starts with a ten-line card: the ordered objective and the six-rung ladder that decides whether new code needs to exist at all.
- **Session receipts.** One row per session lands in a home-directory ledger with exact token usage, tool calls, the context resident at session end, and which mechanisms ran. Nothing leaves the machine.
- **Session card.** The routing card printed at session start carries the progress-update rule, the output-visibility rule, and the economy rules in one line each.

## The ordered objective and the ladder

Code has an ordered objective: correctness and the safety floor, then module boundaries, then measured performance on hot paths, then readability, then size. Fewer lines wins only between candidates equal on the first four.

Before writing code, climb the ladder:

1. Does it need to exist? Scope is the request.
2. Does it exist here? Search before you write.
3. Does the standard library, the platform, or an installed dependency do it? Verify against current docs, never memory.
4. Does it fit inside the owning module? Extend before you add a file.
5. Extract only on evidence: a second caller, a unit that needs its own test, or a file past the repository's own size norm.
6. Then write the minimum edge-case-correct implementation.

Mark a deliberate simplification with a `deferred(<ceiling>, <upgrade path>)` comment. The harvest collects every marker into a register that the freshness checker understands, so a deferral carries a route back.

## Commands a reader reaches for

| I want to | Command |
| --- | --- |
| Read a large file without loading it whole | `node scripts/skim.mjs <file>`, then `--range A,B` |
| Find a definition, its callers, or its callees | `node scripts/context-query.mjs find\|callers\|callees <symbol>` |
| See what breaks if a file changes | `node scripts/context-query.mjs blast <path>` |
| Search the index under a byte budget | `node scripts/context-query.mjs explore "<terms>" --budget 4000` |
| Compress one command's output by hand | `node scripts/digest.mjs -- <command>` |
| Check a diff for over-building | `node scripts/co.mjs scan overbuild --git <range>` |
| Collect deferral markers into a register | `node scripts/co.mjs scan deferrals` |
| Read what sessions cost, by mechanism | `node scripts/context-audit.mjs receipts --by-arm` |
| Purge old receipt rows | `node scripts/context-audit.mjs receipts --purge-before <ISO date>` |

Every command above also resolves through `scripts/co.mjs`, the one entrypoint, as `co context skim`, `co context query`, `co context digest`, `co scan overbuild`, `co scan deferrals`, and `co context audit`.

## The over-build scanner

`scan-overbuild.mjs --git <range>` reads one diff and the tree at its head and reports eight tells: a burst of small new files, an interface with one implementor, a function that forwards its own parameters, a package entry with no decision record, an oversized test file, an unread root config key, a duplicate export, and commented-out code. Only the unrecorded dependency blocks. Every other tell is advisory, because the scanner is a floor under the reviewer's eye, not a proof. On this repository, pass `--exclude codex-marketplace --exclude opencode-dist` so the derived copies do not repeat each hit.

## Switching a mechanism off

Each mechanism reads one switch. Set it to `off`, `0`, or `false` in the `env` block of a `.claude/settings.json`, at user scope for every repository or at repository scope for one:

| Mechanism | Switch |
| --- | --- |
| Output digest | `CODE_OPS_DIGEST` |
| Raw-output store for the digest | `CODE_OPS_DIGEST_STORE` |
| Index refresh hook | `CODE_OPS_INDEX` |
| Ladder card | `CODE_OPS_LADDER_CARD` |
| Session receipts | `CODE_OPS_RECEIPTS` |

```json
{ "env": { "CODE_OPS_DIGEST": "off" } }
```

The digest keeps every rewritten command's raw output under `~/.claude/code-ops/digest/<repository slug>/` until the operator deletes it. `CODE_OPS_DIGEST_STORE=off` keeps the compression and writes nothing.

## Reading the effect

The measurement is receipts, not estimates. Each receipt row records which mechanisms the session ran under, on unless a switch said off. `context-audit.mjs receipts --by-arm` groups rows by that record and prints per-session means: tokens, cache reads, tool-result characters per turn, context at end, and tool calls. An arm reads against sessions run with a mechanism off on the same directory. The schedule, the sample size, and the decision rules for keeping or removing each mechanism are pre-registered on the measurement page, so the numbers decide and not the author.

## Where the detail lives

- Contracts for every script and hook, with `file:line` evidence: `code-ops-docs/35 Contracts and Data/CONTRACTS.md`.
- Switches and what each hook writes to disk: `code-ops-docs/50 Platform/INFRASTRUCTURE.md`.
- The measurement instruments, the baseline, and the pre-registered comparison: `code-ops-docs/55 Operations/MEASUREMENTS.md`.
- The design that produced the mechanisms and the decisions behind them: `code-ops-docs/10 Design/Context and code economy 2026-09.md`.
- The ladder as doctrine: `plugins/code-ops-suite/CONVENTIONS.md` section 11, pinned across the three plugins that carry an implementation loop.
