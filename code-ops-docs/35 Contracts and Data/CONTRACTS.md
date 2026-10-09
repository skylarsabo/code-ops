---
type: reference
status: current
updated: 2026-09-18
---

# Contracts

This page states the exact contract of every machine-checked artifact, command, and host hook
the repository ships. Read it when you need a flag, an exit code, a field name, or a default,
and cite it rather than restating it. The [data model reference](DATA_MODEL.md) owns the record
shapes, and the [infrastructure reference](../50%20Platform/INFRASTRUCTURE.md) owns the switches.

## Contents

- [Run contract](#run-contract)
- [Snapshot receipt](#snapshot-receipt)
- [Context bundle](#context-bundle)
- [Host capabilities and policy](#host-capabilities-and-policy)
- [Stable prefix and runtime receipts](#stable-prefix-and-runtime-receipts)
- [Cache telemetry](#cache-telemetry)
- [Session receipt hook](#session-receipt-hook)
- [Routing card and traceless hooks](#routing-card-and-traceless-hooks)
- [Local judgment gate](#local-judgment-gate)
- [Judgment evals](#judgment-evals)
- [Acceptance and result](#acceptance-and-result)
- [Compatibility](#compatibility)
- [Output digest](#output-digest)
- [Digest rewrite hook](#digest-rewrite-hook)
- [Script entrypoint](#script-entrypoint)
- [File skim](#file-skim)
- [Over-build scanner](#over-build-scanner)
- [Deferral harvest](#deferral-harvest)
- [Ladder card hook](#ladder-card-hook)
- [Subagent report hook](#subagent-report-hook)
- [Handoff card hook](#handoff-card-hook)
- [Handoff write and consumption](#handoff-write-and-consumption)
- [Dispatch guard hook](#dispatch-guard-hook)
- [Agent state machine](#agent-state-machine)
- [Peer guard hook](#peer-guard-hook)
- [Change feed](#change-feed)
- [Symbol index and query](#symbol-index-and-query)
- [Atlas claims and scope suggestion](#atlas-claims-and-scope-suggestion)
- [Documentation manifest](#documentation-manifest)
- [Record operations](#record-operations)

## Run contract

`RUN_CONTRACT.json` is the machine-checked plan for an orchestrated run.
`run-contract.mjs` supports versions 1 through 4. Version 2 adds a required context
binding. Version 3 adds a required runtime binding and `runtime-drift` to the canonical
replan triggers. Version 4 adds the enforced lead-and-operatives policy. Evidence:
`scripts/run-contract.mjs`.

`run-contract.mjs init --run <dir> --lead-model <id>` starts a version 4 contract. The run
directory must sit inside the repository and be ignored by Git. Its name becomes `runId`.
Init prepares `CONTEXT_SNAPSHOT.json` and writes `HOST_CAPABILITIES.json` with source
`host-probe`. Every capability state is `unknown`, because a script cannot observe a host
feature. Init takes `head` from Git and the lead tier from the model registry. The lead
effort defaults to `high`. An unplaced model needs `--lead-tier`. Init also fills
`replanOn`, the context and runtime blocks, default budgets, the orchestration floor, and
task-based routing. The stable prefix defaults to the tracked `AGENTS.md`, or else
`CLAUDE.md`. Init leaves `objective`, `nonGoals`, `quality.dimensions`, `quality.criteria`,
and `units` empty, so `check` fails until the lead fills them. Init refuses to overwrite an
existing contract, snapshot, or capability receipt without `--force`. After init, it records the
session in `SESSION.json` in the run directory: `sessionId` from `--session`, else
`CLAUDE_CODE_SESSION_ID` or `CODEX_SESSION_ID`, and `hostSessionId` from `--host-session`, else
`CLAUDE_CODE_HOST_SESSION_ID`, else the id the file already holds. It merges
into an existing file, so a re-run keeps the other fields. It leaves a `SESSION.json` that names
another session, or that is not a JSON object, unchanged and says so. With no session id it says so
and writes nothing. The lookups by session id (the compact card and the snapshot) then find the
run folder without a hand-written file. The façade form is `co run contract init`. Evidence: `scripts/run-contract.mjs` and
`evals/run-contract/run.mjs`.

Each contract declares these top-level concerns:

- `quality` defines ordered criteria, proof, oracle, owner, and blocking status.
- `budget` limits dispatches, concurrent work, and retries per unit.
- `units` define scope, artifact, dependencies, routing, quality criteria, and an optional positive input, output, and reasoning token envelope.
- `context` binds version 2 work to a snapshot, bundle location, untracked-file policy, and byte budgets.
- `runtime` binds version 3 work to host-capability evidence, runtime receipts, a stable
  prompt prefix, a prefix byte budget, and one policy per capability.
- `orchestration` binds version 4 work to at least two operatives and a
  parallel wave of at least two disjoint units. An optional `singleUnitReason` of at most 20
  words lets `minOperatives` and `minParallel` fall to 1. The validator rejects the reason when
  both values stay at 2 or more, because the plan then contradicts it.

The `lead` block records the session model: the model the operator started the session
with, on any host. The validator checks it for shape only: a nonempty model, a known tier,
and a known effort. A lead below strong, or a model the registry cannot place at its declared
tier, prints a warning and never fails the contract. A task-based contract caps the lead and every unit at high effort, the frontier peer included, while replay and calibration contracts keep their accepted efforts. The session lead owns acceptance. Unit
floors still fail closed, so judgment, review, and refutation stay at the strong tier. A review or refutation unit names both the unit it
validates and the role-independent relationship. Finalization also requires each planned
operative artifact to exist and contain evidence. Earlier contract versions retain their
original compatibility rules for replay only. Every newly authored substantive run uses
version 4; versions 1 through 3 are historical inputs, not new-run templates. Evidence:
`scripts/run-contract.mjs`.

A version 4 contract may carry an optional `calibration` block with exactly `arm` and
`track`. It exists for the pre-registered calibration arms (b) and (c). A valid block lets a unit
run at the lead tier, never above it. The validator requires arm `b` or `c`, track
`assess-only`, and a strong lead at high effort. It rejects the block when the lead model also serves the frontier rung, since that
arm cannot measure a strong-versus-frontier gap. Every unit must use read mode, and no unit artifact may fall inside any unit scope.
Earlier versions reject the key. Evidence: `scripts/run-contract.mjs`.

`scripts/route-unit.mjs` owns the unit kinds. Its `CONTRACT_KIND_OF` table maps each route kind
to the kind a contract records, and `run-contract.mjs` accepts exactly the values of that table:
`breadth`, `mechanical`, `execution`, `judgment`, `review`, and `refutation`. The three route
kinds `mechanical-read`, `mechanical-edit`, and `gate-run` record `mechanical`, and the route
kind `peer` records `judgment`. A unit with any other kind fails with `kind must be one of`
followed by the six kinds. When the kind is a route kind, the error adds `<kind> is a route kind,
so record <mapped>`. A version 4 unit may also carry an optional `size` of `S`, `M`, or `L`, and
an optional `roundBudget`, a positive safe integer. Earlier versions reject both keys. An invalid
value fails the contract. Each size defaults to the dispatch guard's `DEFAULT_BUDGET`, 40
rounds, in `SIZE_ROUND_BUDGET`. `SIZE_MEDIAN_ROUNDS` holds `null` for each size, because no unit
has recorded a size (MEASUREMENTS.md, P12-M1d). While a median is `null`, `budgetAdvisory`
returns nothing. Once a median exists, a `roundBudget` below the median for its `size` prints
the warning `Round budget <n> is below the measured median of <m> rounds for size <s>` and never
fails the contract. Evidence: `scripts/route-unit.mjs`, `scripts/run-contract.mjs`, and
`evals/run-contract/run.mjs`.

Security campaigns use a separate `ATTACK_CAMPAIGN.json` contract. It declares distinct
exploit families, launches, directed entry-to-sink hypotheses, direct inspection evidence,
independent validators, and `OPEN`, `BLOCKED`, `EXHAUSTED`, or `CLOSED` state. The compiler
rejects history, changelog, CVE-database, and patched-diff discovery shortcuts. A closed
chain must carry hash-bound execution and validator receipts, survive independent validation,
and prove the configured starting privilege to impact goal in a common deployment. Campaign
run evidence binds the contract's dispatch ledger, journal, and reported artifacts. Normal
checks admit in-progress planned units; `--final` requires strict all-unit reconciliation.
Its report reverse-indexes convergent guards,
primitives, and sinks, traces each collision to its terminal node, and ranks open chains for
out-of-band validation. This attack graph is not the run contract's same-wave write-scope
collision check. Evidence: `scripts/attack-chain-graph.mjs`.

## Snapshot receipt

`CONTEXT_SNAPSHOT.json` identifies one visible repository state. Its identifier covers Git
head, staged state, unstaged state, untracked-file policy, and generator digests. Ignored
content is excluded by policy. Snapshot preparation and replay reject `assume-unchanged`,
`skip-worktree`, and unresolved index states before hashing worktree bytes. Evidence:
`scripts/context-index-lib.mjs:72-115`, `scripts/context-index-lib.mjs:230-282`, and
`scripts/context-snapshot.mjs:108-170`.

The snapshot command can generate a delta only when it receives both a previous receipt and a delta output. A changed snapshot requires a new contract revision and affected bundles. Evidence: `scripts/context-snapshot.mjs:30-35`, `scripts/context-snapshot.mjs:123-170`, and `scripts/run-contract.mjs:57-65`.

## Context bundle

`CONTEXT_BUNDLE.json` binds one work unit to a version 2, 3, or 4 contract revision and snapshot identifier. It contains scoped repository-map entries, direct import relations, scoped visible changes, an optional snapshot delta, and Atlas material. Evidence: `scripts/context-bundle.mjs:41-75` and `scripts/context-bundle.mjs:108-149`.

The bundle never silently falls back to broad context. It writes `BROAD_CONTEXT_REQUIRED` for high-risk or oversized scope. It writes `BUDGET_EXCEEDED` when the rendered bundle exceeds `maxBundleBytes`. Evidence: `scripts/context-bundle.mjs:52-55` and `scripts/context-bundle.mjs:117-162`.

The share of the repository index one unit may hold defaults to 0.25. The optional contract field `context.maxScopeShare` moves that share anywhere above 0 and up to 1, and a raised share is a slice-design decision the lead records in the contract. The recursive-glob and risky-prefix triggers ignore it, so a security or migration scope still refuses. Evidence: `scripts/context-bundle.mjs:60-73` and `scripts/run-contract.mjs:103-107`.

Context bundles support v2, v3, and v4 contracts. A bundle still binds its run ID,
contract revision, work unit, snapshot, compiler digest, and bounded contents. Runtime
receipts reference a verified bundle by unit ID, bundle ID, path, and file digest.
Evidence: `scripts/context-bundle.mjs:44-54`, `scripts/context-bundle.mjs:160-214`, and
`scripts/run-runtime.mjs:177-183`.

`context-bundle.mjs view` first verifies the canonical bundle, then emits a smaller deterministic unit view. The default view preserves the bundle identity, contract and snapshot bindings, completeness markers, omissions, and dependency edges. It fails on a byte-budget breach and never truncates. `worker-brief.mjs build` then frames invariant files before unit files under separate prefix, unit, and total byte limits. Its receipt binds the compiler, every source, both sections, and the final payload. Both tools reject portable path aliases that could overwrite an input or collapse two outputs onto one physical target. `worker-brief.mjs verify` rejects source, compiler, receipt, or payload drift before dispatch. Evidence: `scripts/context-bundle.mjs` and `scripts/worker-brief.mjs`.

Worker views may select `rows`, `context`, or both with `--sections`. The contract's
`context.requiredViewSections` declares which sections the unit must retain. Without that
field, both sections remain required. `--require-sections` can add requirements but cannot
remove contract requirements. Every view retains canonical identity, binding, scope, and
completeness. A selected view records its selected, required, and omitted sections. Invalid
selection or byte overflow fails before replacing the output. Evidence:
`scripts/context-bundle.mjs` and `evals/context-bundle/run.mjs`.

## Task-based routing

Version 4 contracts may set `routingPolicy: "task-based"`. Each unit then supplies a
`routingRationale` explaining its role, model tier, and reasoning effort for the assigned work.
Role and work-kind floors remain binding. The lead does not derive a worker's tier by
subtracting one from its own tier. Legacy contracts retain their previous routing rules.

A frontier worker requires `peerException` with a permitted class, rationale, and stopping
criterion. The classes are architecture, refutation, mathematics, and synthesis. A run permits
at most one such peer. Its own quality criteria must include blocking acceptance owned by the
lead. Missing, unknown, or incompatible routing fields fail validation. Evidence:
`scripts/run-contract.mjs` and `evals/run-contract/run.mjs`.

## Attributed cost components

The cost estimator preserves numeric per-model subtotals and the existing attributed total.
Its `actualCost.componentsByModel` adds separate input, cache-read, cache-write, and output
charges. Components use unrounded arithmetic; display subtotals retain their existing rounding.
Missing usage or prices remain `UNKNOWN`. Reasoning is already part of output and receives no
second charge. These are attributed observations, not invoices or proof of savings. Evidence:
`scripts/estimate-run-cost.mjs` and `evals/estimate-run-cost/run.mjs`.

## Host capabilities and policy

`HOST_CAPABILITIES.json` has version, host, provider, model, source, observation time,
and five named capability states: `promptCaching`, `compaction`, `contextEditing`,
`hostMemory`, and `taskBudget`. State is one of `controllable`, `managed-observable`,
`managed-unobservable`, `unsupported`, or `unknown`. The source is `operator`,
`host-probe`, or `provider-docs`. Evidence: `scripts/runtime-lib.mjs:18-23` and
`scripts/runtime-lib.mjs:101-128`.

Each v3 runtime policy is `off`, `prefer`, `require`, or `require-observable`. `require`
accepts only controllable or host-managed states. `require-observable` excludes
managed-unobservable states. `prefer` records `durable-fallback` for unavailable or unknown
features, and `off` records `disabled`. Unsatisfied required policy fails contract validation.
Evidence: `scripts/runtime-lib.mjs:129-148` and `scripts/run-contract.mjs:60-72`.

## Stable prefix and runtime receipts

The stable prefix is an ordered list of regular stage-0 Git-index files. Compilation rejects
linked components and non-regular index modes before reading bytes. It frames each UTF-8
file in a deterministic payload and records its SHA-256 digest, byte count, and entries.
The payload must not exceed `maxStablePrefixBytes`. Evidence:
`scripts/context-index-lib.mjs:87-115` and `scripts/runtime-lib.mjs:149-173`.

`RUN_RUNTIME_RECEIPTS.jsonl` is an append-only hash chain. Every version-1 record has a
sequence, timestamp, predecessor digest, binding, references, optional observation, and
its own digest. The first record is `init`. Later records are `checkpoint`, `resume`,
`replan`, or `observation`. Replay rejects torn, blank, malformed, reordered, or
digest-invalid records. Evidence: `scripts/runtime-lib.mjs:25-39` and
`scripts/runtime-lib.mjs:307-337`.

The binding includes contract bytes, Git head, snapshot identity and receipt bytes, the host
descriptor digest, capability states and policy outcomes, and stable-prefix metadata. It
does not copy raw host, provider, model, source, or observation-time labels from the ignored
descriptor. Descriptor initialization rejects Git-visible paths and linked components before
writing. An unchanged contract revision must retain this complete binding. A replan keeps
the run ID and increments the revision by one. Git heads are complete 40- or 64-digit object
IDs. Capability and receipt paths must differ portably and cannot share one physical file.
Evidence: `scripts/runtime-lib.mjs:174-219` and `scripts/runtime-lib.mjs:331-346`.

A checkpoint requires a strict dispatch-ledger reference and may bind acceptance, handoff,
bundle, and artifact files by digest. Resume replays and revalidates the latest checkpoint
references. Verification rejects any binding or referenced-file drift. Evidence:
`scripts/run-runtime.mjs:159-169`, `scripts/run-runtime.mjs:200-217`, and
`scripts/run-runtime.mjs:253-329`.

Checkpoint, resume, replan, and verification accept a partial acceptance ledger when every recorded actor and criterion is valid. Finalization still requires every blocking criterion to pass. `run-runtime.mjs status` emits a bounded view of the latest checkpoint, pending dispatches, acceptance coverage, drift categories, read pointers, observed token totals, and per-unit overruns. It does not mutate the receipt chain.

## Cache telemetry

An observation records cache observability as `observed`, `unobservable`, or `unsupported`.
It may record `hit`, `miss`, or `write` events, a unit and model attribution, and cache-read, cache-write, input, output, and reasoning token counts. Reasoning is an output subset and is not added to output again. Unobservable and unsupported observations cannot carry cache events or
token metrics. Provider-usage observations must carry at least one metric. The metrics view
reports normalized totals and event counts plus the minimized capability binding. Raw host
provenance stays in the ignored descriptor. Elapsed time remains `UNKNOWN`. Evidence:
`scripts/runtime-lib.mjs:281-294`, `scripts/runtime-lib.mjs:349-383`, and
`scripts/run-runtime.mjs:293-317`.

## Session receipt hook

The `SessionEnd` hook `session-receipt.mjs` is on by default on hosts that expose a transcript
callback. Claude summarizes the main transcript and its `subagents/*.jsonl` siblings. Codex
reads peer rollouts and follows `session_meta.payload.parent_thread_id` to include descendants.
Installed Grok 1.0.13 reads cumulative per-prompt usage from the session's `updates.jsonl`;
its receipt records `arms.ladderCard=false` and `arms.handoffPickup=false`.
`arms.handoffCard` follows its switch, because PostToolUse delivers that note. `arms` also carries `handoffPickup` and `dispatchGuard`, each read
from its own switch the way every other arm is; `CODE_OPS_DISPATCH_GUARD=warn` records
`dispatchGuard=true`, because only the hard stop is lifted. Every receipt also
carries `handoff`, the highest band the session's handoff marker reached and whether the
transcript shows a `/code-ops-suite:handoff` call. Every receipt also carries `skills`, a
`{ "<skill id>": count }` object over the main thread and its subagents. It counts `Skill`
tool calls by `input.skill` and operator prompts that open with a namespaced
`<command-name>/plugin:skill</command-name>` tag. Ids take the colon form with any leading
slash removed, and a value that is not an id is dropped. A session with no invocation records
`{}`. A bare slash name such as `/clear` is not counted, because the transcript does not tell a
host built-in apart from a user skill. Codex and Grok rows run the same parser, but no Codex or
Grok skill-invocation shape is verified yet, so their `skills` count may stay `{}`. OpenCode has no transcript callback, so no
automatic receipt is claimed there. The hook writes nothing to stdout, exits `0` on bad input,
missing evidence, or an unwritable ledger, and finishes on a bounded timer. Its ledger path is
`$CODE_OPS_RECEIPTS`, else the host-specific home default. `off`, `0`, or `false` disables it.
Evidence: `plugins/code-ops-suite/hooks/session-receipt.mjs` and
`scripts/transcript-lib.mjs`.

`context-audit.mjs receipts` reads the ledger back and accepts only version `1` rows. `--by-arm` groups rows by the switches they ran under and prints per-session means, with pre-record rows as `unknown`. `receipts --purge-before <ISO date>` rewrites the ledger keeping only rows whose `ts` is at or later than the given date, and reports what it removed, so retention is one operator command and nothing purges on its own. Evidence: `scripts/context-audit.mjs:8-13`, `scripts/context-audit.mjs:77-90`, and `scripts/context-audit.mjs:93-132`.

The `PreCompact` hook `compact-snapshot.mjs` writes `COMPACT_SNAPSHOT.md` before the host compacts,
so the restore card below can name running work and reply-owed peers that a summary drops. The
host ignores plain stdout from `PreCompact`, so the hook prints nothing. It reads only `session_id`,
`transcript_path`, and `cwd` from the payload and writes nothing without a session id and a
transcript path. Grok sends both keys in snake case beside camel-case twins (2026-10-01 capture),
and the parser reads Grok's `chat_history.jsonl` and `updates.jsonl` shapes. The snapshot holds eight sections within a 12,000-character total: operator words
(4,800), running work (2,000), active items (3,600), peers (1,200), decisions (1,400), authority
grants (800), in-flight lines (600), and the next command (700). The last four come from tagged
lines in the run folder's `RUN_LOG.md`, so a compaction keeps what a handoff keeps. Its header
records the write time, the session, the `compact_boundary` count, a `Status` (`partial` names each
missing input: transcript, run folder, `TASKS.md`, or agent ledger), the run folder as `Run:`, and
the counts, which end with `decisions N, grants N, in flight N`. An older header without those
counts still parses. Running agents come
live from the agent ledger. A peer is reply-owed when its last message sits later in the
transcript than the lead's last `SendMessage` to it. Truncation stubs older operator messages
first, then cuts item lines, drops quiet peers, and cuts running-work descriptions. It never cuts
ids, report paths, reply-owed peers, authority grants, the next command, or the `Run:` path.
Decision text cuts to 600, 400, 280, 200, 140, and 100 characters, and then the oldest decisions
drop to a floor of 6. In-flight lines cut to 240, 160, and 120 characters, then drop to a floor of
2. A grant or the next command is capped at 600 characters at the source, with an omitted marker.

The tag lines are `Decision:`, `Grant:`, `In flight:`, and `Next:`. A tag starts a line, with an
optional bullet or bold markers, and the reader accepts CRLF. The reader keeps the last 1 MiB of the
log. A repeated decision, grant, or in-flight line keeps its first place. `In flight: none` clears
the in-flight lines above it, and the last `Next:` wins. Every line passes the same redaction pass
as the transcript text. `scripts/compact-snapshot.mjs` holds the one list of carried fields
(`CARRIED_FIELDS`, printed by `co snapshot --fields`): each handoff `Write` field, the snapshot
section that carries it, and its tag. The handoff skill cites that list, and the eval fails when a
handoff field has no entry.

The hook writes the file into the run folder only when `git check-ignore` reports that path as
ignored. Otherwise it writes `<home>/.claude/code-ops/snapshots/<key>/<session slug>.md`, where
`<home>` is `CODE_OPS_HOME` or the operating-system home and `<key>` is the slug of the repository
root. Readers try the repository-root key first and then the raw-`cwd` key an older build wrote. A
temporary file renamed over the target makes each write atomic. Every message passes through
`scripts/scan-redaction.mjs`: a fail-closed secret shape becomes `<REDACTED:secret-shape>`, a
warn-only shape (an email, an address, a long blob) stays, an unvouched message keeps only its
transcript line, and a mask that throws stubs every text. The hook exits `0` on bad JSON, a
missing transcript, or a failed write, so it never blocks compaction. `CODE_OPS_COMPACT_SNAPSHOT`
set to `off`, `0`, or `false` disables the hook and the `co handoff draft` use of the snapshot. It
does not gate the compact card. The registration carries a 30-second timeout.

A snapshot is `fresh` when the transcript's `compact_boundary` count equals the header's boundary
count plus one. The host can flush the boundary row after `SessionStart` runs, so the card also
counts the header's own number as fresh when the snapshot's `Written` time is at or after the
newest boundary's timestamp (a header of 0 with a count of 0 is fresh). The library form
`snapshotState(header, count)` stays strict, and the card passes the newest boundary time as a third
argument to opt in. Any other count, an unknown boundary time, a bad `Written` time, and any
unreadable header make it `stale`. `co
snapshot [--session <id>] [--transcript <file>] [--run <dir>] [--json] [--fields]` writes the same file on a
host where `PreCompact` does not fire (Codex) and for a manual rebuild. It needs `--session` or `--run`. The transcript
defaults to the host's default file for the session, and the run folder defaults to the one whose
`SESSION.json` names the session. A missing piece makes the header `partial`. `--json` prints the
result fields. `--fields` prints the carried-field list and exits `0` without writing. It exits `0` when written, `1` when the write fails, and `2` on a usage error.

`routing-card.mjs` handles `SessionStart` with `source=compact` and adds a post-compaction
instruction to restore decisions, constraints, evidence, blockers, open work, and exact identifiers
from durable state. Claude and Codex ignore plain `PreCompact` stdout, which is why the card, not
the hook, speaks to the session. The card prints these lines in order, and each step fails open to
its own omission:

- the restore instruction, then the session and run-folder line;
- `git: <branch> @ <short HEAD>, <N dirty path(s)|clean>`, omitted outside a repository or when the
  3,000 ms call fails;
- `Next:` with the latest `Next:` line from the last 16 KiB of `RUN_LOG.md`, at most 200
  characters;
- the open `TASKS.md` lines (the id and the first 80 characters of each, at most 12, with a
  shown-of-open count) when the snapshot is not fresh and a run folder is known;
- `Snapshot fresh (<words> operator words, <running> running, <items> items, <peers> reply-owed
  peers): <path>` with the rule that the snapshot outranks the summary on running work and peers,
  which replaces the open-item lines;
- `snapshot also holds: <N> decisions, <N> authority grants, <N> in-flight lines, the next command,
  run folder <path>` for a snapshot with the new counts;
- `Snapshot partial: missing <inputs>; rebuild that input from the run folder or run co snapshot
  --session <id>` when the snapshot's `Status` is `partial`;
- `Snapshot STALE: <path> predates an earlier compaction; verify its running work and peers`;
- `Snapshot absent: rebuild it with co snapshot --session <id>` when no snapshot exists and the
  payload has a session id;
- `active N/12 (last snapshot M)`, with ` GROWING` when N exceeds M and ` OVER CAP` when N exceeds
  12, where N counts the live unchecked `TASKS.md` lines;
- up to 4 `reply owed:` lines of at most 160 characters, which become the first 3 plus `N more
  reply-owed peers in the snapshot` when more than 4 are owed;
- `exact earlier detail: ...`, one line naming the MCP tool `transcript_recall` and `co recall
  search --session <full session id> --terms <words>`, printed only when `CODE_OPS_RECALL` is not
  `off`, `0`, or `false`, the payload has a session id, and its `transcript_path` names an existing
  file. It does not check for the recall index, because the detached PreCompact prebuild may not
  have landed and the first recall call builds it;
- the live pending-agents block from the agent ledger;
- up to 4 `peer: <program> · live session <name>` lines of at most 160 characters, one per live
  board session on this repository whose program differs from this session's, ending in
  ` · reply owed` when a fresh snapshot lists that peer as owed.

The standard card, on every source, adds one line: `compaction keeps what a handoff keeps: tag
RUN_LOG.md lines Decision:, Grant:, In flight:, Next: (co snapshot --fields)`.

The card looks for the snapshot in the run folder and then in the home copies. It skips a copy
whose header `Session` differs from the payload's and is not `unknown`. Host auto-compaction is the
default context relief on Claude and Codex (DEC-73), and this card carries the open items across
it. This is recovery after compaction, not a claim that a hook changed the summary. Grok ignores
passive `SessionStart` stdout and therefore gets no hook-injected restore card. OpenCode has no
`PreCompact` port and writes no snapshot. Its `experimental.session.compacting` handler pushes the
session run folder's unchecked `TASKS.md` lines (at most 12), its pending `DISPATCH_LEDGER.md` rows
(dispatched or redispatched, at most 8), the `RUN_LOG.md` tag lines (the newest 4 decisions, up to 12
grants, up to 4 in-flight lines, and the latest `Next:`, read by the same rules), and one snapshot line. That line names
`COMPACT_SNAPSHOT.md` when it exists and otherwise says to run `co snapshot`. A line holds at
most 200 characters, except a grant or the next command, which holds up to 600. Any failure pushes nothing. The run folder is the one whose `SESSION.json`
names the session. Whether OpenCode keeps the pushed context through its summary is UNVERIFIED.
Evidence: `scripts/opencode-lifecycle.js` (`compactionPush`), `evals/opencode-lifecycle/run.mjs`,
`plugins/code-ops-suite/hooks/hooks.json`, `plugins/code-ops-suite/hooks/compact-snapshot.mjs`,
`plugins/code-ops-suite/hooks/routing-card.mjs`, `scripts/compact-snapshot.mjs`, and the generated
host compatibility files.

## Routing card and traceless hooks

One bundled hook carries no environment switch at all, `enforce-traceless.mjs`. On Claude and
Codex, the `SessionStart` hook
`routing-card.mjs` prints a fixed card naming the standard routing table, tier and effort
rules, and context-economy defaults. It parses the start source so a compact resume receives
the restore instruction above. On Grok it emits nothing because passive hook stdout is ignored;
the paired instruction files carry the routing doctrine. Any error exits `0` silently.
Evidence: `plugins/code-ops-suite/hooks/routing-card.mjs` and
`evals/grok-build-compat/run.mjs`.

On a fresh session, a `source` of `startup` or `clear`, the same card appends one passive line. It
lists up to 3 pending handoffs, newest first. Each entry is the handoff's `Session:` name, or its
run folder name for a legacy handoff, followed by its repo-relative path. The line states that the
session is new work unless the operator resumes one, and it never directs a resume. Discovery
reads two bounded directory levels: the dated run folders under each `<repo>-docs/80 Runs/` beside
the repository root, and under the repository's own `80 Runs/`. A handoff counts as pending when
its run folder holds no `HANDOFF.consumed`, whatever that marker's body, and the `HANDOFF.md`
mtime falls inside 14 days. `CODE_OPS_HANDOFF_PICKUP` of `off`, `0`, or `false` drops the line and
leaves the rest of the card. A fresh session also gets the same `peer:` lines as the compact
card, with no reply-owed marker. When the payload carries `session_id`, every source also gets
`this session: <first 8 characters>`. Every read is guarded, so an unreadable directory yields no
line rather than an error. The OpenCode lifecycle plugin emits the same passive line. Evidence:
`plugins/code-ops-suite/hooks/routing-card.mjs:29-150`, `scripts/opencode-lifecycle.js:168-213`,
and `evals/handoff-card/run.mjs`.

The card always names `co brief <agent>` for a brief template. When a real host payload arrives
on a host other than Claude Code, it adds `operator shell: <shell> (<platform>)`, derived from
`process.platform`; `CODE_OPS_OPERATOR_SHELL` replaces the derived shell. On `win32` it adds one
line telling the lead to write a multi-line script to a file and never to nest quotes in
`node -e` inside bash. An empty payload, as the OpenCode build uses, gets neither line, so the
baked OpenCode card does not depend on the build machine. Claude Code is detected by
`CLAUDECODE=1`. Evidence: `plugins/code-ops-suite/hooks/routing-card.mjs:109-151` and
`evals/handoff-card/run.mjs`.

A compact resume never gets the pickup line. It gets the restore instruction, and it then reads
the session record at
`<home>/.claude/code-ops/sessions/<projectSlug(cwd)>/<projectSlug(session id)>.json`. When the
record holds a valid name and run folder, the card adds one line. That line names the session and
its run folder, and it forbids resuming the handoff the session already resumed or any earlier
one. It then directs a reload of `TASKS.md` and `RUN_LOG.md` from the run folder. When the record
is absent, unreadable, or holds a control character, the card instead adds that a handoff resumed
earlier in the session stays consumed and must never be resumed again.

The `PreToolUse` hook `enforce-traceless.mjs` is the tool-layer backstop for the
traceless-publishing rule. When the Bash command about to run matches a `git commit` or a `gh
pr create|merge`, it runs the bundled `scan-ai-tells.mjs --command`. That mode scans the raw
command string and, on separate lines, each message, trailer, title, and body argument value
the command would publish, including heredoc bodies. Any scanner exit other than `0` makes the
hook exit `2`, which blocks the call. A scanner that cannot spawn fails open at exit `0`. The
fail-closed backstop is the `Traceless publishing (PR commits, title, body)` step in
`.github/workflows/validate.yml`, which scans every pull request's commits, title, and body.
The match tolerates a `git -C <dir>` or `git --flag=val` prefix ahead of the subcommand.
Evidence: `plugins/code-ops-suite/hooks/enforce-traceless.mjs:1-23`.

The same hook enforces the branch-name rule in `scripts/branch-name.mjs`. A branch name fails
when its first segment is an AI tool name (`AI_PREFIXES` at `scripts/branch-name.mjs:35`) or
its last token is a generated mix of six or more letters and digits
(`branchNameProblems` at `scripts/branch-name.mjs:48`). The hook checks the branch a command
creates, renames, commits on, pushes, or opens a pull request from
(`commandBranchViolations` at `scripts/branch-name.mjs:183`) and exits `2` on a problem. The
tracked `.githooks/pre-commit` checks the current branch, and `.githooks/pre-push` checks each
pushed branch, so a host without the tool hook is covered. The fail-closed backstop is the
same CI step, which checks the pull request head ref passed through the environment
(`.github/workflows/validate.yml:89`). The rule has no off switch.

## Local judgment gate

`local-review-gate.mjs` creates an ignored review plan for a clean non-default feature
branch. The plan binds `baseSha`, `headSha`, `diffSha256`, sorted `changedPaths`, its
receipt path, and the exact gate set: `local-deep-review` and `local-opsec-gate`. The base
must be an ancestor of head, and an empty diff is rejected. Evidence:
`scripts/context-index-lib.mjs:72-84`, `scripts/local-review-gate.mjs:84-182`, and
`scripts/local-review-gate.mjs:353-379`.

Each ignored JSONL receipt has a sequence, gate, verdict, timestamp, reviewer and model
label, tier, effort, plan digest, report reference, finding counts, predecessor digest,
and receipt digest. `PASS` requires zero blocking findings. A replay rejects report drift,
duplicate gates, foreign plans, missing final newlines, oversized chains, and invalid
sequence or predecessor links. A complete check requires exactly one passing receipt per
gate from a distinct reviewer identity. Authority files must not use linked components or
physical aliases, and ignored authority outputs must not portably alias tracked Git paths.
Physical identity uses lossless device and inode values on every host.
Evidence: `scripts/local-review-gate.mjs:36-44`,
`scripts/context-index-lib.mjs:60-84`, `scripts/local-review-gate.mjs:190-265`, and
`scripts/local-review-gate.mjs:380-432`.

The gate fails when a tracked or untracked worktree change, ambiguous Git index flag, branch
change, advanced base, changed head or diff, report drift, or receipt drift invalidates its plan. Prepare a new
plan after boundary drift. Reviewer and model fields are attestations. Their format is
validated, but the receipt chain does not provide hardware-backed identity. Evidence:
`scripts/local-review-gate.mjs:158-182` and `scripts/local-review-gate.mjs:190-265`.

`publish` is optional. After a passing local check, it can post one GitHub commit status
per receipt to the reviewed SHA. It verifies that SHA is remotely available. The caller
needs GitHub write authority for the status endpoint. A status is supplementary evidence, so
publication failure does not alter the local pass or fail result. Evidence:
`scripts/local-review-gate.mjs:270-340` and `scripts/local-review-gate.mjs:437-464`.

## Judgment evals

`judgment-evals.mjs` plans provider-neutral local workers in `trend` or `floor` mode. It
binds the tracked matrix, fixture tree, answer key, relevant skill documents, selected
models, declared execution availability, and ignored findings paths to a lead-only plan.
Worker units omit answer-key paths. Planning and replay reject ambiguous Git index flags
before workers read fixtures. Floor mode rejects identical normalized model IDs. The
deterministic scorer binds each findings file, execution policy, and score output into a
receipt. Ignored plan, findings, and receipt paths reject linked components and portable
aliases to tracked Git paths. A score output
must not portably or physically alias the plan or any findings file. Evidence:
`scripts/judgment-evals.mjs:24-31`, `scripts/judgment-evals.mjs:53-187`, and
`scripts/judgment-evals.mjs:189-325`.

The matrix declares the fixture-to-answer-key and fixture-to-skill mapping. Its current
fixtures cover bug, leak, documentation-drift, normalization, and trap-focused review
work. Evidence: `evals/judgment-matrix.json:1-52`.

A fixture may also declare `arms`, a list of model tiers. `register` mode compiles one unit
per declared tier for that fixture, same skill and same answer key, so the tier is the only
thing that varies between the resulting registers. Each unit names its tier in the id the
score receipt is keyed by. The mode requires two distinct model IDs and at least one fixture
declaring arms. Trend and floor expansions are untouched. Evidence:
`scripts/judgment-evals.mjs:100-112`, `scripts/judgment-evals.mjs:152-161`, and
`scripts/judgment-evals.mjs:278-280`.

Hosted CI keeps deterministic validation. `validate.yml` runs the structural gate and
regression evals, including the local-review and judgment-orchestration fixture evals.
Provider action examples remain compatibility paths, not a substitute for local model
judgment. Evidence: `.github/workflows/validate.yml:23-67` and
`.github/workflows/validate.yml:147-159`.

## Acceptance and result

`ACCEPTANCE.md` is an append-only table. Every row names a quality criterion, attempt number, verdict, proof, actor, and reason. Evidence: `scripts/run-contract.mjs:24`, `scripts/run-contract.mjs:188-205`, and `scripts/run-contract.mjs:218-224`.

Finalization requires every planned dispatch to be reported and every blocking criterion to have a latest `PASS` verdict. It writes a `RUN_RESULT.json` receipt only after those checks pass. Evidence: `scripts/run-contract.mjs:217-223`.

## Compatibility

Version 1 contracts remain valid without `context` or `runtime`. Version 2 contracts
remain valid with `context` and without `runtime`. Version 3 requires both `context` and
`runtime`. Context bundles accept v2 and v3. The long-horizon runtime accepts v3 only.
Do not add context or runtime fields to a v1 contract, or runtime to a v2 contract.
Evidence: `scripts/run-contract.mjs:75-89`, `scripts/context-bundle.mjs:44-54`, and
`scripts/run-runtime.mjs:86-93`.

The local judgment gate is independent of Run Contract versions. It stores ignored review
plans and receipts rather than extending v1, v2, or v3 contracts. Evidence:
`scripts/local-review-gate.mjs:49-54` and `scripts/local-review-gate.mjs:244-464`.

## Output digest

`digest.mjs` spawns the command after `--` directly, with no shell, and captures stdout and
stderr apart. The child's exit code becomes the digest's exit code on every path, including a
signal kill. A missing `--` exits 2 with usage. An executable that cannot spawn exits 127 and
names itself. Evidence: `scripts/cli-lib.mjs:244`, `scripts/digest.mjs:83-104`, `scripts/digest.mjs:147-150`, and
`scripts/digest.mjs:157-158`.

`--cwd <dir>` names the directory the command runs in, so a caller that would otherwise write
`cd <dir> && <cmd>` keeps the no-shell contract. That directory becomes the working directory
for the spawn, the Windows shim lookup, the in-repository frame test the stack shape applies,
the default store slug, and the `cwd` field of the receipt row. Without the flag it is the
digest's own working directory, so every default path is unchanged. A `--cwd` naming no
directory exits `2` with usage. Evidence: `scripts/digest.mjs:135-142` and
`scripts/digest.mjs:147-148`.

One shape is chosen per invocation. The detectors run in a fixed order, and the command tokens
bias only the cases the detectors leave open. Nine shapes exist: `json`, `diff`, `test`,
`diagnostics`, `stack`, `log`, `table`, `listing`, and `plain`. `plain` is the fallback, and it
passes output through under a line cap rather than filtering it. Evidence:
`scripts/digest-lib.mjs:458-509`, `scripts/digest-lib.mjs:511`, and
`scripts/digest-lib.mjs:541-557`.

The must-keep contract is fixed before any stage runs. `mustKeep(shape, raw, digested)` requires
every raw line matching `error`, `fail`, `failed`, `failure`, `exception`, `panic`, `fatal`,
`traceback`, `cannot`, `not found`, `denied`, or `refused`, plus the final non-blank line. A
`test` digest also keeps every failing test name and the summary. A `diff` digest keeps every
`diff --git` and `@@` header. A `diagnostics` digest keeps at least one line per file that had a
diagnostic, and states the totals. Past 200 matching lines the digest keeps the first 200 and
states the total. Comparison allows for a fold count appended to a line and for truncation to the
first `--line` characters. `digestText` enforces the same set by construction, so no stage may
drop or rewrite a protected line. Evidence: `scripts/digest-lib.mjs:43-48`,
`scripts/digest-lib.mjs:564-590`, `scripts/digest-lib.mjs:597-634`, and
`scripts/digest-lib.mjs:640-680`.

Every elided region prints `[elided N lines: sed -n 'A,Bp' <raw path>]`, or `[elided N lines]`
under `--no-store`. The ranges ascend, never overlap, and never cover a kept line. An output of
at most `--passthrough-below` bytes (default 1536), or one whose digest plus trailer would not be
smaller than the raw bytes, is printed raw on its own streams with no trailer, no raw file, and no
receipt row. `--passthrough-below 0` turns both rules off, and `--json` always carries every
field. Otherwise the final
printed line is always the trailer
`[exit <code> · <shape> · <rawLines> lines → <outLines> · raw <path> · sha256:<first 12>]`, with
`raw -` when nothing was stored. A stderr digest offsets its line numbers past the stdout section,
so its recovery hints address the raw file. Evidence: `scripts/digest-lib.mjs:135-141`,
`scripts/digest.mjs:178-186`, and `scripts/digest.mjs:170-176`.

Raw bytes go to `--store`, else `$CODE_OPS_DIGEST_DIR`, else
`~/.claude/code-ops/digest/<project slug of cwd>/`, at `<store>/<ISO date>/<HHMMSS>-<sha8>.txt`.
`--no-store` or `CODE_OPS_DIGEST_STORE=off` outranks all three and stores nothing. The default is a home-directory path, so a raw output is never inside a repository. Store writes
fail open: an unwritable store prints the digest with `raw -` and keeps going. Evidence:
`scripts/digest.mjs:100-129`.

## Digest rewrite hook

`digest-rewrite.mjs` is a `PreToolUse` command stage that turns an allowlisted simple shell
command into a digest run. It is on by default. The hook does nothing when `CODE_OPS_DIGEST` holds `off`,
`0`, or `false`, compared without regard to case, and exits `0` before the payload is read in
that case. An unset variable and every other value leave it on. A user or a repository turns it off through
the canonical `.claude/settings.json` environment; rendered hosts use their documented process
environment. Installed Grok 1.0.13 accepts the same `hookSpecificOutput.updatedInput` shape.
Evidence:
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:161` and
`plugins/code-ops-suite/hooks/hooks.json:5-16`.

The simple-command contract decides every rewrite. The command runs at most 2000 characters.
One leading `cd <dir> && ` may appear, and it becomes `--cwd <dir>` rather than a shell. What
follows it carries no `|`, `&`, `;`, `<`, `>`, backtick, `$`, or newline in any position, so no
pipe, list, redirect, subshell, expansion, or heredoc survives. Every token is bare or one
double-quoted string holding none of `"`, `$`, backtick, backslash, or newline. The first token
names a family in the allowlist, under that family's subcommand rule, and a `gh` call carrying
`--json`, `--jq`, or `--template` is refused because structured output is read by a parser
rather than a person. A `cd` directory token carries no backslash either, because the hook hands
it to `--cwd` as a path where a shell would have read an escape. Evidence:
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:46-82`,
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:90-129`, and
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:132-154`.

A command that already runs the digest passes through, so no output is wrapped twice. The
script path resolves from the hook's own location, and a missing script passes through as well.
Every pass-through prints nothing at all. Evidence:
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:149-150` and
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:172-176`.

The hook states no permission decision. It returns `updatedInput` carrying the rewritten command
beside the rest of the tool input, plus one line of `additionalContext` naming where the raw
output lives. The installed host reassigns the tool input to the hook's `updatedInput` and only
then runs its permission evaluation, so the operator's own rules judge the rewritten command as
they judge any other `node` call. That moves the permission key: a rule written for `git`, `gh`,
or `sed` no longer matches the wrapped form, and a broad `node` allow rule admits it. The host
accepts a wildcard anywhere in a Bash rule, so an operator mirrors a read-only allow rule for the
wrapped form by pinning the script name and the family, as in `Bash(node "*/scripts/digest.mjs"
-- git diff *)`, never as a bare `node` rule. An operator who keeps command-specific deny or ask
rules mirrors them the same way before opting in.
With `CODE_OPS_DIGEST_STORE=off` the rewrite adds `--no-store`, so the digest keeps its
compression and its contract but writes no raw file and no receipt row. The default store slug
follows the directory the digest process started in, never a `--cwd` target. Version `2.1.257` of the host bundle under
`~/.local/share/claude/versions/` carries `case"hookUpdatedInput":Ie=Cn.updatedInput;break;` at
byte offset `188975121` and `await xPe($e,e,Ie,o,d,p,n)` at `188978021`, and the function that
call reaches returns `{decision:await d(n,r,o,p,y),input:r}` for a hook that decided nothing, at
offset `187458088`. Version `2.1.251` reassigns the same way at offset `186659765`. Because the
host re-evaluates, no `ask` is needed to put the rewritten command in front of the operator, and
the hook never returns `allow`. Evidence:
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:178-190` and
`evals/digest-hook/run.mjs:186-189`.

The hook fails open on every path. Bad JSON, a missing command, another tool, or any thrown
error exits `0` with no output. It never exits `2`, never blocks a call, and never spawns or
imports beyond three Node built-ins, because it runs in front of every Bash call. Evidence:
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:160-192`.

## Script entrypoint

`co <domain> <verb> [args...]` resolves one verb to one sibling script through a static
table and hands it every remaining argument unchanged. A subcommand-driven verb declares
the subcommand to insert when the caller supplied none, so `co atlas check --atlas <dir>`
reaches `atlas-check.mjs check`, and an explicit subcommand passes through. The entrypoint
exits 2 on an unknown domain, an unknown verb, or a verb whose script the running plugin
does not vendor. `--help` and `--version` exit 0. Every other exit code, and all stdout and
stderr, belong to the wrapped script. The direct `node scripts/<name>.mjs` paths stay valid
and unchanged. Evidence: `scripts/co.mjs:20-22`, `scripts/co.mjs:163-183`, and
`scripts/co.mjs:186-196`.

The `scan` domain runs on the shared CLI library, and the skills reach its scripts as
`co scan <verb>`. Its seven scripts hand `argv` to `parseFlags` in `cli-lib.mjs`. A caller
error goes through `parseOrDie`, which prints `x <message>` on stderr and exits 2. A flag rule
declares `many` for a repeatable flag and `raw` for a flag whose own check must see a smuggled
option. The `missing` key carries the wording a caller already pins, so no flag, exit code, or
message changed. Evidence: `scripts/cli-lib.mjs:38-47`, `scripts/cli-lib.mjs:112-123`,
`scripts/check-autofix-scope.mjs:50-57`, and `evals/co-facade/run.mjs:101-117`.

A script that passes a usage line to `parseOrDie`, or calls `exitOnHelp`, answers `--help` or
`-h` with its usage on stdout and exit 0, before any other work. `check-no-deps`,
`lint-plugins`, and `records` do the same inline, so a help request never runs a gate.
Evidence: `scripts/cli-lib.mjs:138-155` and `evals/script-guards/run.mjs`.

## File skim

`skim.mjs <file>` prints one header line and an outline, so a reader can request a line
range instead of a whole file. The header carries the path, line count, byte count, and
kind. Outline mode prints structure only: Markdown headings with flat section spans, code
definitions with import and export rows, top-level JSON keys with array lengths, the first
record's keys for JSONL, and a preview with section markers for unstructured text. Every
printed name is truncated to 80 characters. An outline longer than `--max` ends with a
`+N more` line, so truncation is never silent. `--range A,B` prints those lines with
line-number gutters and nothing else, clamped to the file, with `B` defaulting to `A+40`.
A binary file prints its header and `binary`. Exit 1 covers a missing or unreadable file
and a binary file under `--range`. Exit 2 covers a bad invocation. Evidence:
`scripts/skim.mjs:11-20`, `scripts/skim.mjs:91-99`, and `scripts/skim.mjs:213-230`.

## Over-build scanner

`scan-overbuild.mjs --git <range>` reads one diff and the tree at its head through git, never
the working tree, and reports eight deterministic tells: a burst of small new files, an
interface with one implementor, a function that forwards its own parameters to one call, a
package-manifest entry with no decision record in the same diff, a new test file over twice
its siblings' median, a root config key no file reads, an exported name another file already
exports, and three consecutive comment lines shaped like code. Only the unrecorded dependency
blocks: it exits 1 unless `--report-only`, and every other tell is advisory. `--exclude
<prefix>` drops derived copies from the diff and the tree lookups, and a byte-identical vendored
copy never counts as a duplicate because it shares the blob. The header states the ceiling: the
tells are line-shaped heuristics, a hit is a lead, and a clean run proves nothing. Evidence:
`scripts/scan-overbuild.mjs:11-32`, `scripts/scan-overbuild.mjs:81`,
`scripts/scan-overbuild.mjs:248`, `scripts/scan-overbuild.mjs:303`, and
`scripts/scan-overbuild.mjs:344`.

`evals/overbuild-garden` scores the scanner the way `hasty-code` scores a skill, with a recall
bar of 0.9 over eleven planted over-builds and a zero-decoy bar over nine legitimate shapes: a
sized extraction with two callers, an interface with two implementors, a neighbor-sized test, a
recorded dependency, a read config key, two wrappers that add behavior, and prose comments. The
run builds a throwaway repository from `repo/base` and `repo/change`, asserts no unkeyed hit, and
proves the eval can fail by removing the new-file bound in a temp copy. Evidence:
`evals/overbuild-garden/run.mjs:16-25` and `evals/overbuild-garden/ANSWER_KEY.json:5`.

## Deferral harvest

`harvest-deferrals.mjs` collects every `deferred(<ceiling>, <upgrade path>)` marker in a comment
line of a tracked text file into `DEFERRALS_REGISTER.md`, in the item grammar that
`revalidate-register.mjs` re-greps: id, `File: path:line`, a backticked `Anchor:` that is the
marker text as written, `Ceiling:`, `Upgrade:`, and `Verified-at:`. In Markdown and HTML only an
HTML comment counts, because a heading or a bold line starts the same way, and a ceiling that
starts with `<` is the template, not a marker. The id is derived from the file path and the
ceiling text, so it survives a line move and changes only when the marker moves file or changes
ceiling. `--check` re-harvests and exits 1 when the register on disk disagrees, ignoring
`Verified-at`. The default output lands in `<hub>/98 System/` when exactly one docs hub exists.
Evidence: `scripts/harvest-deferrals.mjs:63-65`, `scripts/harvest-deferrals.mjs:88-94`, and
`scripts/harvest-deferrals.mjs:127`.

## Ladder card hook

`hooks/ladder-card.mjs` runs at `SubagentStart` on Claude and Codex and prints the code-economy ladder as
`hookSpecificOutput.additionalContext` for an implementer-class agent type only. It is on by
default. It does nothing when `CODE_OPS_LADDER_CARD` is `off`, `0`, or `false`, set in the
canonical environment; rendered hosts use their documented process environment. The Claude
host contract was read from the
installed 2.1.257 bundle: the input carries `agent_id` and `agent_type` (offset 183160743, built
at 190336771), the output schema accepts `additionalContext` (183169362), and the host appends
that context to the subagent's own messages (188311119). A read-only type, bare or
plugin-qualified, and any type ending in `explorer` or `reviewer`, gets nothing. The card is at
most ten lines. Bad JSON, a missing type, or another event name exits 0 with no output, and the
hook returns no permission decision. On installed Grok 1.0.13 it emits nothing because passive
`SubagentStart` stdout is ignored; `CLAUDE.md` and `AGENTS.md` carry the same ladder doctrine.
OpenCode has no typed subagent-start callback. Evidence: `plugins/code-ops-suite/hooks/ladder-card.mjs:12-22`,
`plugins/code-ops-suite/hooks/ladder-card.mjs:43-58`, and `evals/ladder-card/run.mjs:3-14`.

## Subagent report hook

`hooks/subagent-report.mjs` runs at `SubagentStop` and checks a suite subagent's final report
against that agent's `## Contract` block. The first non-empty line must start with a token from
the `Verdicts:` line, and the report must fit the body's `Report cap: at most N words` line. A
miss prints one `systemMessage` note, which the host shows to the operator. The hook is on by
default and does nothing when `CODE_OPS_SUBAGENT_REPORT` is `off`, `0`, or `false`.

The hook is advisory. It never returns `decision`, `continue`, or `additionalContext`, so it
cannot keep a subagent running. Only a plugin-qualified type whose agent file resolves is
checked; a bare or custom type gets nothing. The Claude host contract was read from the
installed 2.1.276 bundle: the input carries `agent_id`, `agent_type`, `agent_transcript_path`,
and `last_assistant_message` (offset 203499373). When `last_assistant_message` is absent, the
hook reads the last assistant text from `agent_transcript_path`. Bad JSON, a missing field, an
unreadable file, or another event name exits 0 with no output. The Grok and OpenCode
`SubagentStop` contracts are UNVERIFIED, so the hook is silent under the Grok adapter and
OpenCode has no port. Evidence: `plugins/code-ops-suite/hooks/subagent-report.mjs:1-25` and
`evals/subagent-report/run.mjs:3-14`.

## Handoff card hook

`hooks/handoff-card.mjs` runs at `UserPromptSubmit` on Claude and Codex and, SPECULATIVE pending
calibration, nudges the operator and the lead once resident context crosses 150,000 tokens and
again every further 150,000-token band. It is on by default. It does nothing when
`CODE_OPS_HANDOFF_CARD` is `off`, `0`, or `false`, set in the canonical environment; rendered
hosts use their documented process environment. The change feed and the history read notice
run in the same process under their own switches, `CODE_OPS_FEED` and `CODE_OPS_READ_NOTICE`. The Claude host contract
was confirmed against `docs.claude.com/en/docs/claude-code/hooks-guide`: `UserPromptSubmit`
fires once per prompt, before Claude processes it, with no matcher support, carrying
`session_id` and `transcript_path` on stdin alongside every other common hook field. Output
carries `systemMessage` (shown to the operator, a top-level field common to most events) and
`hookSpecificOutput.additionalContext` (added to the model's context), which the hook sets to
the same text. The hook never returns `permissionDecision` and never exits 2, because that exit
code blocks and erases the prompt on this event; a nudge is advisory only. Evidence:
`plugins/code-ops-suite/hooks/handoff-card.mjs:1-38` and
`plugins/code-ops-suite/hooks/hooks.json`.

The context metric is the last assistant turn's usage record — input plus cache-read plus
cache-creation tokens — read from only the last 256 KiB of the transcript, never the whole file,
reusing `normalizeUsage`, `handoffMarkerPath`, and `handoffPeakBand` from
`scripts/transcript-lib.mjs` for the token math and the storage-path convention. A compaction
marker newer than that record makes the metric unknown until the next turn records usage. A small
per-session marker at `<host home>/code-ops/handoff/<project slug>/<session id>.json` records the
band already nudged (`band = floor(context / 150000)`) and `peak`, the highest band the session
ever reached; the hook nudges again only on a higher band, and re-arms (sets the band to 0, never
the peak) once context falls back under 150,000, which a compaction typically causes. The session
receipt reads the peak. Evidence: `plugins/code-ops-suite/hooks/handoff-card.mjs:62-110` and
`scripts/transcript-lib.mjs:572-588`.

Codex documents an equivalent `UserPromptSubmit` event (OpenAI's `developers.openai.com/codex/hooks`,
confirmed live at `learn.chatgpt.com/docs/hooks`) carrying `session_id` and `prompt` on stdin,
with the same `hookSpecificOutput.additionalContext` output contract this plugin already uses
for its other Codex-projected hooks; its documented event-specific field list does not include
`transcript_path`, so a Codex payload that omits it degrades silently to no nudge, the same as a
missing transcript file. Installed Grok discards UserPromptSubmit stdout. On `PostToolUse` the
same script reads `updates.jsonl` and emits `additionalContext` when `GROK_PLUGIN_ROOT` is set.
That covers the TUI, headless `grok -p`, and the ACP agent. `CLAUDE.md` and `AGENTS.md` still
carry the compact rule, because a turn with no tool call never fires `PostToolUse`. OpenCode does
not run this hook. `scripts/opencode-lifecycle.js` delivers the note from `message.updated`
usage. Its band text asks for `/code-ops-suite-handoff assess` to choose CONTINUE or COMPACT and
names host auto-compaction as the context relief. Evidence: `code-ops-docs/50 Platform/INFRASTRUCTURE.md` (host projections table) and
`plugins/code-ops-suite/hooks/handoff-card.mjs`.

Each band is an advisory reminder, not a host limit, restart threshold, delivery
receipt, or cost proof. On Grok the host compacts near 184,000 tokens, at 72 percent of the
256,000-token window, before the 200,000-token price line. Band 1 checkpoints and waits for
that compact. It does not ask the operator to type `/compact`. The next tool result after the
compact names the newest compaction segment. A higher band, or a session that already
compacted, says to start a new session pointed at that segment. On Claude and Codex (DEC-73) the card names host auto-compaction as the context relief
and asks the lead to checkpoint, not to assess. Band 1 says: "Host auto-compaction is the relief,
so no handoff is needed. At the next safe boundary, checkpoint: keep TASKS.md current and append tagged
lines to RUN_LOG.md: `Decision:` (id, choice, rejected options), `Grant:` (operator authority, verbatim),
`In flight:` (file:line, done or partial), and `Next:` (the step in flight and its next command)."
The Grok band 1 and already-compacted notes name the same four tags.
It ends with "The PreCompact snapshot keeps operator words, running work, and peers." on Claude, or
"Then run `co snapshot`, because the Codex PreCompact hook does not fire." on Codex. The hook has
no Codex signal, so Claude is `CLAUDECODE=1` or `CLAUDE_PROJECT_DIR` set and any other non-Grok host
reads as Codex. Band 2 and above says: "Finish the step in flight and checkpoint as above. If the
host has not compacted, ask the operator to run /compact. Hand off only for new work or a clean
session that loads updated code-ops plugins." DEC-76 sets that handoff rule. It never says to hand off on a token count.
On Claude, when `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is unset, the card adds one line naming that
setting (250000 recommended); a Codex or Grok card never carries it.
At or above the dispatch guard's context ceiling, the note adds that new dispatches stay gated:
on Claude and Codex until the lead runs `/code-ops-suite:handoff assess`, and on Grok until the
operator runs `/compact` or `/code-ops-suite:handoff assess`. The OpenCode note says "New dispatches are now gated until you run
/code-ops-suite-handoff assess." Every host carries the sentence, because the guard also gates Grok's
`spawn_subagent`. A typed `/code-ops-suite:handoff` prompt on Claude or Codex expands without a `Skill` call,
so this hook records the ceiling assessment for it.
The marker proves only that the hook wrote a prior message. It does not prove that the host
displayed it, that a boundary existed, or that any action was chosen. Evidence:
`plugins/code-ops-suite/hooks/handoff-card.mjs:12-13`.

The price line exists on Grok only, at 200,000 tokens. Claude and Codex have none (DEC-73),
because host auto-compaction is their context relief. The first time Grok context reaches the
line, the card fires even without a band rise. That firing means the host compact did not run,
and the card says to checkpoint and run `/compact`. A session that has already compacted is
told to start a new session pointed at the newest compaction segment.
The marker also records `point`, `fired`, `prompts` (operator prompts since the last card), and
`until`. When a Grok card fires past the line after an earlier card and no operator prompt has
arrived since, the card says to checkpoint and stop new work so the operator can run `/compact`.
It does not say to write a handoff for the token count. A typed prompt past the line is blocked
until `/compact`, a handoff command, or a live `Continue-until:` bound. `/compact`, the handoff
command, and a Grok `PreCompact` record the ceiling assessment. That record unlocks dispatch and
later prompts for the current band. The next 150,000-token band blocks again. The hook reads the
latest `Continue-until: <N> tokens` or `Continue-until: <N> turns` line from the last 64 KiB of
the run log named by the session record's `runDir`. It does so on Grok only. While that bound is
open, the card stays quiet and a typed prompt is allowed. It fires once when context reaches N tokens or after N more hook
calls. A malformed bound sets no bound. Claude and Codex ignore the line. On those hosts an
autonomous session with no prompts sees no card until the dispatch guard's 300,000-token ceiling
gates it. Only Grok has a size-based price line; the OpenCode note names none. Evidence:
`plugins/code-ops-suite/hooks/handoff-card.mjs` and `evals/handoff-card/run.mjs`.

The hook fails open on every path: bad JSON, another event name, a missing `session_id` or
`transcript_path`, a missing or unreadable transcript file, a tail window with no assistant
usage, or any thrown error exits 0 with no output. Evidence: `evals/handoff-card/run.mjs`.

The history read notice runs in the same process, so no hook process is added. On `PostToolUse`
of Read, Grep, or a shell tool, the hook imports `scripts/legacy-paths-lib.mjs` lazily and only for
those tools. It finds the hub (the one top-level directory that holds
`98 System/DOCS_MANIFEST.json`), reads at most 2 MiB of `<hub>/98 System/Records/state.json`, and
matches the opened path against each decision or amendment record whose status is `amended`,
`superseded`, or `historical`. A Read or Grep path is resolved against the working directory. A shell
command matches when its text names a record path. A hit adds one `additionalContext` line, up to
three per call, naming the record, its status, the records that share its decision key and still
stand, and `<hub>/20 Decisions/REGISTER.md`. `state.json` carries no `supersededBy` or `amends`
field, so the shared key stands in for the replacement link. Evidence, reports, and summaries carry
no rule and get no notice. A path the hook cannot extract, an unreadable or malformed
`state.json`, or a missing hub gets nothing. `CODE_OPS_READ_NOTICE` of `off`, `0`, or `false`
turns it off, and neither the card switch nor the feed switch does. Evidence:
`scripts/legacy-paths-lib.mjs`, `plugins/code-ops-suite/hooks/handoff-card.mjs`, and
`evals/handoff-card/run.mjs`.

## Handoff write and consumption

`check-handoff.mjs <HANDOFF.md> [--root <repo>] [--strict-anchors] [--consume]` is the structural
floor under the handoff skill's write contract. Twelve headings are required, matched by prefix:
Program, Goal and state of play, Scope and constraints, Work completed, Key findings, In-flight boundaries,
Open items, Registers and artifacts, Decisions made, Traps and dead ends, Authority, and Carried
context. Goal through Open items answer what an operator asks a resumed session: what was worked on, what
was found, what is in progress, what is left, and what the scope and constraints are. Order is
documentation only; presence gates. Evidence: `scripts/check-handoff.mjs:146-159`.

Four other checks fail closed. "Goal and state of play" must carry a non-empty `Request:` line
holding the operator's original request verbatim. Every top-level bullet under "Key findings" must
carry a confidence label of `CONFIRMED`, `PROBABLE`, or `SPECULATIVE`. The file must stay at or
under 8 KB, because detail belongs in the run-folder files the handoff points at. Every Open items
bullet needs `Owner:` and `Done when:`, must not open with an imperative verb, and every
`path:line · Anchor:` pointer must resolve against the working tree. Exit `0` is conformant, `1`
lists violations on stderr, and `2` is a usage error. Evidence: `scripts/check-handoff.mjs:13-57`
and `evals/handoff-check/run.mjs`.

The program lineage check also fails closed. `## Program` carries `Program: <path>` and
`Predecessor: <path | none>`. The Program path resolves to a `PROGRAM.md` of at most 32 KB with
Program goal, Request history, Scope documents, Decisions ledger, and Closed items. Every
scope-document path exists, and the handoff's own request sits in Request history. Every Open
items bullet carries a stable id such as `OI-7`. With a predecessor, its request sits in Request
history, and each of its open-item ids stays open or appears in Closed items. A dropped id fails
by name. `## Program` may also carry `Session: <base name> HO <n>`, the name the successor session
takes, and `Hop: <n>`. A handoff without both lines is legacy and passes. When either is present,
both must be: Hop is a positive integer, and the Session line ends with ` HO <Hop>`.

Ledger grammar 2 applies only to a `PROGRAM.md` with a `Grammar: 2` line, so grammar-1 chains stay
resumable. The ledger then also needs `## Open items`, whose bullets lead with an id and carry
`Owner:` and `Done when:`. `PROGRAM.archive.md` beside the ledger counts toward Request history,
Closed items, and decision ids whenever it exists. These checks fail closed:

- 11: every Decisions ledger bullet leads with `DEC-<n>` and carries `Hop: <n>` and
  `Disposition: pending|local|dropped|promoted:<id>`. A decision that carries
  `Agreed-with: <slug>` warns, never fails, when `programs/<slug>/PROGRAM.md` is missing,
  unreadable, or holds no decision with `Agreed-with: <this slug>` and the same decision text.
- 12: a decision's Hop is its writing session's hop, which is the handoff's `Hop:` minus one. A
  decision older than that must not stay `pending`. A grammar-2 handoff must carry `Hop:`.
- 13: every DEC id in the predecessor's Decisions made is in the ledger, the archive, or a
  `Was: <program>/<id>` trail.
- 15: every Decisions made and Open items bullet leads with its id. A decision adds one clause at
  most: no ` · ` field, no `Rejected:`, and no second sentence or semicolon.
- Check 4 reads `Owner:` and `Done when:` for a carried open item, shown as id and title only, from
  the ledger's Open items. A carried id absent from the ledger fails.
- 16: an Open items `Pointer:` without a delimited `Anchor:` fails, in the handoff and the ledger.
  Under grammar 1 it only warns.
- 17: an open item whose `Owner:` or `Done when:` differs from the predecessor's line carries
  `Revised: hop <n>` on its handoff or ledger line. When the predecessor carries the item as id
  and title only, the baseline is the nearest ancestor handoff with the full line. With no such
  ancestor on disk, the check skips the item.
- 18: no `DEC` or `OI` id leads two bullets across the ledger and its archive.
- 19: Check 19 enforces program convergence. A PROGRAM.md whose `## Finish line` section holds at least one `- F<n>` bullet fails a handoff that lists more than 12 open items, an open item without `Blocks: F<n>`, or a Blocks id absent from the Finish line. A `## Finish line` with no `- F<n>` bullet fails on its own. Without a Finish line, more than 12 open items warns. A carried item shown as id and title reads its Blocks from its ledger line when that line leads with the id (grammar 2); Blocks reads up to the next ` · `. On a chained handoff, a predecessor item listed in `BACKLOG.md` beside PROGRAM.md (bullets leading `- OI-<n>`) passes the carry-forward check and prints `deferred: <ids> (moved to BACKLOG.md)`, and the check prints `burn-down: active N (predecessor M, +a -r), backlog B`, with ` GROWING` when N exceeds M. `co handoff resume` repeats the burn-down line before `Blocked on operator:` and prints `unchanged 5+ hops: <ids|none>` when the chain holds five or more handoffs.

Check 14, promotion resolution, is not implemented yet. Evidence: `scripts/check-handoff.mjs` and
`evals/handoff-check/run.mjs`.

`co handoff draft` also lists each unchecked row of a `PLAN.md` as an Open items bullet whose `Owner:`
and `Done when:` are `[FILL:` placeholders. It reads `PLAN.md` from the run folder, the `PROGRAM.md`
folder, and each Scope document named `PLAN.md`, and skips an id the list already names. Rows past
the 8 KB cap become one `[FILL: N more PLAN.md open row(s) ...]` line. A program with no readable
`PLAN.md` gets one `[FILL: no PLAN.md was read ...]` line naming the paths it tried.

On a grammar-2 ledger, `co handoff draft` fills each open item's `Anchor:` from its cited line, or
writes `[FILL: verbatim text from the cited line]` when the pointer has no line. It shows a carried
item as id and title and keeps an active item's full line. With `--out`, it writes each active line
back to the ledger's Open items by id. It lists each pending decision older than the writing
session's hop as `- [FILL: disposition] <decision title>`. `--program <PROGRAM.md>` names the ledger
for a hop without a predecessor, so that hop also gets scope digests. Resume seeds `TASKS.md` with
the ledger line for each carried item. `co program archive <PROGRAM.md | slug>` refuses a ledger
without `Grammar: 2`. It moves every Closed items bullet, every decision with a settled
disposition, and each Request history entry except the first and the last ten, verbatim, to
`PROGRAM.archive.md` (DEC-32). The archive holds only those three headings. A pending decision
stays in the ledger. The command exits 1 when the ledger is still over 32 KB. Evidence:
`scripts/handoff-state.mjs` and `evals/handoff-state/run.mjs`.

`co handoff draft` reads the agent ledger for the drafting session and refuses with exit 1 while any
agent is still `dispatched`. It prints `<agent_id> <agent_type> <age> <description>` for each agent
and names three ways out: wait, settle a lost one with `co agents settle <id> --failed --reason <text>`,
or pass `--pending-agents-ok`. With the flag, draft writes each agent
as a `Pending agent:` line under In-flight boundaries. It matches the session id, the SESSION.json
`sessionId`, and `hostSessionId`. When none is known, it matches by the repository root and says so.
`CODE_OPS_AGENT_LEDGER=off|0|false` skips the check. After a compaction, the SessionStart routing
card adds a `Pending agents: (<shown> of <total> shown)` block for the payload `session_id`, at most
8 lines of 80 characters. The block fails open and honours the same switch. Evidence:
`scripts/handoff-state.mjs`, `plugins/code-ops-suite/hooks/routing-card.mjs`,
`evals/handoff-state/run.mjs`, and `evals/handoff-card/run.mjs`.

`co handoff draft` also reads the compaction snapshot: the run folder's `COMPACT_SNAPSHOT.md`, else
the home copies, else reply-owed peers built from the session transcript with no write (the running
list is then empty). When any peer is owed, draft prints to stderr `warning: N peer message(s)
still await a reply, and a new session cannot answer a message sent to this one (from <source>):`,
one indented line per peer, and a closing line that tells the lead to answer each peer before the
handoff or name it in the handoff text. The draft goes on. The warning never refuses the draft and
never changes its exit code. The pending-agent refusal above is separate. Under `## In-flight
boundaries`, draft also seeds up to 8 `- Running work (snapshot): ...` lines, one for each shell,
workflow, or wakeup entry, each cut to 160 characters with `[FILL:` rewritten to `[fill:`. Past 8 it
adds `- +N more running work entries in the snapshot.` `CODE_OPS_COMPACT_SNAPSHOT=off|0|false` skips
both the warning and the seeding. Evidence: `scripts/handoff-state.mjs` and
`scripts/compact-snapshot.mjs`.

The pending list merges two sources on every host: the hook rows in the agent ledger and the
`dispatched` rows of the run's `DISPATCH_LEDGER.md`, deduplicated on agent id and actor id. Each
entry names its source (`hook` or `dispatch`), and `co agents pending` prints the sources it read on
stderr. A missing file is an empty source, never `unknown`. A dispatch row carries no launch time,
so its age is a floor taken from the ledger file. `co agents settle <id> --failed --reason <text>
[--session <id>] [--run <dir>]` appends a `failed` row with the reason; the reason is required, and
an unknown id exits non-zero. A settled agent leaves the pending list. At `SessionEnd`,
`session-receipt.mjs` appends one `ended` marker to the session's agent ledger file, when one
exists, whether or not a transcript exists and whatever `CODE_OPS_RECEIPTS` holds. It records the
pending count and ids in its receipt row. The SessionStart `startup` card lists workers left pending
only by sessions that carry an `ended` marker, so a concurrent live session in the same directory is
never reported. A resumed session that launches again after its marker reads as live until it ends
again. `CODE_OPS_AGENT_LEDGER_CAPTURE=1`
writes the key paths of each distinct payload shape per host, never a value, to
`payload-keys.ndjson` in the ledger directory, before the Grok early return. A `dispatched` row also
carries `unit`, `requestedTier`, `requestedEffort`, `appliedModel`, `appliedEffort`, `effortSource`
(`workflow` or `frontmatter`), and `flag` (`ok`, `under`, or `over`). The first three come from the
brief's `Unit:`, `Tier:`, and `Effort:` lines, read with the dispatch guard's label rule. The applied
model is the dispatch `model` override, else the agent frontmatter `model:`. The applied effort is the
dispatch `effort` option, else the frontmatter `effort:`. An absent field records `null`, and a row
stores no brief text beyond those three values. `attemptOf(rows, unit)` derives a unit's attempt from
its failed and redispatched rows. `routingSummary(rows)` returns the starvation and overuse
advisories and the `Routing:` line; both are advisory and never a failure, and the premium ceiling
defaults to 25% of judgment dispatches. A Grok `SubagentStop` carries camelCase `subagentId` and
`subagentType` and no `agent_id`; the ledger maps them, so the hook records a Grok stop and still
records no Grok launch. Evidence: `scripts/agent-ledger.mjs`, `plugins/code-ops-suite/hooks/agent-ledger.mjs`,
`plugins/code-ops-suite/hooks/session-receipt.mjs`, and `evals/agent-ledger/run.mjs`.

`co burndown [--program <slug>] [--run <dir>] [--root <dir>] [--json]` prints one read-only line,
`active N/12, backlog B, closed C`, with the missing `Blocks` count when the ledger has a finish
line, ` OVER CAP` above 12, and ` GROWING` when N exceeds the predecessor handoff's open count. A
`Grammar: 2` ledger's Open items win over the latest run folder's `TASKS.md`. It writes nothing and
exits 2 only on a usage error. Evidence: `scripts/burndown.mjs` and `evals/burndown/run.mjs`.

One status line never gates. `co handoff draft` records each dirty path with a sha256 prefix:
`- Dirty: \`<porcelain line>\` · sha256:<16 hex>`, or `· none` for a path since deleted. The check
reads `git status --porcelain --untracked-files=all`, excluding the handoff file and the
`SCOPE_DIGESTS.md` beside it. When the `Verified-at:` sha is HEAD and every recorded path's hash
still matches, the check prints `same-tree: Verified-at matches HEAD and the dirty paths the
handoff recorded` on stderr. The recorded set is the draft's `Dirty:` lines plus its count of
unlisted derived paths; a dirty record without hashes never reports same-tree, a record truncated
with `+N more` never matches, and a handoff with no record still needs a clean tree. Derived paths
match by count only, because the draft does not list or hash them. A derived file edited after the
draft, such as a vendored copy, still reports same-tree when the count is unchanged. The resume
direction then accepts each FRESH anchor without re-reading its file. Register revalidation still
runs, because closed register items can drift. Any git failure leaves the line unprinted, which
only costs the successor the slow path.
Evidence: `scripts/check-handoff.mjs` and `evals/handoff-check/run.mjs`.

`co handoff draft` also writes `SCOPE_DIGESTS.md` beside the `--out` file, only when `--out` is
given and the Program ledger resolves: per `PROGRAM.md` scope document, a sha256 of its
working-tree bytes, `Verified-at:`, and a digest paragraph. An entry whose hash matches the
predecessor's keeps its digest; any other entry gets `[FILL: digest]`. Resume refuses while a
`[FILL: digest]` remains, then reports each document `unchanged`, `changed`, or `missing`. A
handoff without the file resumes as before. Evidence:
`scripts/handoff-state.mjs` and `evals/handoff-state/run.mjs`.

`--consume` writes `HANDOFF.consumed` beside the file only after every check above passes. Its
body is the version 2 JSON `{"v":2,"consumedAt","bySession","successorRun","name"}`. `bySession`
comes from `--session`, else `CLAUDE_CODE_SESSION_ID`, else `CODEX_SESSION_ID`, else null.
`successorRun` and `name` come from `--successor` and `--name`, else null. Readers still accept the
legacy body of one ISO timestamp line, and the file's existence alone means consumed. The resume
direction writes it once verification finishes, so a marker means a session read and verified
that state. The `SessionStart` routing card treats the marker's presence as already picked up,
which retires the handoff from discovery. A failed check writes nothing, and a marker that cannot
be written is reported rather than swallowed, because the caller asked for it. Evidence:
`scripts/check-handoff.mjs` and `evals/handoff-check/run.mjs`.

One run folder belongs to one session. `co run open <slug> [--name <name>] [--session <id>]`
creates `<hub>/80 Runs/<YYYY-MM-DD>-<slug>/`, suffixed `-2` or `-3` when taken, with `SESSION.json`
(`{"v":1,"sessionId","name","hop","predecessor","createdAt"}`), a header-only `TASKS.md`, and
`RUN_LOG.md`. With a session id, it also writes the session record at
`<home>/.claude/code-ops/sessions/<project slug>/<session slug>.json`, with body
`{"v":1,"sessionId","name","runDir","resumed","hop","updatedAt"}` and repo-relative paths. The id
source order matches the consumed marker's. Without an id, the record is skipped. `CODE_OPS_HOME`
replaces the home directory. `co handoff draft` takes the predecessor from the run's `SESSION.json`
before its sibling heuristic, fills `Session:` and `Hop:` (the predecessor's Hop plus 1, or 1), and
refuses an `--out` folder that holds `HANDOFF.consumed` or whose `SESSION.json` names another
session. `co handoff resume` also accepts a session name, matched case-insensitively against the
`Session:` lines of unconsumed handoffs. No match or several list the candidates and exit 1. A
passing resume creates the successor run `<date>-<program slug>-ho<n>`, seeds its `TASKS.md` with
the open items verbatim, writes its `SESSION.json` and the session record, and names it in the
marker. `co handoff live <name | path | session id>` walks the marker successor links to the
chain head. It prints the head's session name, id, and run folder, and marks the head as awaiting
resume when that run already wrote an unconsumed `HANDOFF.md`. Evidence: `scripts/handoff-state.mjs`
and `evals/handoff-state/run.mjs`.

Run retention classes. `co run open <slug> [--retention evidence|working] [--skill <skill>]` records the class in `SESSION.json` as `retention` and in the run index. An explicit `--retention` wins. Otherwise `--skill` picks the default from `RETENTION_BY_SKILL`: `ship`, `feature-implementation`, and `remediation` open `working`, research, audit, calibration, and review skills open `evidence`, and an unmapped or absent skill opens `evidence`. `co run retention <run dir> evidence|working` sets a class. Any agent may raise a run to `evidence`. Lowering to `working` needs `--operator`, which is operator-only, and without it the command refuses. `co run retention-check` is the citation gate: it fails a `working` run that a tracked file outside `80 Runs/` cites, unless the citation targets that run's `CLOSEOUT.md`. The error names the run and the citing `file:line`, and gives the fix: raise the run to `evidence` or retarget the citation. It passes when no run folder exists, and CI runs it in `validate.yml`. Evidence: `scripts/handoff-state.mjs` and `evals/handoff-state/run.mjs`.

Program overlap (C6). `co run open <slug> --program <PROGRAM.md>` and `co handoff resume` compare
the program's Scope documents paths with every other live program on the presence board. They
print a `program overlap:` block before `links:`. It holds one warning line per shared path,
naming the other program and its live head. Two or more shared paths add a `co program merge`
suggestion. The check never blocks or changes an exit code. It skips a corrupt board or a missing
ledger silently. `CODE_OPS_PEER_GUARD=off` disables it. Evidence: `scripts/handoff-state.mjs`
and `evals/handoff-state/run.mjs`.

## Dispatch guard hook

`hooks/dispatch-guard.mjs` runs at `PreToolUse` with no matcher, so it sees every tool call, and
carries worker enforcement and dispatch advice under one registration. It reads `agent_id`, `cwd`, `tool_name`, and
`tool_input.model`, `tool_input.subagent_type`, `tool_input.prompt`, `tool_input.script`,
`tool_input.skill`, `session_id`, and `transcript_path` from the payload. It is on
by default. `CODE_OPS_DISPATCH_GUARD` of `off`, `0`, or `false` disables the whole hook, and `warn`
keeps every advisory while turning each deny into an advisory, except a deny for a malformed or
unavailable controller binding. `CODE_OPS_ROUND_BUDGET` overrides the 40-round
default and takes a positive integer only. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs` and
`plugins/code-ops-suite/hooks/hooks.json`.

Inside a subagent, which the host marks by an `agent_id` the main thread never carries, the hook
counts that subagent's attempted tool calls, including denied attempts. With no explicit binding,
the budget is the `Round budget:` line of the subagent's brief, read once from the first entry of
its own transcript and cached, clamped to 120, else `CODE_OPS_ROUND_BUDGET` or 40. At that budget
and every further 20 calls, the hook returns one `hookSpecificOutput.additionalContext` line. The
line names the call where the hard stop lands. It tells the operative to write a checkpoint now to
the brief's Report path, or to the run folder. The operative then finishes the unit and keeps the
checkpoint current if it can finish before the hard stop. Otherwise it starts no new edit, finishes
or reverts the partial edit, and returns. The controller-bound warning keeps the older order:
consistent state first, then checkpoint, replan, and return, because its allowance is two calls.
The checkpoint lists done items with file:line evidence, each dirty
path marked complete or partial, the exact next edit, and each gate run with its result. At 1.5
times the budget, rounded down and at least one call past the budget, the hook returns `permissionDecision: deny`, forbids further edits, and requires the
same checkpoint in the final report.
New state keys hash the working directory and exact
agent ID. Legacy counters remain readable and are retained during migration. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs`.

`register --agent-id <id> --budget <calls> [--allowance <calls>]` binds an exact controller-known
identity from the worker's working directory. It never infers correlation from timing, role, or
the lead's dispatch prompt. The allowance defaults to two, ranges from one to four, and cannot
extend the unregistered stop. The bound budget also stays inside that stop, so the hook warns at
the smaller of the registered budget and the unregistered stop less the allowance. When the
registered budget exceeds that limit under the controller's `CODE_OPS_ROUND_BUDGET`, `register`
prints a `dispatch-guard CAPPED` line on stderr and still exits 0. The bound warning names the
registered budget beside the effective one. Conflicting or invalid registrations cannot enlarge the allowance.
A malformed explicit binding or unavailable bound counter denies further calls, including in warning mode. Registration storage failures return nonzero UNAVAILABLE. Receipt counts remain UNKNOWN when counter storage cannot be read as a regular file.

`receipt --agent-id <id>` reports allowlisted control measurements and binding health. It emits
no raw identity, path, prompt, or command. Model requests and token usage remain `UNKNOWN` when
unobserved. This receipt is not a provider usage record. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs` and `evals/dispatch-guard/run.mjs`.

On the main thread the hook acts only on a dispatch tool: `Agent`, the older `Task`, or
`Workflow`. Three gates can deny there, and `warn` turns each deny into an advisory. The wide-type
gate denies a `subagent_type` of `general-purpose`, `claude`, or `fork`, or no type at all,
unless the prompt carries a line starting `Wide-surface reason:` with the reason on it. It checks each `agent(` call
of a `Workflow` script on its own and denies, on the same terms, a call with no `agentType` or a
wide literal one. The denial names how many calls failed and the first one's position. The same
gate denies a literal `effort` of `xhigh` or `max` in any call, with no reason escape. A call
whose options it cannot read, such as a variable or a spread, gets an advisory. A script it cannot
parse falls back to the script-wide test: an `agent(` call and no `agentType` anywhere.

The brief-contract gate reads the target agent's own contract. A `subagent_type` of the form
`<plugin>:<agent>` resolves when the plugin is `code-ops-suite`, `rigor`,
`privacy-opsec-suite`, or `researcher`. The file is `agents/<agent>.md` in that sibling plugin.
In the repo the sibling is `../<plugin>/` beside the hook's plugin root. In the installed cache
it is `../../<plugin>/<version>/`, and the highest all-numeric version directory wins. When
the `## Contract` section of that file has a `Brief requires:` line, the gate denies a
dispatch whose prompt lacks any listed field and names each missing field. A field is present
when a line starts with its label, case-insensitive, and a colon follows the label on that
line. Only whitespace, one list marker (`-`, `*`, or `1.`), and `**` or `__` may precede the
label. Optional `**` or `__` markers and a parenthetical qualifier may sit between the label
and the colon, as in `Scope (edit authority):`. A markdown heading line that starts with the
label also counts. A label mid-line, as in `Out of scope:`, does not count. When this denial
names Round budget, the separate Round budget advisory is dropped. A bare, unknown, or
non-suite type passes, and so does an unreadable file or an agent with no `Brief requires:`
line in its Contract. The subagent-report hook resolves agent files with the same shared
module, `hooks/agent-file.mjs`. The gate does not read `Workflow` scripts.

The routing gate runs on an `Agent` or `Task` dispatch of an agent whose `Brief requires:` line
lists `Tier`. Every other agent keeps the gates above and nothing more. The brief carries `Unit:`,
`Tier:` (`light`, `mid`, `strong`, `premium`, or `frontier`), `Effort:` (`low`, `medium`, or `high`),
`Route basis: <kind>; surface=<s>; ambiguity=<a>; reversible=<yes|no>`, and an optional
`Route override: <reason>`. The gate derives two inputs itself. It derives the surface from the
paths on the `Scope:` block with `surfaceOfScope`, and the attempt from the agent ledger with
`attemptOf` for the `Unit:` key. A `Scope:` block ends at the next blank line or any `Label:` line
(a drive letter such as `C:/` is no label). After an empty `Scope:` colon it skips blank lines and
reads the bullets that follow, up to the next label. A path drops a trailing line anchor (`:120-180`,
`#L120`), and the surface patterns ignore case. The gate also raises the declared kind to the
agent's minimum (`AGENT_MIN_KIND` in `scripts/route-unit.mjs`): `reviewer` and `privacy-reviewer`
route as `review`, `verifier` as `refutation`, and `tracer` as `judgment`. The gate denies each of
these, and `warn` turns each into an advisory:

- A `model` override that ranks below the agent's floor. The floor is the model its frontmatter
  declares, which lint holds at `AGENT_MODEL_FLOORS`. The override `sonnet` ranks mid, so it fails
  a strong floor on `reviewer`.
- A `Tier` that disagrees with the effective rung. `premium` needs `model:"opus"`, `frontier`
  needs `model:"fable"`, and `strong` needs no override or one at strong. An override that matches
  `Tier` passes silently.
- A `Route basis` surface that differs from the surface the `Scope:` paths derive. No `Route override:`
  line clears this denial. A declared surface that is not a surface is denied as malformed.
- A `Tier` or `Effort` below `routeUnit` of the basis with the derived surface and the derived
  attempt. A `Route override:` line clears the ambiguity and attempt triggers (7b, 7c) and the
  table rows. It never clears a surface trigger (7a review on a surface, 7d public-contract
  judgment at high ambiguity).
- A brief `Effort` above the effort the dispatch runs at. That is the Agent call's own `effort`
  (CLI 2.1.292 and later), else the agent's frontmatter effort. The denial points to the
  Agent `effort` input or to Workflow `agent({ agentType, model, effort })`. An Agent `effort` that
  is not low, medium, or high is denied.
- A literal `xhigh` or `max` brief `Effort`.
- A second frontier dispatch in the session, counted from `dispatched` ledger rows that asked for
  frontier or applied a frontier model. A Workflow script counts its literal frontier `model` calls
  with those rows, and more than one in total is denied.

The advisories are a `Tier` above the routed rung, a declared kind raised to the agent's minimum, a
`model` override the gate cannot rank (it leaves `Tier` unchecked), a brief `Effort` below the
effort the dispatch runs at, and a Workflow `model` or `effort` that is not a literal string. A readable Workflow
script that makes two or more `agent()` calls, or any call the guard cannot read, earns one more advisory
when it has no script-wide `Run contract: <path>` line (bare or in a comment) or when that path, resolved
against the session directory, is missing or is not JSON with a non-empty `runId`. The note also gives the
call count against a guideline of 10 and how many calls set no effort. It never denies, and a script the
guard cannot parse skips it. A Workflow `agent()` call
whose literal `model` ranks below the floor of its literal `agentType` is denied. A `spawn_subagent`
or `spawn_agent` input with a literal `xhigh` or `max` effort is denied. The `spawn_agent` tool
is covered by name. That `PreToolUse` fires for it on Codex is PROBABLE: the Codex hooks
documentation matches it under the alias `Agent`, and `DISPATCH_TOOLS` holds both names. A live
capture showed that `PostToolUse` does not fire for it. The gate loads
`scripts/route-unit.mjs` and `scripts/agent-ledger.mjs` lazily and only for a routed dispatch or a
Workflow `model`. A missing library, a ledger error, or any internal error skips these checks and
passes. Evidence: `plugins/code-ops-suite/hooks/dispatch-guard.mjs` (`routeChecks`, `reviewWorkflow`)
and `evals/dispatch-guard/run.mjs`.

The context-ceiling gate reads the lead's
resident context from the transcript tail. At or above the ceiling it denies a new dispatch until
the session records a handoff assessment for the current band. The first band starts at the
ceiling, and each further 150,000 tokens starts a new band that gates again.
`CODE_OPS_CONTEXT_CEILING` of `off`, `0`, or `false` disables this gate, and an integer of at
least 150,000 replaces the 300,000 default. A main-thread `Skill` tool call that loads
`code-ops-suite:handoff` records the band current at that call, and the handoff card records a typed
`/code-ops-suite:handoff` prompt. `assessed --session <id> --band <n>`, run from the project root, records it on a host without a skill tool. The marker lives at
`<sha256 cwd>/<sha256 session id>.assessed.json` in the dispatch store. Unreadable context, a
missing transcript, or an unsafe session id fails open. The
marker only rises, so a stale write never re-locks an unlocked band. The hook also adds one
advisory clause for a brief whose prompt names no Round budget. A `model` override earns no
blanket advisory. Every deny and advisory for one dispatch lands in one output. It never
denies any other main-thread tool call. Absent or malformed host payloads preserve the legacy
no-op behavior.
Explicit controller bindings have separate validation and conflict handling. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs` and `evals/dispatch-guard/run.mjs`.

The collision note is a fifth behavior. On every thread, for an edit tool or a shell `git pull`,
`git merge`, `git rebase`, or `git push`, the hook imports `scripts/collision-lib.mjs` lazily and
adds warn-only `additionalContext`. It names live board peers that claimed the path or edited it
within 6 hours. For a git command, it names live peers on the same branch that edited this
session's dirty files. It warns once per path per peer per session. A subagent keeps its own
set, under `<home>/.claude/code-ops/collision/<repo key>/`. The note never denies. Beside a deny,
the hook drops it unspent, so it shows on a later call. Any failure passes with no note. The off
switch is `CODE_OPS_PEER_GUARD`, the board's switch, or `CODE_OPS_DISPATCH_GUARD=off`. Evidence:
`scripts/collision-lib.mjs`, `plugins/code-ops-suite/hooks/dispatch-guard.mjs`, and
`evals/collision/run.mjs`.

The collision note also covers surfaces that two programs declare as shared. A PROGRAM.md may
carry a `## Peers` section of lines in the form `- <slug | *> · Surfaces: <path or glob>,
process:<name> · Notify: edit|merge`. The hook discovers peers and never reads a configured list.
A peer is a live board session on this repository whose program differs from this session's. Its
run folder resolves to the live head of its handoff chain, so a predecessor and its successor are
one peer. A surface counts when this program declares it for the peer's slug or `*`, or the peer
declares it for this program's slug or `*`. The note fires for an edit to a declared path under
`Notify: edit`, for a `git merge` or `git push` whose diff touches one under either level, and for
a `taskkill`, `pkill`, `kill`, or `Stop-Process` command that names a declared `process:` surface.
It needs no recent peer edit. It names the peer's program and live session and gives a ready
message line. A malformed line is ignored, and every failure passes with no note. Evidence:
`scripts/collision-lib.mjs` (`parsePeers`, `discoverPeers`) and `evals/peer-surfaces/run.mjs`.

The legacy path deny is a sixth behavior. On every thread, for an edit tool, the hook imports
`scripts/legacy-paths-lib.mjs` lazily and denies an edit whose target lies under a `removed` legacy
path of the version 3 documentation manifest. The reason names the removed root and, when
`<hub>/98 System/FORWARDING.json` maps it, the new location. The library finds the hub without a
git spawn, reads at most 2 MiB per file, and fails open on any error, an unparsable manifest, a
manifest of another version, or a missing hub. A denied subagent call still counts as a round, and
its round advisory joins the denial. `warn` turns the deny into advisory context. The off switch is
`CODE_OPS_LEGACY_PATHS`, or `CODE_OPS_DISPATCH_GUARD=off`. Evidence: `scripts/legacy-paths-lib.mjs`,
`plugins/code-ops-suite/hooks/dispatch-guard.mjs`, and `evals/dispatch-guard/run.mjs`.

The derived path deny is part of the same behavior. An edit under a `derived` legacy path, a
generated tree such as `opencode-dist/`, is denied the same way, and the reason names the entry's
`generator` command. The library uses the manifest's `derived` entries when it lists any. A
manifest that is missing, oversize, corrupt, of an unknown shape, or lists no `derived` entry
falls back to a built-in list (`.agents/`, `codex-marketplace/`, and
`opencode-dist/`), so a broken manifest never opens the generated trees. A fallback entry
applies only where its generator script exists, so an adopting repository keeps its own
hand-authored `.agents/` tree. A repository with no hub is never denied. `scripts/docs-manifest.mjs` does not yet validate or
accept the `derived` disposition, so no real manifest can declare one and the fallback is the live
path today. That validation is a tracked follow-up. Evidence: `scripts/legacy-paths-lib.mjs`
(`legacyDenial`, `DERIVED_FALLBACK`) and `evals/dispatch-guard/run.mjs`.

The subagent git guard is a seventh behavior. Inside a subagent only (`agent_id` present, or Grok's
`subagentType`), for a shell tool, the hook denies a command with any `&&`, `&`, `||`, `;`, `|`, or
newline segment (a backslash line continuation joins first) that runs `git checkout`, `switch`, `reset`,
`restore`, `clean`, `merge`, `rebase`, `pull`, `cherry-pick`, `am`, or `stash` with any subcommand but
`list` or `show`, or any git verb with `--autostash`. Those verbs rewrite the working tree or index that
the lead and parallel operatives share. A verb with `--help` or `-h`, and `git clean` with `-n` or
`--dry-run`, are read-only and pass. The parse is string work only: it strips grouping characters and
quotes from word edges, skips shell keywords, `NAME=value` words, and global options (including
`--config-env`), and it spawns and imports nothing. The main thread is untouched. A denied call still
counts as a round, and its round advisory joins the denial. `warn` turns the deny into advisory
context. The off switch is `CODE_OPS_SUBAGENT_GIT`, or `CODE_OPS_DISPATCH_GUARD=off`. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs` (`rewritingGitVerb`) and `evals/dispatch-guard/run.mjs`.

Every output that denies or advises appends one decision row to `guard-decisions.jsonl`. The file
sits beside the session-receipt ledger: in the directory of `CODE_OPS_RECEIPTS` when it names a
path, else in `~/.claude/code-ops/`. A row is one JSON line holding ids and counts only, never
brief text, script text, or paths: `v` (1), `ts`, `sessionId` (null when the host id is not a
safe token), `tool`, `subagent`, `decision` (`deny` or `advisory`), `gates`, and `ledger`.
`gates` lists each gate id whose message phrase appears in the output, in table order, or
`other` when none does. `ledger` lists the contract-rule ids those gates back. A `Workflow` row
adds `workflow` with the `calls` count, the `unreadable` count, and `contract`, which is true when the script
carries a `Run contract:` line. The `workflow-contract` gate id marks the contract advisory. `CODE_OPS_RECEIPTS=off` stops the
rows, and a write error fails open: the decision still reaches the host unchanged. The dispatch-guard
eval fires every gate id in the table and fails when a message no longer matches its phrase.
Evidence: `plugins/code-ops-suite/hooks/dispatch-guard.mjs` (`GATES`, `decisionRow`) and
`evals/dispatch-guard/run.mjs`.

The guard's wide-type deny, brief-contract deny, context-ceiling gate, and round stop are the enforcement layer.
The routing card, the dispatch ledger, and the narration scan are advisories only. Lint
separately requires every bundled agent body to carry a `Report cap: at most N words` line.
Evidence: `scripts/lint-plugins.mjs` and `scripts/scan-narration.mjs`.

On OpenCode, `scripts/opencode-lifecycle.js` denies a dispatch to a model the operator has not
enabled. A model is usable only when four conditions hold. The live host model list names it. The
profile's enabled list names it. The desktop Models settings do not hide it. The config's
`disabled_providers` does not name its provider, and `enabled_providers`, when set, does. An empty
provider list counts as unset. The check fails closed in this order: the live list, one awaited
refresh, then the environment catalog and the model cache filtered by the last three conditions.
When no source yields the model, a lead clone falls back to the lead model only if the lead meets
all four conditions and the agent floor. Otherwise the dispatch throws. The check runs whatever
`CODE_OPS_TIER_ROUTING` says and ignores `CODE_OPS_DISPATCH_GUARD=warn`. The startup chooser ladder
filters by the same provider switches.

The config hook binds the suite agents from the models this machine enables. It reads
`CODE_OPS_OPENCODE_MODELS`, else the model cache. With neither, it asks the host once by running
`<opencode> models --pure`, caches the answer, and binds from it, so the first launch is already
bound. The command is `CODE_OPS_OPENCODE_CMD` (a JSON array), else this process when it is the
OpenCode binary. It is never a bare `opencode` from `PATH`. The call times out after 8 seconds and
sets `CODE_OPS_CHOOSER_CHILD`, which stops a child from asking again. The `--pure` flag keeps the
child from loading this plugin. A plain `opencode models` loads it and recurses.

A launch that cannot bind keeps the static ladder from `opencode.json` and says why. Three
fallback notes exist. The first says no list arrived and names the failed command, the empty list,
or the missing binary. The second says no listed model meets a rung of the verified tier table.
The third says a rung with no enabled model of its class borrows a neighbor's model. The routing
card prints these notes under `Ladder fallbacks on this host:` only while one is active. The
first-event toast repeats them.

The ask is a local process, not a request by the plugin. On OpenCode 1.17.15 with an empty cache
directory, `models --pure` wrote a 5 MB `models.json`, and it wrote none with the network
blocked. The host CLI therefore fetches its model catalog on a cold cache, and the build wording
says the adapters make no network request of their own.

On OpenCode 1.17.15, `models --pure` and `client.config.providers()` both honor
`disabled_providers`. Only `models --pure` was probed for `enabled_providers`, which it honors.
Both list connected providers only. OpenCode's own reading of an empty `enabled_providers` is
UNVERIFIED. Evidence:
`scripts/opencode-lifecycle.js` (`providerSwitches`, `assertDispatchModel`, `buildChooserLadder`,
`askHostModels`) and `evals/opencode-enabled-models/run.mjs`.

## Agent state machine

Each entity below has a closed set of states. The Stored column names where the state lives, and
marks a state computed on read as derived. Lint requires the Unit (dispatch row) states to equal
`LEDGER_STATUSES` in `scripts/ledger-grammar.mjs`.

| Entity | States | Stored | Terminal |
| --- | --- | --- | --- |
| Unit (dispatch row) | dispatched, reported, failed, redispatched | `DISPATCH_LEDGER.md` plus `.journal.jsonl` | reported |
| Unit acceptance | pending, accepted, rejected | derived from the acceptance ledger in `RUN_CONTRACT.json` | accepted |
| Worker run | dispatched, reported, failed, stale | agent ledger, with `stale` derived | reported, failed |
| Runtime | init, checkpoint, resume, replan | `RUN_RUNTIME_RECEIPTS.jsonl` | none |
| Session | open, working, compacted, handed-off, consumed, ended | `SESSION.json`, board record, `HANDOFF.consumed`, with `compacted` derived | consumed, ended |
| Board record | live, idle, ended, abandoned | board file, with `idle` and `abandoned` derived | ended, abandoned |
| Context band | unassessed, assessed | `.assessed.json` | none |
| Program item | open, closed, backlog | `PROGRAM.md`, `TASKS.md`, `BACKLOG.md` | closed |
| Finish line Fn | open, done | derived from `Blocks: Fn` on items | done |
| Decision | pending, local, dropped, promoted | `PROGRAM.md` ledger, then the record | local, dropped, promoted |
| Distill phase | pending, running, checkpointed, done | runtime checkpoint per phase | done |

Each transition names its entity. From and To hold states of that entity, and `none` marks a
start. Cross-entity preconditions sit in Guard. The Writer is a script (S) that any host can run
or a hook (H) that needs the host event. Status is `built` or `planned`. Lint requires every
From and To state to belong to its entity and every Writer cell to be non-empty.

| # | Entity | From | Event | Guard | To | Writer | Store | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Session | none | lead opens a run | repository has `.git` | open | S `handoff-state.mjs open` | `SESSION.json`, board | built |
| 2 | Unit acceptance | none | lead registers units | session open and run contract exists | pending | S `run-contract.mjs init` | `RUN_CONTRACT.json` | built |
| 3 | Unit (dispatch row) | none | lead dispatches | unit pending, dispatch guard allows, band assessed, agentType is a suite agent | dispatched | S `dispatch-ledger.mjs add` with `--actor-id` | `DISPATCH_LEDGER.md` | built |
| 4 | Worker run | none | host launches a worker | hook reaches the launch | dispatched | H PostToolUse on `Agent` in `plugins/code-ops-suite/hooks/agent-ledger.mjs`; covered by 3 | agent ledger | built |
| 5 | Unit (dispatch row) | dispatched | worker returns | artifact exists and passes its section check | reported | S `dispatch-ledger.mjs update --status reported --report` | `DISPATCH_LEDGER.md` | built |
| 6 | Worker run | dispatched | host reports the stop | SubagentStop carries `agent_id` (Grok: `subagentId`) | reported | H SubagentStop in `plugins/code-ops-suite/hooks/agent-ledger.mjs`; covered by 5 or 7 | agent ledger | built |
| 7 | Unit (dispatch row) | dispatched | worker errors or dies | lead sees the error or a stale view | failed | S `dispatch-ledger.mjs update --status failed` | `DISPATCH_LEDGER.md` | built |
| 8 | Unit (dispatch row) | failed | lead retries | new row with a new actor | redispatched | S `dispatch-ledger.mjs update --status redispatched`, then `add` | `DISPATCH_LEDGER.md` | built |
| 9 | Unit acceptance | pending | lead records verdicts | unit reported and every blocking criterion PASS | accepted | S `run-contract.mjs record` and `finalize` | `RUN_CONTRACT.json` | built |
| 10 | Unit acceptance | pending | lead records a FAIL | unit reported and any blocking criterion FAIL; a new unit is planned | rejected | S `run-contract.mjs record` | `RUN_CONTRACT.json` | built |
| 11 | Context band | unassessed | lead runs the assessment | context crossed a 150k band, so dispatch is denied until assessed | assessed | H `dispatch-guard.mjs assessed` writes the marker | `.assessed.json` | built |
| 12 | Session | working | auto-compaction starts | PreCompact fires or lead checkpoints | compacted | H PreCompact in `plugins/code-ops-suite/hooks/compact-snapshot.mjs`, or S `run-runtime.mjs checkpoint` | run folder snapshot, receipts | built |
| 13 | Session | compacted | new context starts with `source=compact` | snapshot exists | working | H SessionStart compact branch in `plugins/code-ops-suite/hooks/routing-card.mjs` | none (reads snapshot, `TASKS.md`, agent ledger) | built |
| 14 | Session | working | lead hands off | DEC-73 trigger and zero pending workers | handed-off | S `handoff-state.mjs draft` | `HANDOFF.md` | built |
| 15 | Session | handed-off | successor resumes | chain check passes | consumed | S `handoff-state.mjs resume` | `HANDOFF.consumed` | built |
| 16 | Session | working | session ends | none | ended | H SessionEnd in `plugins/code-ops-suite/hooks/session-receipt.mjs`; S writer for `ended` planned | board, receipts | built |
| 17 | Board record | live | heartbeat silent 30 minutes | no `ended` | idle, abandoned | read only (derived views) | board | built |
| 18 | Program item | open | lead closes with evidence | Done when met | closed | lead edit, checked by `check-handoff.mjs` | `PROGRAM.md` | built |
| 19 | Program item | open | active count exceeds 12 | open-item cap | backlog | S `check-handoff.mjs check 19` | `BACKLOG.md` | built |
| 20 | Finish line Fn | open | last `Blocks: Fn` item closes | none | done | burn-down line from `scripts/burndown.mjs` (derived view) | derived | built |
| 21 | Decision | pending | one hop of grace passes | disposition chosen | local, dropped, promoted | S `co decide promote` in `scripts/program-lifecycle.mjs`; `distill` phase 6 planned (distill, PRs 6 to 8) | `PROGRAM.md`, record | built |
| 22 | Distill phase | pending | lead starts the phase | prior phase done | running, checkpointed | planned (distill, PRs 6 to 8) with S `run-runtime.mjs checkpoint` | receipts | planned |
| 23 | Distill phase | checkpointed | lead review passes | review rule met | done | planned (distill, PRs 6 to 8) | receipts | planned |

A planned unit that will never run is not a Unit (dispatch row) state, because it has no row and no
actor. The lead declares it with `dispatch-ledger.mjs skip --ledger <file> --id <D-NNN> --reason
<text>`, which appends one `> not-dispatched: D-NNN · <reason>` line to the ledger and leaves the
journal unchanged. `run-runtime.mjs status` lists the unit under `notDispatched`, not
`pendingDispatches`. In-flight reconciliation accepts the unit with no row. Strict reconciliation
and `finalize` still refuse it until a replan drops it from the contract. A marker for a unit the
contract does not plan, for a unit that has a row, or in a malformed form fails every reader.

Evidence: `scripts/lint-plugins.mjs` (`checkAgentStateMachine`) and `scripts/ledger-grammar.mjs`.

## Peer guard hook

`hooks/peer-guard.mjs` runs at `PreToolUse` with the matcher
`mcp__ccd_session_mgmt__send_message|SendMessage`. It acts on a message to a peer session that
already handed off. When the live successor is known, the hook redirects the message there. When
it is not, the hook denies the message. The hook is on by default. `CODE_OPS_PEER_GUARD` of `off`,
`0`, or `false` turns it off. The target is `tool_input.session_id` for `send_message` and
`tool_input.to` for `SendMessage`. The hook strips a trailing ` [<ref>]` suffix from `to`.
Evidence: `plugins/code-ops-suite/hooks/peer-guard.mjs:1-48` and
`plugins/code-ops-suite/hooks/hooks.json`.

**Lookup.** `sessionRecords()` in `scripts/handoff-state.mjs` reads the session records for the
repository that the payload `cwd` belongs to. It reads the repository-keyed store first, then the
older store keyed by the working directory (`sessionRecordPath` in `scripts/transcript-lib.mjs`).
It keeps one record per session id. Both stores sit under `CODE_OPS_HOME` when set, else the OS
home. The target matches a record's `hostSessionId` or `sessionId` first, then its `name`, newest
`updatedAt` first. Every comparison is case-insensitive and exact. A record's `runDir` resolves
against its `worktree` under the repository root. An older record without `worktree` resolves
against `cwd`. Evidence: `scripts/handoff-state.mjs:302-322`.

**Decision.** The hook acts only when the matched record's run folder holds `HANDOFF.consumed` or
`HANDOFF.md`, because either means that session handed off. It walks successor links the way
`handoff-state.mjs live` does:

- A live head that carries the id the tool needs: the hook redirects. The id is the host session
  id for `session_id` and the session name for `to`.
- A live head without that id: the reason names the head's session name, its host session id
  when a record carries one, and its run folder, and tells the sender to resend there.
- A head with an unconsumed `HANDOFF.md`, the target itself included: the reason says the
  handoff has not been resumed yet and names the successor from its `Session:` line.
- A legacy marker, a loop, or a missing successor run: the reason asks the sender to run
  `co handoff live` first.

**Redirect shape.** The output is `hookSpecificOutput` with `hookEventName: "PreToolUse"`,
`updatedInput`, and `additionalContext`. `updatedInput` is the whole tool input with the target
field replaced by the head's id. `additionalContext` is a notice that names the old target and
the head's name, host session id, and run folder. Like the digest rewrite hook, the output has no
`permissionDecision`, so the host's own permission rules still decide the call. A denial is
`permissionDecision: "deny"` with the reason in `permissionDecisionReason`. Evidence:
`plugins/code-ops-suite/hooks/peer-guard.mjs:98-157`.

**When the deny stays.** Claude Code and Codex document `updatedInput` (CONFIRMED), so both get
the redirect. The hook detects Grok by `GROK_PLUGIN_ROOT` or by a camelCase payload (`toolName`,
`toolInput`). Grok always gets the deny, even when a redirect is possible. No live Grok payload
has shown an input rewrite take effect (OI-10, DSN-2, UNVERIFIED). OpenCode does not run this
hook, so it gets neither the redirect nor the deny. Its input rewrite is also unverified (DSN-2,
UNVERIFIED). No Grok or Codex messaging tool with either name is verified, so the hook is likely
inert there (UNVERIFIED). The Codex projection drops the matcher, so the hook filters the tool
name before it reads any file.

**Fail-open.** An unknown target, no record store, or a run folder with neither file passes with
no output. Bad JSON, another event or tool, a missing field, or any thrown error exits 0 with no
output. The hook reads at most two directories and a few small files, and never spawns a process.
Evidence: `plugins/code-ops-suite/hooks/peer-guard.mjs:130-160` and `evals/peer-guard/run.mjs`.

**Repository key.** The key is the repository folder name plus the first 12 hex of the SHA-256 of
the git common directory. The path is lowercased on Windows before the hash. `repoIdentity()`
walks up to the first `.git`. A worktree's `.git` file names `<common>/worktrees/<name>`, so one
file read gives the common directory, with no git process. Every worktree of a repository
therefore shares one key. Outside a repository, the directory itself keys the store. The hash
keeps the absolute path out of every file name. Evidence: `scripts/handoff-state.mjs:257-292`.

**Session store rekey.** `open` and a passing `resume` write the session record to
`<home>/.claude/code-ops/sessions/<repo key>/<session id>.json`. The record adds `worktree`, the
worktree top relative to the repository root. Readers fall back to the older working-directory
store, so records written before the rekey still resolve. Evidence:
`scripts/handoff-state.mjs:11-21,324-330`.

**Presence board.** The board holds one file per session at
`<home>/.claude/code-ops/board/<repo key>/<session id>.json`. A record holds `sessionId`,
`hostSessionId`, `name`, `branch`, `worktree`, `runDir`, `claims`, `edits` (path and time, newest
20), `task` (one line, at most 200 characters), `heartbeat`, and `ended`. Every path is relative to
the worktree top, and no record holds an absolute path. A path outside the worktree is dropped. A
record whose heartbeat is older than 30 minutes lists as idle. An ended record lists as ended.
These actions write the board:

- `open` and a passing `resume` write the record. A resume also claims the program's scope
  documents.
- The `PostToolUse` edit hook (`index-refresh.mjs`) records edited paths. It runs the board write
  even when `CODE_OPS_INDEX` is off.
- The `SessionEnd` hook (`session-receipt.mjs`) marks an existing record ended.
- `co board` lists the board. `co board claim <path...>`, `co board release [<path...>]`, and
  `co board task <text...>` change the session's own record. A release with no path releases all
  claims. Claims are advisory, and no command refuses another session's claim.

Every write refreshes the heartbeat. A missing or corrupt record starts fresh. The board is
advisory, so a board write never fails the command or hook that made it. Evidence:
`scripts/handoff-state.mjs:23-37,332-419`, `plugins/code-ops-suite/hooks/index-refresh.mjs:14-16,46-61`,
and `plugins/code-ops-suite/hooks/session-receipt.mjs:70-91`.

**Switch coverage.** `CODE_OPS_PEER_GUARD` off turns off the redirect, the deny, and every board
write: open and resume, the edit hook, the `SessionEnd` mark, and the OpenCode adapter. The `co
board` commands still run when an operator calls them.

**OpenCode port.** The OpenCode adapter adds a `tool.execute.after` handler. For `edit`, `write`,
and `multiedit` with a `sessionID`, it spawns the bundled `hooks/index-refresh.mjs` with a
`PostToolUse` payload and `CODE_OPS_INDEX=off`. It ignores the result and times out after 2
seconds. The existing `file.edited` handler keeps the index refresh. Two limits apply. First, the
board record uses OpenCode's `sessionID`, while `handoff-state.mjs` reads only `--session`,
`CLAUDE_CODE_SESSION_ID`, or `CODEX_SESSION_ID`. So an OpenCode `open` or `resume` record joins
the edit record only when `--session` passes the same id. Second, `apply_patch` edits are not
recorded. Evidence: `scripts/build-opencode-dist.mjs:401,452-461,685-687` and
`evals/opencode-dist/run.mjs`.

**Cost.** MEASUREMENTS.md, "Presence board hook latency, 2026-09-28", records the added latency.

## Change feed

The change feed tells live sessions about moves that affect them. Events are `push`, `merge`,
`hub-edit`, `seal-start`, `seal-land`, and `seal-abort`. Each carries an id, a time, a kind, the
branch, the commit, the session name and id, repo-relative paths, and an optional seal id and
note. The store is `<home>/.claude/code-ops/feed/<repo key>/events.jsonl`, with per-session cursors
under `cursors/`. It keeps at most 200 events and 64 KiB, and drops the oldest first. A reader
skips a corrupt line.

Three writers post events. `hooks/handoff-card.mjs` records a Bash `git push` or `gh pr merge` at
`PostToolUse`. `hooks/index-refresh.mjs` records a `hub-edit` for `DOCS_MANIFEST.json` and
`PROGRAM.md`. `co records seal` records `seal-start`, `seal-land`, and `seal-abort`, and prints a
`records: warning:` line on stderr when another seal on the same base head is still in flight. The
seal never refuses.

`hooks/handoff-card.mjs` delivers events at `UserPromptSubmit` and `PostToolUse`. Grok delivers at
`PostToolUse` only, because it discards `UserPromptSubmit` output. A call delivers at most three
lines, one per event, once per session. An event reaches a session when its branch matches the
session's branch, or when its paths meet that session's board edits or claims. A session with no
cursor reads the last 10 minutes. The card keeps its own text and bands. Off Grok it runs on
prompts only, so a `PostToolUse` call carries the feed alone.

The feed has its own switches. `CODE_OPS_FEED` of `off`, `0`, or `false` turns it off, and so does
`CODE_OPS_PEER_GUARD`. `CODE_OPS_HANDOFF_CARD=off` silences only the card. The hook now runs git,
up to three short calls, for a `push` event to name the commit and paths. Nothing else in it
spawns a process. Every path fails open. Evidence: `scripts/change-feed.mjs`,
`plugins/code-ops-suite/hooks/handoff-card.mjs`, and `evals/change-feed/run.mjs`.

## Symbol index and query

`context-query.mjs` answers a structural question with `file:line` anchors, one-line
signatures, and edge lists, never a verbatim dump: `find`, `callers`, `callees`, `blast`, and
`explore`, plus `refresh` and `status`. A symbol is a name or a `path:name` pin, and a pin
prefers an exact path over a suffix match, so a vendored copy never shadows the canonical file.
`explore` ranks definitions before matching lines, stops at `--budget` bytes with a
`BUDGET_EXCEEDED` marker, and appends definition bodies only under `--with-source` and only
within the same budget. `refresh` re-parses only files whose content sha changed, `refresh
<path>` re-parses one file, and `--exclude <prefix>` is remembered by the index. Evidence:
`scripts/context-query.mjs:8-21`, `scripts/context-query.mjs:217`,
`scripts/context-query.mjs:265`, and `scripts/context-query.mjs:433`.

The ceiling is printed on every edge result. Definitions, spans, calls, and import edges come
from the line rules in `symbol-lib.mjs`, and that file is the single source of all four readers:
`repo-map.mjs` takes its definition table from `CODE`, `import-graph.mjs` takes both the
extraction and the resolution from `imports()` and walks exactly the extensions `IMPORT_EXTS`
names, `skim.mjs` outlines from the same table, and `context-query.mjs` indexes from it. So the
map, the graph, the outline, and the index cannot disagree about what a definition or an import
edge is. An import edge carries `spec`, `target`, `names`, `relative`, and `dynamic`: `relative`
separates an unresolved path in the tree from a package name that was never going to resolve,
and `dynamic` marks a non-literal `import(...)` argument, which is listed rather than dropped.
A call resolves to the definition of that name in the same file,
else in the file the caller imports that name from (an `as` alias included), else to every
definition of that name in the tree, marked ambiguous, else unresolved. A dynamic import by
path, a string-built name, or a type-dispatched call stays ambiguous or unresolved by contract.
A result that touches a file whose content changed since the index was built carries a stale
banner, and `--no-stale-check` suppresses the check. Evidence: `scripts/symbol-lib.mjs:45`,
`scripts/symbol-lib.mjs:108`, `scripts/symbol-lib.mjs:158`, `scripts/symbol-lib.mjs:176`,
`scripts/repo-map.mjs:39`, `scripts/import-graph.mjs:44`, `scripts/import-graph.mjs:74`,
`scripts/skim.mjs:132`, `scripts/context-query.mjs:281`, `scripts/context-query.mjs:336`, and
`scripts/context-query.mjs:357`.

Two optional providers raise fidelity, and both are data rather than a requirement.
`refresh --provider ctags|codegraph|none` defaults to `none`, and nothing is spawned unless the
flag names one. With `ctags` the tool runs Universal Ctags over the files about to be parsed,
reading the list on stdin so a long list never meets a command-line limit, and merges a tag into
a file only on a line the rules left free. A merged definition carries `source`, a kind map turns
the ctags kind into the index's own, and the signature comes from the tag pattern. A provider that
is absent, is a different ctags, or fails prints one line on stderr and the rules stand alone, so
a refresh never fails for a missing tool. `codegraph` is detected and reported, not ingested. The
index records the providers its definitions came from and `status` prints them. Evidence:
`scripts/context-query.mjs:31-33`, `scripts/context-query.mjs:119`,
`scripts/context-query.mjs:165`, `scripts/context-query.mjs:200`, and
`scripts/context-query.mjs:215`.

`context-query-mcp.mjs` is the same queries as a newline-delimited JSON-RPC 2.0 stdio server, so
a host with no shell reaches them. The server is `code-ops-query` in the plugin manifest's
`mcpServers`, and it declares three tools: `context_query`, taking a command of `find`, `callers`,
`callees`, `blast`, `explore`, or `status` with a target and optional `budget`, `fuzzy`, and
`root`, `context_refresh`, taking optional `paths` and `root`, and `transcript_recall`, which
takes a `command` of `status`, `outline`, `search`, or `zoom` and a `session`, plus optional
`id`, `line`, `terms`, `kind`, `depth`, `page`, and `budget` (minimum 200), and spawns
`transcript-recall.mjs --json`. Each call spawns the sibling
query script with `--json` and returns its JSON as the tool's text content, so a query that finds
nothing still answers. A caller's mistake comes back as an Invalid-params error and a failure
inside the script as an Internal error, never a process exit. Evidence:
`scripts/context-query-mcp.mjs:22-24`, `scripts/context-query-mcp.mjs:64`,
`scripts/context-query-mcp.mjs:72`, `plugins/code-ops-suite/.claude-plugin/plugin.json:30-35`,
and `evals/context-query-mcp/run.mjs:82-97`.

The index is a home-directory file, `$CODE_OPS_INDEX_DIR/index.json` or
`~/.claude/code-ops/index/<project slug>/index.json`, keyed by the repository root, so a query
never reads another repository's index and nothing is committed. The `PostToolUse` hook
`index-refresh.mjs` is on by default. It calls `refresh <file>` after every edit with a
five-second budget and prints nothing. Setting `CODE_OPS_INDEX` to `off`, `0`, or `false` in the
canonical environment turns it off; rendered hosts use their documented process environment.
Evidence: `scripts/context-query.mjs:96` and
`plugins/code-ops-suite/hooks/index-refresh.mjs:25-36`.

## Transcript recall

After host compaction, a session recovers exact earlier detail from its own host transcript
JSONL without reading the whole file. Every answer ends at the original bytes, checked by
sha256. The feature makes zero model calls and adds nothing to the hot path.
`transcript-recall.mjs` is the library and the CLI, `node scripts/transcript-recall.mjs
<status|outline|search|zoom|build> --session <id>`, and `co recall` routes to it. Line scanning
comes from `walkLines(buf)` in `transcript-lib.mjs`, which yields `{off, len, line, text}` per raw
line, with offsets in bytes.

The index is a home-directory tree,
`<CODE_OPS_HOME or home>/.claude/code-ops/recall/<project slug>/<session slug>/`, keyed like the
compact snapshot path. It holds two files, both written with `atomicWrite`. `meta.json` carries
`version`, `transcript`, `indexedBytes`, `tailSha256`, and `boundaries`. `tree.json` carries
nodes of `{id, kind, parent, off, len, sha256, uuid?, label}`. The index never stores raw bytes,
and every label passes the masker before it is written.

The first call whose meta is missing or behind the file size builds the index. If `tailSha256` of
the last indexed line still matches, the build extends from `indexedBytes`. Otherwise it rebuilds
in full. An `O_EXCL` lock file guards the build, with a stale check on its PID and age.

The tree has five levels. L0 is the session. L1 is an epoch between `compact_boundary` rows. L2 is
a turn, from one operator prompt to the next. L3 is a step, one assistant `message.id` group. L4
is a block, a text block or a `tool_use` paired with its `tool_result` by `tool_use_id`. The leaf
is the raw line bytes. Sidechain rows and `isCompactSummary` rows are never leaves. A node id is
`@<off>+<len>`, and `zoom` also accepts a uuid. `line:<n>` resolves to the leaf for that
transcript line, which is how snapshot stubs point into the transcript. A label is computed, not
written by a model, and is capped at about 200 characters. A turn label holds `prompt line:<n>`
as a reference and never the prompt text.

`--agent <agentId>` (`agent` in the `transcript_recall` MCP tool) recalls into a subagent
transcript, `<projects dir>/<session id>/subagents/agent-<agentId>.jsonl`, unless `--transcript`
is given. Every row of that file is a sidechain row, so the builder treats sidechain rows as the
main thread there; a main-session index still skips them. The index directory gains the agent, so
the two indexes never collide. The agent id must be letters, digits, `_` or `-` (up to 64
characters), so it cannot hold a path separator or `..`. Anchors, sha256 drift checks, and
masking are unchanged. To recall a predecessor session (chain scope), pass its id as `--session`.

Every command stops at `--budget` bytes of output.

- `status` prints the index age, `indexedBytes`, the file size, the boundaries, the node count,
  and whether the index is current.
- `outline` prints the child labels of `--id` (default the root) down to `--depth`.
- `search` scans the raw transcript bytes at query time, with no stored posting list. It ranks
  leaf blocks by term hits, weighs exact identifiers (SHAs, PR numbers, paths, ids) higher, takes
  an optional `--kind` of `text`, `tool`, or `error`, and returns `[{id, label, score, snippet}]`.
  Only the snippet is masked at output.
- `zoom` on an interior node returns child labels. On a leaf it re-reads `[off,len]`, checks the
  sha256, masks the text, and pages it by `--page`.

A sha mismatch or a truncated file makes `zoom` fail closed with `anchor drift`: a non-zero exit
and no content. No path prints raw unmasked transcript text. `CODE_OPS_RECALL` of `off`, `0`, or
`false` makes every command print a one-line disabled notice and exit 0.

`evals/transcript-recall/run.mjs` is deterministic and uses no model. It generates a synthetic
fixture and never reads a real transcript. It gates that the host summary and the compact
snapshot lack the planted tool-result, free-text, and id needles while search then zoom recalls
each within four tool calls with a sha match; that an incremental build equals a full rebuild
byte for byte; that a rewritten or truncated transcript yields `anchor drift`; that the secret
needle appears in no recall file and no output; that `line:<n>` resolves and the off switch
works; and that sidechain and compact-summary rows are never leaves. Three mutants must each
fail the eval: an offset off by one, a scrambled id map, and masking disabled. One
paraphrase-only fact is a declared miss, reported and not gated.

## Atlas claims and scope suggestion

`atlas-check.mjs check` prints a claim report beneath each section's freshness verdict. A
claim is a `path:line` citation in the section's prose. Its statuses come from
`revalidate-register.mjs`, run once over one temporary register the check deletes when it
ends, so the atlas and a findings register classify a drifted citation identically. A
section citing nothing reports `claims: none`. The digest verdict and `--gate` keep their
existing meaning. `--claims-gate` is separate, and exits 1 on any claim the classifier did
not call FRESH, an unclassifiable one included. Evidence: `scripts/atlas-check.mjs:302-344`,
`scripts/atlas-check.mjs:544-567`, and `scripts/atlas-check.mjs:698-706`.

`atlas-check.mjs scope <slug> --suggest` reads `context-query.mjs blast --json` over the
section's scoped files and prints the depth-1 importers that the current scope does not
already cover, as a pathspec list for `add --scope`. It writes nothing. `blast` reports the
importer direction only, so the suggestion never names what the scope itself imports. A
missing symbol index exits 1 naming the refresh command rather than building one, and the
query is capped at 200 scoped files with an explicit advisory. Evidence:
`scripts/atlas-check.mjs:763-841`.

## Documentation manifest

Manifest v1 contains `version`, `hub`, and `domains`. Manifest v2 retains those fields and adds `runs`, `recordCollections`, and `legacyPaths`. Version 2 requires vault standard v4. Version 1 remains valid under standards v3 and v4 when no collection is declared.

Each record collection declares `id`, permanent `collectionUuid`, `identityVersion`, repository-relative `root`, four hub-relative generated paths, and total classification `scopes`. Omitted `classificationVersion` selects v1 scopes containing exactly `pattern`, `kind`, and `policy`.

`classificationVersion: 2` selects scopes containing exactly `id`, `match`, `paths`, `kind`, and `policy`. Exact tracked `paths` outrank glob `match` selectors. The manifest gate rejects stale exact paths and case mismatches. Record classification rejects multiple exact owners, multiple surviving glob owners, and zero owners. The single-owner rule makes scope order non-authoritative.

Legacy paths contain `path`, `disposition`, hub-owned `target`, and qualifying `requiredBy` evidence. Manifest synchronization updates domain digests only. It never creates pointers, tombstones, inventories, citation baselines, or curation events.
A v2 or v3 manifest may set the top-level `digestStore` to `"files"`. Domains then carry no `sourceDigest` or `contentDigest` key. Each digest lives in `<hub>/98 System/Digests/<id>.<source|content>.<first 16 hex>`, which holds the full SHA-256 digest and a newline. Synchronization adds the new file and deletes the old one. `check` fails a missing digest or two digests for one domain as stale. It fails a malformed name, an unknown domain, a name that does not match its content, or a leftover digest key as a structural error. `migrate` moves a fresh JSON-mode manifest to files mode. Evidence: `scripts/docs-manifest.mjs`.

## Record operations

`records.mjs` exposes `classify`, `plan-adoption`, `adopt`, `re-review`, `curate`, `append`, `intake`, `seal`, `relocate-root`, `render`, `render --register`, `check`, `verify-history --strict`, and `reindex-locators`. Every authority mutation is a fail-closed transaction. Strict history failure is infrastructure failure. Evidence loss requires complete history.

`classify` reports partition validity and historical adoption readiness. Invalid classification reports `classification-invalid` even when history is unavailable. Uncommitted index candidates report `pending-commit` without invalidating structural classification. An immutable path outside authority blocks `check` as `pending-admission`.

Genesis `plan-adoption` writes only to a repository-relative ignored path. Every record operation parses classification policy from canonical Git-index manifest bytes. Authority mutations revalidate that index snapshot before binding a batch and again after post-write verification. The plan binds `HEAD`, that manifest, candidate bytes, and path history. Historically revised immutable candidates require a `freeze-current` disposition and rationale. `adopt --review` recomputes every binding.

`re-review --record <path> --reviewer <name> --rationale <text> [--at <iso>]` re-reviews one admitted path whose current bytes equal the reviewed digest but whose history gained content transitions, such as an edit later restored. It refuses a dirty worktree, a path without a review receipt, changed bytes, an unreachable prior review source, and history without new transitions. It appends a receipt to inventory `reReviews` and leaves the original review in place. The receipt stores the current history profile, the prior profile digest and source, the path commits between that source and `HEAD`, the reviewer, the rationale, and a `receiptDigest`. `check` then compares that path against the newest receipt. The chain is append-only and covers one path per receipt, so every other drift still fails.

`plan-adoption --incremental` writes a version 2 plan with `mode: "incremental"`. Its `baseBindings` cover inventory, citations, curation, index, and the authority-batch head. `adopt` infers incremental mode only from this receipt.

An empty incremental delta prints `{"mode":"incremental","status":"no-op","reason":"no-pending-admission","candidates":0}` and writes nothing. `--require-delta` instead refuses with `incremental admission requires at least one pending immutable path`.

Inventory v3 preserves singular `adoptionReview` for genesis evidence and v2 compatibility. That slot requires receipt version 1. Its one growing `authorityBatches` chain records all immutable membership and provenance. Incremental batches require an embedded version 2 receipt and bind it through `reviewReceiptDigest`.

Each authority batch stores `version`, `sequence`, `type`, `previousBatchDigest`, `sourceHead`, `manifestSha256`, `priorAuthorityDigest`, `authorityDigest`, `baseBindings`, `objects`, `review`, `reviewReceiptDigest`, and `batchDigest`. Batch type is `genesis-adoption`, `incremental-adoption`, `native-append`, or `v2-migration`. Genesis has no prior generated state, so only non-genesis batches carry `baseBindings`. Their `authorityBatchHead` equals `previousBatchDigest`. Complete-history checks re-derive every predecessor binding and the manifest digest from the batch-introduction commit or an earlier batch in the same transaction. A reachable adoption source must contain every reviewed candidate and the bound manifest, and its candidate histories must equal the receipt profiles.

An `incremental-adoption` batch embeds its complete receipt in `review`. Genesis and v2 migration bind the singular `adoptionReview` by digest and set `review` to null. Native append sets both review fields to null.

Each `objects` entry stores `type`, `path`, and `objectDigest`. The `type` is `record` or `artifact`. `objectDigest` hashes the complete immutable inventory object. Every immutable inventory object has exactly one matching authority object across the complete chain.

Batch type and object provenance must agree:

| Batch type | Record requirement | Artifact requirement |
| --- | --- | --- |
| `genesis-adoption` | `provenance: "adopted"` | `provenance: "adopted"` |
| `incremental-adoption` | `provenance: "adopted"` | `provenance: "adopted"` |
| `native-append` | `provenance: "native"`; `introducedIndexHead` equals batch `sourceHead`; the path has no history through that source | Same constraints as the record object. |
| `v2-migration` | Preserve the existing valid record object. | Preserve the existing artifact object without adding provenance. |

A provenance-less artifact is valid only under `v2-migration`. Any other batch/provenance mismatch blocks authority validation. With complete history, each non-genesis source precedes its batch-introduction commit. A native object's exact path has no history through that source and appears first in the commit that records its batch.

The first non-empty v2 authority mutation emits a receipted `v2-migration` batch before the requested batch. It preserves existing record, artifact, citation, and genesis receipt objects. A first v3 inventory may use this type only after an observed committed v2 predecessor. Empty operations leave v2 unchanged.

The authority-batch chain never carries curation state. The curation ledger never proves inventory membership. The two chains share mutation serialization but retain separate predecessors and digests.

With complete history, post-adoption checks require:

- exact stage-0 Git-index blob bytes, no semantic index-to-worktree divergence, and exact classification
- a 32 MiB maximum for each individual collection blob
- consistent stored risk labels
- current-risk rationale coverage
- non-increasing risk counts
- exact reviewed-candidate coverage within each applicable batch
- exact-once authority coverage across all immutable objects

Incomplete history warns during ordinary checks. Strict verification treats it as infrastructure failure. Commit rewrites may change locator fields without invalidating authority. `sourceHead` never selects a verification mode. A batch whose `sourceHead` is no longer reachable from `HEAD`, as after a squash merge, is accepted only while that commit object exists and its bound content matches; `native-append` still requires a reachable source. Protected repository review is the trust root for the unkeyed digest.

Failure ordering protects existing evidence first. Commands validate mode, clean state, complete history, and the existing baseline before candidate intake. They acquire the shared lock, then revalidate generated cleanliness, optimistic bindings, review, and history.

Commands build the complete mutation in memory after validation. One shared writer atomically replaces generated files, runs the complete semantic check, and rolls back every replacement on failure. The closing check includes the canonical manifest index snapshot, so shallow history cannot open a race. Commands prove the lock token and directory identity before authority writes and release.

Directory identity is the device, the inode, and a random `lease.nonce` file written at acquisition. A recreated directory can reuse an inode, and restore never copies the nonce, so a replaced lease fails closed on every filesystem. Stale recovery quarantines the judged directory and compares its identity before deletion. A replacement lease is restored under an atomically reserved path and recovery fails. An ordinary release cleanup error preserves a durable success. Lost ownership exits 3 with a durable-mutation, do-not-retry message.

The clone-wide lock lives at `<git-common-dir>/code-ops-record-locks/<collectionUuid>.lock/owner.json`. Its owner stores `pid`, `token`, and `acquiredAt`. A live or recent owner fails with `collection mutation lock is held`. A dead owner at least ten minutes old is recoverable.

Adopted entries store `introducedCommit` for exact-path provenance. Inventory v2 and v3 add `baselineCommit` for citation resolution. Inventory v1 keeps `introducedCommit` and must not carry `baselineCommit`. Version 1 remains a readable legacy format without a review receipt. Protected review or an external anchor must distinguish a genuine grandfathered inventory from a newly authored downgrade.

Native records require YAML frontmatter containing `recordSchema: 1` and `supersedes: [...]`. The supersession value is a JSON array of full `REC-` IDs. Native append accepts only staged paths with no reachable exact-path history. Historically present records and newly immutable artifacts use reviewed incremental admission after genesis. Adopted records retain their original bytes and do not gain this schema.

### Manifest v3 acceptance

Record operations accept documentation manifest v2 and v3, and every other version fails closed. Only v3 accepts `runs.tracking: "closeout"`. A v3 `removed` legacy entry names no target. Every other legacy entry keeps the v2 target rule. Only `pointer` and `tombstone` entries have generated bytes under v3, so legacy rendering and checks skip `relocated` and `removed` entries. The closed curation status set, the base-head rule, and required record meaning apply under v3 only.

### Record meaning

A native record may declare `kind` in its frontmatter as `decision`, `amendment`, `erratum`, `evidence`, `report`, or `summary`. A known kind also requires a one-line `title` and `topic`. The `decision` and `amendment` kinds also require `key` as `<domain>/<subject>` and a `decides` line of at most 25 words. Other kinds must not carry `key` or `decides`. An amendment names the records it amends in `amends: [...]`, a non-empty JSON array of full IDs. Its key must equal the key of each record it amends.

Admission copies the declared fields into the inventory entry as `meaning: {kind, title, topic, key, decides}`. `amends` sits beside `supersedes`. The key domain must be a manifest `domains` id. `check` re-reads the record bytes and fails on `record meaning drift` when the copy differs. Under v3 every native record needs a known kind. A v2 entry without `meaning` stays valid, and a record without a known kind carries no meaning.

### Typed curation events

Each curation ledger event has a `type`. A missing type reads as `curate`, so v2 ledgers keep their bytes. A `curate` event carries `recordId`, `previousRecordEventDigest`, `state`, and `curatedAt`. Under v3 `state.status` must be `in-force`, `amended`, `superseded`, or `historical`. A `relocate-root` event has exactly `collectionUuid`, `sequence`, `previousEventDigest`, `type`, `fromRoot`, `toRoot`, `relocatedAt`, and `eventDigest`. The per-record chain and the status fold read `curate` events only, so a relocation never overwrites a status.

### Intake and seal

Under v3 `append` and `curate` write the chains only on the base head. `--base <ref>` names it, and the default is `origin/HEAD`, then `main`. Off the base head, `curate` appends a line to `<hub>/98 System/Records/intake.jsonl` and leaves the ledger unchanged. The line's `basis` is the previous intake id for that record, or else its last ledger event digest.

`intake --record <hub>/98 System/Records/intake/<collection>/<path>` stages a new record body on a branch. The target is the same relative path under the collection root. The command checks the target classification, the absence of target history, and the record meaning. It then appends a `record` line with the future record id and the body digest. Each intake line has a closed key set and an `intakeId` of `INT-` plus 20 hex characters of its content digest.

`seal [--base <ref>] [--at <iso>]` runs on a branch at the base head with a clean tracked tree. It first checks every `curate` line basis in file order. A stale basis fails and names both the stale line and the intake line or ledger head that moved the record. Seal then moves each body to its target, admits the bodies in one `native-append` batch, appends the curate events, removes the sealed lines, and stages the result. Any failure resets the tree to `HEAD`. A second seal cut from an older base fails its batch `baseBindings` check.

### Root relocation

`relocate-root --from <oldRoot>` records a whole-collection move. First stage the move and the new manifest `root`, then run the command before the commit. The command refuses a partial move and any record or artifact whose bytes differ at the moved path. It then appends a `relocate-root` event. Record identity keeps the adoption path, so record ids and inventory paths do not change. The relocation events form one chain from the identity root to the manifest root. Every current-tree lookup maps the identity root onto the manifest root.

A manifest `root` change passes history checks only when the collection ledger records that move. Review-history profiles use identity paths at the parent of the commit that recorded the first move. Native admission into a relocated collection is refused. The optional `FORWARDING.json` document is `{version: 1, forwards: [{from, to, movedAt, reason}]}`. `record-lib.mjs` validates it and resolves forwarded prefixes with cycle detection.

### Decision register

`render --register` writes `<hub>/20 Decisions/REGISTER.md` and `<hub>/98 System/Records/state.json` from every collection plus intake. The register groups in-force and amended decisions by topic and lists their amendments. A final Summaries table lists summary records. An intake record appears under its intake id, and every pending entry carries a `pending seal` mark. `state.json` lists each record's id, collection, live path, kind, key, status, and pending intake id.
