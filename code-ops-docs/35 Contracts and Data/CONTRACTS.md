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
existing contract, snapshot, or capability receipt without `--force`. The façade form is
`co run contract init`. Evidence: `scripts/run-contract.mjs` and
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
tier, prints a warning and never fails the contract. The session lead owns acceptance. Unit
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
`scripts/context-index-lib.mjs:67-110`, `scripts/context-index-lib.mjs:225-277`, and
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
`host-probe`, or `provider-docs`. Evidence: `scripts/runtime-lib.mjs:17-22` and
`scripts/runtime-lib.mjs:100-127`.

Each v3 runtime policy is `off`, `prefer`, `require`, or `require-observable`. `require`
accepts only controllable or host-managed states. `require-observable` excludes
managed-unobservable states. `prefer` records `durable-fallback` for unavailable or unknown
features, and `off` records `disabled`. Unsatisfied required policy fails contract validation.
Evidence: `scripts/runtime-lib.mjs:128-147` and `scripts/run-contract.mjs:60-72`.

## Stable prefix and runtime receipts

The stable prefix is an ordered list of regular stage-0 Git-index files. Compilation rejects
linked components and non-regular index modes before reading bytes. It frames each UTF-8
file in a deterministic payload and records its SHA-256 digest, byte count, and entries.
The payload must not exceed `maxStablePrefixBytes`. Evidence:
`scripts/context-index-lib.mjs:82-110` and `scripts/runtime-lib.mjs:148-172`.

`RUN_RUNTIME_RECEIPTS.jsonl` is an append-only hash chain. Every version-1 record has a
sequence, timestamp, predecessor digest, binding, references, optional observation, and
its own digest. The first record is `init`. Later records are `checkpoint`, `resume`,
`replan`, or `observation`. Replay rejects torn, blank, malformed, reordered, or
digest-invalid records. Evidence: `scripts/runtime-lib.mjs:24-38` and
`scripts/runtime-lib.mjs:310-340`.

The binding includes contract bytes, Git head, snapshot identity and receipt bytes, the host
descriptor digest, capability states and policy outcomes, and stable-prefix metadata. It
does not copy raw host, provider, model, source, or observation-time labels from the ignored
descriptor. Descriptor initialization rejects Git-visible paths and linked components before
writing. An unchanged contract revision must retain this complete binding. A replan keeps
the run ID and increments the revision by one. Git heads are complete 40- or 64-digit object
IDs. Capability and receipt paths must differ portably and cannot share one physical file.
Evidence: `scripts/runtime-lib.mjs:173-218` and `scripts/runtime-lib.mjs:334-349`.

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
`scripts/runtime-lib.mjs:284-297`, `scripts/runtime-lib.mjs:352-386`, and
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

The package registers no `PreCompact` command. Claude and Codex ignore plain stdout from that
event, so `routing-card.mjs` handles `SessionStart` with `source=compact` and adds a
post-compaction instruction to restore decisions, constraints, evidence, blockers, open work,
and exact identifiers from durable state. This is recovery after compaction, not a claim that a
hook changed the summary. Grok ignores passive `SessionStart` stdout and therefore gets no
hook-injected restore card. OpenCode uses its native compaction port. Evidence:
`plugins/code-ops-suite/hooks/hooks.json`, `plugins/code-ops-suite/hooks/routing-card.mjs`,
and the generated host compatibility files.

## Routing card and traceless hooks

One bundled hook carries no environment switch at all, `enforce-traceless.mjs`. On Claude and
Codex, the `SessionStart` hook
`routing-card.mjs` prints a fixed card naming the standard routing table, tier and effort
rules, and context-economy defaults. It parses the start source so a compact resume receives
the restore instruction above. On Grok it emits nothing because passive hook stdout is ignored;
the paired instruction files carry the routing doctrine. Any error exits `0` silently.
Evidence: `plugins/code-ops-suite/hooks/routing-card.mjs` and
`evals/grok-build-compat/run.mjs`.

On a fresh session, a `source` of `startup` or `clear`, the same card appends one pending-handoff
line. The line names the newest pending `HANDOFF.md` and the date it was written, and it directs
the session to resume from it, verify its claims, and open the reply with a five-heading recap.
A compact resume gets the restore instruction instead, never the pickup line. Discovery reads two
bounded directory levels: the dated run folders under each `<repo>-docs/80 Runs/` beside the
repository root and under the repository's own `80 Runs/`. A handoff counts as pending when its
run folder holds no `HANDOFF.consumed` beside it and the `HANDOFF.md` mtime falls inside 14 days.
`CODE_OPS_HANDOFF_PICKUP` of `off`, `0`, or `false` drops the line and leaves the rest of the card.
Every read is guarded, so an unreadable directory yields no line rather than an error. Evidence:
`plugins/code-ops-suite/hooks/routing-card.mjs:9-65` and `evals/handoff-card/run.mjs`.

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

## Local judgment gate

`local-review-gate.mjs` creates an ignored review plan for a clean non-default feature
branch. The plan binds `baseSha`, `headSha`, `diffSha256`, sorted `changedPaths`, its
receipt path, and the exact gate set: `local-deep-review` and `local-opsec-gate`. The base
must be an ancestor of head, and an empty diff is rejected. Evidence:
`scripts/context-index-lib.mjs:67-79`, `scripts/local-review-gate.mjs:83-185`, and
`scripts/local-review-gate.mjs:357-383`.

Each ignored JSONL receipt has a sequence, gate, verdict, timestamp, reviewer and model
label, tier, effort, plan digest, report reference, finding counts, predecessor digest,
and receipt digest. `PASS` requires zero blocking findings. A replay rejects report drift,
duplicate gates, foreign plans, missing final newlines, oversized chains, and invalid
sequence or predecessor links. A complete check requires exactly one passing receipt per
gate from a distinct reviewer identity. Authority files must not use linked components or
physical aliases, and ignored authority outputs must not portably alias tracked Git paths.
Physical identity uses lossless device and inode values on every host.
Evidence: `scripts/local-review-gate.mjs:35-43`,
`scripts/context-index-lib.mjs:55-79`, `scripts/local-review-gate.mjs:194-269`, and
`scripts/local-review-gate.mjs:384-436`.

The gate fails when a tracked or untracked worktree change, ambiguous Git index flag, branch
change, advanced base, changed head or diff, report drift, or receipt drift invalidates its plan. Prepare a new
plan after boundary drift. Reviewer and model fields are attestations. Their format is
validated, but the receipt chain does not provide hardware-backed identity. Evidence:
`scripts/local-review-gate.mjs:157-185` and `scripts/local-review-gate.mjs:194-269`.

`publish` is optional. After a passing local check, it can post one GitHub commit status
per receipt to the reviewed SHA. It verifies that SHA is remotely available. The caller
needs GitHub write authority for the status endpoint. A status is supplementary evidence, so
publication failure does not alter the local pass or fail result. Evidence:
`scripts/local-review-gate.mjs:274-344` and `scripts/local-review-gate.mjs:441-468`.

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
`scripts/judgment-evals.mjs:23-30`, `scripts/judgment-evals.mjs:52-186`, and
`scripts/judgment-evals.mjs:188-329`.

The matrix declares the fixture-to-answer-key and fixture-to-skill mapping. Its current
fixtures cover bug, leak, documentation-drift, normalization, and trap-focused review
work. Evidence: `evals/judgment-matrix.json:1-52`.

A fixture may also declare `arms`, a list of model tiers. `register` mode compiles one unit
per declared tier for that fixture, same skill and same answer key, so the tier is the only
thing that varies between the resulting registers. Each unit names its tier in the id the
score receipt is keyed by. The mode requires two distinct model IDs and at least one fixture
declaring arms. Trend and floor expansions are untouched. Evidence:
`scripts/judgment-evals.mjs:99-111`, `scripts/judgment-evals.mjs:151-160`, and
`scripts/judgment-evals.mjs:282-284`.

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
`scripts/local-review-gate.mjs:48-53` and `scripts/local-review-gate.mjs:248-468`.

## Output digest

`digest.mjs` spawns the command after `--` directly, with no shell, and captures stdout and
stderr apart. The child's exit code becomes the digest's exit code on every path, including a
signal kill. A missing `--` exits 2 with usage. An executable that cannot spawn exits 127 and
names itself. Evidence: `scripts/digest.mjs:128-160`, `scripts/digest.mjs:213-216`, and
`scripts/digest.mjs:223-224`.

`--cwd <dir>` names the directory the command runs in, so a caller that would otherwise write
`cd <dir> && <cmd>` keeps the no-shell contract. That directory becomes the working directory
for the spawn, the Windows shim lookup, the in-repository frame test the stack shape applies,
the default store slug, and the `cwd` field of the receipt row. Without the flag it is the
digest's own working directory, so every default path is unchanged. A `--cwd` naming no
directory exits `2` with usage. Evidence: `scripts/digest.mjs:201-208` and
`scripts/digest.mjs:213-214`.

One shape is chosen per invocation. The detectors run in a fixed order, and the command tokens
bias only the cases the detectors leave open. Nine shapes exist: `json`, `diff`, `test`,
`diagnostics`, `stack`, `log`, `table`, `listing`, and `plain`. `plain` is the fallback, and it
passes output through under a line cap rather than filtering it. Evidence:
`scripts/digest-lib.mjs:372-423`, `scripts/digest-lib.mjs:425`, and
`scripts/digest-lib.mjs:447-461`.

The must-keep contract is fixed before any stage runs. `mustKeep(shape, raw, digested)` requires
every raw line matching `error`, `fail`, `failed`, `failure`, `exception`, `panic`, `fatal`,
`traceback`, `cannot`, `not found`, `denied`, or `refused`, plus the final non-blank line. A
`test` digest also keeps every failing test name and the summary. A `diff` digest keeps every
`diff --git` and `@@` header. A `diagnostics` digest keeps at least one line per file that had a
diagnostic, and states the totals. Past 200 matching lines the digest keeps the first 200 and
states the total. Comparison allows for a fold count appended to a line and for truncation to the
first `--line` characters. `digestText` enforces the same set by construction, so no stage may
drop or rewrite a protected line. Evidence: `scripts/digest-lib.mjs:26-31`,
`scripts/digest-lib.mjs:463-489`, `scripts/digest-lib.mjs:490-524`, and
`scripts/digest-lib.mjs:526-559`.

Every elided region prints `[elided N lines: sed -n 'A,Bp' <raw path>]`, or `[elided N lines]`
under `--no-store`. The ranges ascend, never overlap, and never cover a kept line. An output of
at most `--passthrough-below` bytes (default 1536), or one whose digest plus trailer would not be
smaller than the raw bytes, is printed raw on its own streams with no trailer, no raw file, and no
receipt row. `--passthrough-below 0` turns both rules off, and `--json` always carries every
field. Otherwise the final
printed line is always the trailer
`[exit <code> · <shape> · <rawLines> lines → <outLines> · raw <path> · sha256:<first 12>]`, with
`raw -` when nothing was stored. A stderr digest offsets its line numbers past the stdout section,
so its recovery hints address the raw file. Evidence: `scripts/digest-lib.mjs:102-108`,
`scripts/digest.mjs:244-252`, and `scripts/digest.mjs:236-242`.

Raw bytes go to `--store`, else `$CODE_OPS_DIGEST_DIR`, else
`~/.claude/code-ops/digest/<project slug of cwd>/`, at `<store>/<ISO date>/<HHMMSS>-<sha8>.txt`.
`--no-store` or `CODE_OPS_DIGEST_STORE=off` outranks all three and stores nothing. The default is a home-directory path, so a raw output is never inside a repository. Store writes
fail open: an unwritable store prints the digest with `raw -` and keeps going. Evidence:
`scripts/digest.mjs:166-195`.

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
message changed. Evidence: `scripts/cli-lib.mjs:37-46`, `scripts/cli-lib.mjs:110-121`,
`scripts/check-autofix-scope.mjs:50-57`, and `evals/co-facade/run.mjs:101-117`.

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
hosts use their documented process environment. No other switch exists. The Claude host contract
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
`scripts/transcript-lib.mjs:539-555`.

Codex documents an equivalent `UserPromptSubmit` event (OpenAI's `developers.openai.com/codex/hooks`,
confirmed live at `learn.chatgpt.com/docs/hooks`) carrying `session_id` and `prompt` on stdin,
with the same `hookSpecificOutput.additionalContext` output contract this plugin already uses
for its other Codex-projected hooks; its documented event-specific field list does not include
`transcript_path`, so a Codex payload that omits it degrades silently to no nudge, the same as a
missing transcript file. Installed Grok discards UserPromptSubmit stdout. On `PostToolUse` the
same script reads `updates.jsonl` and emits `additionalContext` when `GROK_PLUGIN_ROOT` is set.
That covers the TUI, headless `grok -p`, and the ACP agent. `CLAUDE.md` and `AGENTS.md` still
carry the assessment, because a turn with no tool call never fires `PostToolUse`. OpenCode does
not run this hook. `scripts/opencode-lifecycle.js` delivers the note from `message.updated`
usage. Evidence: `code-ops-docs/50 Platform/INFRASTRUCTURE.md` (host projections table) and
`plugins/code-ops-suite/hooks/handoff-card.mjs`.

Each band is an advisory assessment reminder, not a host limit, restart threshold, delivery
receipt, or cost proof. It directs the lead to run `handoff assess` at a safe boundary and choose
CONTINUE, COMPACT, or HANDOFF; a higher band asks for that assessment before a new workstream.
At or above the dispatch guard's context ceiling, the note adds that new dispatches stay gated
until that assessment runs; Grok omits that sentence because the guard cannot gate its dispatch
tool. A typed `/code-ops-suite:handoff` prompt on Claude or Codex expands without a `Skill` call,
so this hook records the ceiling assessment for it.
The marker proves only that the hook wrote a prior message. It does not prove that the host
displayed it, that a boundary existed, or that any action was chosen. Evidence:
`plugins/code-ops-suite/hooks/handoff-card.mjs:112-124`.

The hook fails open on every path: bad JSON, another event name, a missing `session_id` or
`transcript_path`, a missing or unreadable transcript file, a tail window with no assistant
usage, or any thrown error exits 0 with no output. Evidence: `evals/handoff-card/run.mjs`.

## Handoff write and consumption

`check-handoff.mjs <HANDOFF.md> [--root <repo>] [--strict-anchors] [--consume]` is the structural
floor under the handoff skill's write contract. Twelve headings are required, matched by prefix:
Program, Goal and state of play, Scope and constraints, Work completed, Key findings, In-flight boundaries,
Open items, Registers and artifacts, Decisions made, Traps and dead ends, Authority, and Carried
context. Goal through Open items answer what an operator asks a resumed session: what was worked on, what
was found, what is in progress, what is left, and what the scope and constraints are. Order is
documentation only; presence gates. Evidence: `scripts/check-handoff.mjs:85-97`.

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
by name.

One status line never gates. When the `Verified-at:` sha is HEAD and `git status --porcelain`
lists nothing but the handoff file itself, the check prints `same-tree: Verified-at matches HEAD
on a clean tree` on stderr. The resume direction then accepts each FRESH anchor without
re-reading its file. Register revalidation still runs, because closed register items can drift.
Any git failure leaves the line unprinted, which only costs the successor the slow path.
Evidence: `scripts/check-handoff.mjs` and `evals/handoff-check/run.mjs`.

`--consume` writes `HANDOFF.consumed` beside the file, holding one ISO timestamp line, and only
after every check above passes. The resume direction writes it once verification finishes, so a
marker means a session read and verified that state. The `SessionStart` routing card treats the
marker's presence as already picked up, which retires the handoff from discovery. A failed check
writes nothing, and a marker that cannot be written is reported rather than swallowed, because the
caller asked for it. Evidence: `scripts/check-handoff.mjs:45-48` and
`scripts/check-handoff.mjs:231-246`.

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
at the environment budget and every further 20 calls, it returns one
`hookSpecificOutput.additionalContext` line telling the operative to checkpoint to its report and
return. At twice the budget it returns `permissionDecision: deny` with the same instruction.
New state keys hash the working directory and exact
agent ID. Legacy counters remain readable and are retained during migration. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs`.

`register --agent-id <id> --budget <calls> [--allowance <calls>]` binds an exact controller-known
identity from the worker's working directory. It never infers correlation from timing, role, or
the lead's dispatch prompt. The allowance defaults to two, ranges from one to four, and cannot
extend the unregistered stop. Conflicting or invalid registrations cannot enlarge the allowance.
A malformed explicit binding or unavailable bound counter denies further calls, including in warning mode. Registration storage failures return nonzero UNAVAILABLE. Receipt counts remain UNKNOWN when counter storage cannot be read as a regular file.

`receipt --agent-id <id>` reports allowlisted control measurements and binding health. It emits
no raw identity, path, prompt, or command. Model requests and token usage remain `UNKNOWN` when
unobserved. This receipt is not a provider usage record. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs` and `evals/dispatch-guard/run.mjs`.

On the main thread the hook acts only on a dispatch tool: `Agent`, the older `Task`, or
`Workflow`. Three gates can deny there, and `warn` turns each deny into an advisory. The wide-type
gate denies a `subagent_type` of `general-purpose`, `claude`, or `fork`, or no type at all,
unless the prompt carries a line starting `Wide-surface reason:` with the reason on it. It denies a `Workflow` script that calls
`agent(` with no `agentType` on the same terms.

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
marker only rises, so a stale write never re-locks an unlocked band. The hook also adds at
most two advisory clauses: a `model` override that replaces the agent's declared tier, and a
brief whose prompt names no Round budget. Every deny and advisory for one dispatch lands in one
output. It never
denies any other main-thread tool call. Absent or malformed host payloads preserve the legacy
no-op behavior.
Explicit controller bindings have separate validation and conflict handling. Evidence:
`plugins/code-ops-suite/hooks/dispatch-guard.mjs` and `evals/dispatch-guard/run.mjs`.

The guard's wide-type deny, brief-contract deny, context-ceiling gate, and round stop are the enforcement layer.
The routing card, the dispatch ledger, and the narration scan are advisories only. Lint
separately requires every bundled agent body to carry a `Report cap: at most N words` line.
Evidence: `scripts/lint-plugins.mjs` and `scripts/scan-narration.mjs`.

## Symbol index and query

`context-query.mjs` answers a structural question with `file:line` anchors, one-line
signatures, and edge lists, never a verbatim dump: `find`, `callers`, `callees`, `blast`, and
`explore`, plus `refresh` and `status`. A symbol is a name or a `path:name` pin, and a pin
prefers an exact path over a suffix match, so a vendored copy never shadows the canonical file.
`explore` ranks definitions before matching lines, stops at `--budget` bytes with a
`BUDGET_EXCEEDED` marker, and appends definition bodies only under `--with-source` and only
within the same budget. `refresh` re-parses only files whose content sha changed, `refresh
<path>` re-parses one file, and `--exclude <prefix>` is remembered by the index. Evidence:
`scripts/context-query.mjs:8-21`, `scripts/context-query.mjs:218`,
`scripts/context-query.mjs:266`, and `scripts/context-query.mjs:434`.

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
`scripts/symbol-lib.mjs:95`, `scripts/symbol-lib.mjs:144`, `scripts/symbol-lib.mjs:162`,
`scripts/repo-map.mjs:39`, `scripts/import-graph.mjs:44`, `scripts/import-graph.mjs:74`,
`scripts/skim.mjs:132`, `scripts/context-query.mjs:282`, `scripts/context-query.mjs:337`, and
`scripts/context-query.mjs:358`.

Two optional providers raise fidelity, and both are data rather than a requirement.
`refresh --provider ctags|codegraph|none` defaults to `none`, and nothing is spawned unless the
flag names one. With `ctags` the tool runs Universal Ctags over the files about to be parsed,
reading the list on stdin so a long list never meets a command-line limit, and merges a tag into
a file only on a line the rules left free. A merged definition carries `source`, a kind map turns
the ctags kind into the index's own, and the signature comes from the tag pattern. A provider that
is absent, is a different ctags, or fails prints one line on stderr and the rules stand alone, so
a refresh never fails for a missing tool. `codegraph` is detected and reported, not ingested. The
index records the providers its definitions came from and `status` prints them. Evidence:
`scripts/context-query.mjs:31-33`, `scripts/context-query.mjs:120`,
`scripts/context-query.mjs:166`, `scripts/context-query.mjs:201`, and
`scripts/context-query.mjs:216`.

`context-query-mcp.mjs` is the same queries as a newline-delimited JSON-RPC 2.0 stdio server, so
a host with no shell reaches them. The server is `code-ops-query` in the plugin manifest's
`mcpServers`, and it declares two tools: `context_query`, taking a command of `find`, `callers`,
`callees`, `blast`, `explore`, or `status` with a target and optional `budget`, `fuzzy`, and
`root`, and `context_refresh`, taking optional `paths` and `root`. Each call spawns the sibling
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
Evidence: `scripts/context-query.mjs:97` and
`plugins/code-ops-suite/hooks/index-refresh.mjs:25-36`.

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

## Record operations

`records.mjs` exposes `classify`, `plan-adoption`, `adopt`, `curate`, `append`, `render`, `check`, `verify-history --strict`, and `reindex-locators`. Every authority mutation is a fail-closed transaction. Strict history failure is infrastructure failure. Evidence loss requires complete history.

`classify` reports partition validity and historical adoption readiness. Invalid classification reports `classification-invalid` even when history is unavailable. Uncommitted index candidates report `pending-commit` without invalidating structural classification. An immutable path outside authority blocks `check` as `pending-admission`.

Genesis `plan-adoption` writes only to a repository-relative ignored path. Every record operation parses classification policy from canonical Git-index manifest bytes. Authority mutations revalidate that index snapshot before binding a batch and again after post-write verification. The plan binds `HEAD`, that manifest, candidate bytes, and path history. Historically revised immutable candidates require a `freeze-current` disposition and rationale. `adopt --review` recomputes every binding.

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

Incomplete history warns during ordinary checks. Strict verification treats it as infrastructure failure. Commit rewrites may change locator fields without invalidating authority. `sourceHead` never selects a verification mode. Protected repository review is the trust root for the unkeyed digest.

Failure ordering protects existing evidence first. Commands validate mode, clean state, complete history, and the existing baseline before candidate intake. They acquire the shared lock, then revalidate generated cleanliness, optimistic bindings, review, and history.

Commands build the complete mutation in memory after validation. One shared writer atomically replaces generated files, runs the complete semantic check, and rolls back every replacement on failure. The closing check includes the canonical manifest index snapshot, so shallow history cannot open a race. Commands prove the lock token and directory identity before authority writes and release.

Stale recovery quarantines the judged directory and compares its device and inode before deletion. A replacement lease is restored under an atomically reserved path and recovery fails. An ordinary release cleanup error preserves a durable success. Lost ownership exits 3 with a durable-mutation, do-not-retry message.

The clone-wide lock lives at `<git-common-dir>/code-ops-record-locks/<collectionUuid>.lock/owner.json`. Its owner stores `pid`, `token`, and `acquiredAt`. A live or recent owner fails with `collection mutation lock is held`. A dead owner at least ten minutes old is recoverable.

Adopted entries store `introducedCommit` for exact-path provenance. Inventory v2 and v3 add `baselineCommit` for citation resolution. Inventory v1 keeps `introducedCommit` and must not carry `baselineCommit`. Version 1 remains a readable legacy format without a review receipt. Protected review or an external anchor must distinguish a genuine grandfathered inventory from a newly authored downgrade.

Native records require YAML frontmatter containing `recordSchema: 1` and `supersedes: [...]`. The supersession value is a JSON array of full `REC-` IDs. Native append accepts only staged paths with no reachable exact-path history. Historically present records and newly immutable artifacts use reviewed incremental admission after genesis. Adopted records retain their original bytes and do not gain this schema.
