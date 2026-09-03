---
type: reference
status: current
updated: 2026-09-01
---

# Contracts

## Run contract

`RUN_CONTRACT.json` is the machine-checked plan for an orchestrated run.
`run-contract.mjs` supports versions 1, 2, and 3. Version 2 adds a required context
binding. Version 3 adds a required runtime binding and `runtime-drift` to the canonical
replan triggers. Evidence: `scripts/run-contract.mjs:11-27` and
`scripts/run-contract.mjs:75-114`.

Each contract declares these top-level concerns:

- `quality` defines ordered criteria, proof, oracle, owner, and blocking status.
- `budget` limits dispatches, concurrent work, and retries per unit.
- `units` define scope, artifact, dependencies, routing, and quality criteria.
- `context` binds version 2 work to a snapshot, bundle location, untracked-file policy, and byte budgets.
- `runtime` binds version 3 work to host-capability evidence, runtime receipts, a stable
  prompt prefix, a prefix byte budget, and one policy per capability.

The validator requires the lead to use a strong-or-frontier model at high effort. Execution, judgment, and review units have separate tier and effort floors. Evidence: `scripts/run-contract.mjs:84-125`.

## Snapshot receipt

`CONTEXT_SNAPSHOT.json` identifies one visible repository state. Its identifier covers Git
head, staged state, unstaged state, untracked-file policy, and generator digests. Ignored
content is excluded by policy. Snapshot preparation and replay reject `assume-unchanged`,
`skip-worktree`, and unresolved index states before hashing worktree bytes. Evidence:
`scripts/context-index-lib.mjs:67-110`, `scripts/context-index-lib.mjs:225-277`, and
`scripts/context-snapshot.mjs:108-170`.

The snapshot command can generate a delta only when it receives both a previous receipt and a delta output. A changed snapshot requires a new contract revision and affected bundles. Evidence: `scripts/context-snapshot.mjs:30-35`, `scripts/context-snapshot.mjs:123-170`, and `scripts/run-contract.mjs:57-65`.

## Context bundle

`CONTEXT_BUNDLE.json` binds one work unit to a version 2 contract revision and snapshot identifier. It contains scoped repository-map entries, direct import relations, scoped visible changes, an optional snapshot delta, and Atlas material. Evidence: `scripts/context-bundle.mjs:41-75` and `scripts/context-bundle.mjs:108-149`.

The bundle never silently falls back to broad context. It writes `BROAD_CONTEXT_REQUIRED` for high-risk or oversized scope. It writes `BUDGET_EXCEEDED` when the rendered bundle exceeds `maxBundleBytes`. Evidence: `scripts/context-bundle.mjs:52-55` and `scripts/context-bundle.mjs:117-162`.

Context bundles support both v2 and v3 contracts. A bundle still binds its run ID,
contract revision, work unit, snapshot, compiler digest, and bounded contents. Runtime
receipts reference a verified bundle by unit ID, bundle ID, path, and file digest.
Evidence: `scripts/context-bundle.mjs:44-54`, `scripts/context-bundle.mjs:160-214`, and
`scripts/run-runtime.mjs:177-183`.

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
features; `off` records `disabled`. Unsatisfied required policy fails contract validation.
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

## Cache telemetry

An observation records cache observability as `observed`, `unobservable`, or `unsupported`.
It may record `hit`, `miss`, or `write` events and cache-read, cache-write, input, and
output token counts. Unobservable and unsupported observations cannot carry cache events or
token metrics. Provider-usage observations must carry at least one metric. The metrics view
reports normalized totals and event counts plus the minimized capability binding; raw host
provenance stays in the ignored descriptor. Elapsed time remains `UNKNOWN`. Evidence:
`scripts/runtime-lib.mjs:284-297`, `scripts/runtime-lib.mjs:352-386`, and
`scripts/run-runtime.mjs:293-317`.

## Session receipt hook

The `SessionEnd` hook reads `transcript_path` from the host payload, summarizes the main transcript and its `subagents/*.jsonl` siblings, and appends one receipt row. It writes nothing to stdout, exits `0` on bad stdin, a missing transcript, or an unwritable ledger, and finishes on a short timer when stdin never closes. Its ledger path is `$CODE_OPS_RECEIPTS`, else the home-directory default, and the value `off` disables the hook. Evidence: `plugins/code-ops-suite/hooks/session-receipt.mjs:32-81`.

`context-audit.mjs receipts` reads the ledger back and accepts only version `1` rows. Evidence: `scripts/context-audit.mjs:77-90`.

The `PreCompact` hook `precompact-preserve.mjs` prints one fixed instruction on stdout naming the six items a compaction summary must keep and the redaction markers it must leave as they stand. The host reads that stdout as the compaction's custom instructions. It reads no stdin, adds no per-turn tokens, and exits `0` on every path. Evidence: `plugins/code-ops-suite/hooks/precompact-preserve.mjs:15-33`.

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
needs GitHub write authority for the status endpoint. A status is supplementary evidence;
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
work. Evidence: `evals/judgment-matrix.json:1-50`.

Hosted CI keeps deterministic validation. `validate.yml` runs the structural gate and
regression evals, including the local-review and judgment-orchestration fixture evals.
Provider action examples remain compatibility paths, not a substitute for local model
judgment. Evidence: `.github/workflows/validate.yml:23-67` and
`.github/workflows/validate.yml:147-159`.

## Acceptance and result

`ACCEPTANCE.md` is an append-only table. Every row names a quality criterion, attempt number, verdict, proof, actor, and reason. Evidence: `scripts/run-contract.mjs:24`, `scripts/run-contract.mjs:188-205`, and `scripts/run-contract.mjs:218-224`.

Finalization requires every planned dispatch to be reported and every blocking criterion to have a latest `PASS` verdict. It writes a `RUN_RESULT.json` receipt only after those checks pass. Evidence: `scripts/run-contract.mjs:226-230`.

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
under `--no-store`. The ranges ascend, never overlap, and never cover a kept line. The final
printed line is always the trailer
`[exit <code> · <shape> · <rawLines> lines → <outLines> · raw <path> · sha256:<first 12>]`, with
`raw -` when nothing was stored. A stderr digest offsets its line numbers past the stdout section,
so its recovery hints address the raw file. Evidence: `scripts/digest-lib.mjs:102-108`,
`scripts/digest.mjs:244-252`, and `scripts/digest.mjs:236-242`.

Raw bytes go to `--store`, else `$CODE_OPS_DIGEST_DIR`, else
`~/.claude/code-ops/digest/<project slug of cwd>/`, at `<store>/<ISO date>/<HHMMSS>-<sha8>.txt`.
The default is a home-directory path, so a raw output is never inside a repository. Store writes
fail open: an unwritable store prints the digest with `raw -` and keeps going. Evidence:
`scripts/digest.mjs:166-195`.

## Digest rewrite hook

`digest-rewrite.mjs` is a `PreToolUse` Bash stage that turns an allowlisted simple command into
a digest run. It is opt-in and off everywhere. The hook does nothing unless `CODE_OPS_DIGEST`
holds `1`, `on`, or `true`, compared without regard to case. Any other value, unset and `off`
among them, exits `0` before the payload is read. A repository opts in through the `env` block
of its `.claude/settings.json`, and that is the only supported way. Evidence:
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
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:171-175`.

The hook states no permission decision. It returns `updatedInput` carrying the rewritten command
beside the rest of the tool input, plus one line of `additionalContext` naming where the raw
output lives. The installed host reassigns the tool input to the hook's `updatedInput` and only
then runs its permission evaluation, so the operator's own rules judge the rewritten command as
they judge any other `node` call. That moves the permission key: a rule written for `git`, `gh`,
or `sed` no longer matches the wrapped form, and a broad `node` allow rule admits it. An operator
who keeps command-specific deny or ask rules should mirror them for `node` before opting in.
With `CODE_OPS_DIGEST_STORE=off` the rewrite adds `--no-store`, so the digest keeps its
compression and its contract but writes no raw file and no receipt row. The default store slug
follows the directory the digest process started in, never a `--cwd` target. Version `2.1.257` of the host bundle under
`~/.local/share/claude/versions/` carries `case"hookUpdatedInput":Ie=Cn.updatedInput;break;` at
byte offset `188975121` and `await xPe($e,e,Ie,o,d,p,n)` at `188978021`, and the function that
call reaches returns `{decision:await d(n,r,o,p,y),input:r}` for a hook that decided nothing, at
offset `187458088`. Version `2.1.251` reassigns the same way at offset `186659765`. Because the
host re-evaluates, no `ask` is needed to put the rewritten command in front of the operator, and
the hook never returns `allow`. Evidence:
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:177-189` and
`evals/digest-hook/run.mjs:125-134`.

The hook fails open on every path. Bad JSON, a missing command, another tool, or any thrown
error exits `0` with no output. It never exits `2`, never blocks a call, and never spawns or
imports beyond three Node built-ins, because it runs in front of every Bash call. Evidence:
`plugins/code-ops-suite/hooks/digest-rewrite.mjs:160-191`.

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
and a binary file under `--range`; exit 2 covers a bad invocation. Evidence:
`scripts/skim.mjs:11-20`, `scripts/skim.mjs:112-120`, and `scripts/skim.mjs:234-251`.

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

- exact stage-0 Git-index blob bytes, no semantic index-to-worktree divergence, and exact classification;
- a 32 MiB maximum for each individual collection blob;
- consistent stored risk labels;
- current-risk rationale coverage;
- non-increasing risk counts;
- exact reviewed-candidate coverage within each applicable batch; and
- exact-once authority coverage across all immutable objects.

Incomplete history warns during ordinary checks. Strict verification treats it as infrastructure failure. Commit rewrites may change locator fields without invalidating authority. `sourceHead` never selects a verification mode. Protected repository review is the trust root for the unkeyed digest.

Failure ordering protects existing evidence first. Commands validate mode, clean state, complete history, and the existing baseline before candidate intake. They acquire the shared lock, then revalidate generated cleanliness, optimistic bindings, review, and history.

Commands build the complete mutation in memory after validation. One shared writer atomically replaces generated files, runs the complete semantic check, and rolls back every replacement on failure. The closing check includes the canonical manifest index snapshot, so shallow history cannot open a race. Commands prove the lock token and directory identity before authority writes and release.

Stale recovery quarantines the judged directory and compares its device and inode before deletion. A replacement lease is restored under an atomically reserved path and recovery fails. An ordinary release cleanup error preserves a durable success. Lost ownership exits 3 with a durable-mutation, do-not-retry message.

The clone-wide lock lives at `<git-common-dir>/code-ops-record-locks/<collectionUuid>.lock/owner.json`. Its owner stores `pid`, `token`, and `acquiredAt`. A live or recent owner fails with `collection mutation lock is held`. A dead owner at least ten minutes old is recoverable.

Adopted entries store `introducedCommit` for exact-path provenance. Inventory v2 and v3 add `baselineCommit` for citation resolution. Inventory v1 keeps `introducedCommit` and must not carry `baselineCommit`. Version 1 remains a readable legacy format without a review receipt. Protected review or an external anchor must distinguish a genuine grandfathered inventory from a newly authored downgrade.

Native records require YAML frontmatter containing `recordSchema: 1` and `supersedes: [...]`. The supersession value is a JSON array of full `REC-` IDs. Native append accepts only staged paths with no reachable exact-path history. Historically present records and newly immutable artifacts use reviewed incremental admission after genesis. Adopted records retain their original bytes and do not gain this schema.
