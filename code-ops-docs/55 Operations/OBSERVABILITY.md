---
type: reference
status: current
updated: 2026-09-03
---

# Observability

## Scope

Code-ops is a repository and marketplace, not a running product service. It has no application telemetry pipeline, metrics backend, trace collector, alert policy, or service-level objective in the current tree. This page records repository observability: which signals exist, what each one proves, and which of them blocks a merge.

## CI evidence

GitHub Actions is the primary operational signal. The `validate` workflow gives named job and step results for package shape, generated-output drift, dependency policy, vault conformance, and regression evals. The Ubuntu and Windows jobs both run the long-horizon runtime eval. A third job, `host-evals-macos`, runs the host-facing evals on the weekly schedule and on manual dispatch only, so a macOS-only regression surfaces within a week rather than never. Evidence: `.github/workflows/validate.yml:29-245`, `.github/workflows/validate.yml:244-267`, and `.github/workflows/validate.yml:269-439`.

The local review gate provides separate deep-review and OpSec signals before a pull request.
Its plan binds base SHA, HEAD SHA, binary diff, and changed paths. Its receipts bind reviewer,
tier, effort, report digest, verdict, and predecessor digest. Remote verification adds live base
and feature-tip evidence before status publication. Evidence:
`scripts/local-review-gate.mjs:131-259` and `scripts/local-review-gate.mjs:324-468`.

## Durable records

An orchestrated run records its plan in `RUN_CONTRACT.json`, work state in `DISPATCH_LEDGER.md`, acceptance in `ACCEPTANCE_LEDGER.md`, and successful completion in `RUN_CONTRACT_RESULT.json`. Evidence: `scripts/run-contract.mjs:221-241`.

The dispatch ledger stores a JSONL journal beside the Markdown table. The checker replays journal entries and detects malformed history, state drift, and retry-limit violations. Evidence: `scripts/dispatch-ledger.mjs:192-243` and `scripts/dispatch-ledger.mjs:379-429`.

The context compiler records exact-state receipts and cache payload digests. It rejects
hidden Git-index flags before preparing or replaying an identity, then verifies the receipt
before a context-bound contract or bundle can be used. Evidence:
`scripts/context-index-lib.mjs:67-110`, `225-277`, `scripts/run-contract.mjs:57-65`, and
`scripts/context-bundle.mjs:41-50`.

The long-horizon runtime records a host-capability binding and a hash-chained checkpoint log. It binds checkpoints to the contract, snapshot, stable prefix, and optional ledger, acceptance, handoff, bundle, and artifact references. Evidence: `scripts/runtime-lib.mjs:193-227`, `310-358`, and `scripts/run-runtime.mjs:159-218`.

Use `run-runtime.mjs metrics --json` to obtain receipt, checkpoint, resume, replan,
stable-prefix, prompt-cache, and receipt-size metrics. The default view includes only the
capability-descriptor digest, states, and policy outcomes, not raw host provenance. Elapsed
time is `UNKNOWN`, because the tool does not convert host wall-clock readings into a false
cross-session measure. Evidence: `scripts/runtime-lib.mjs:352-386` and
`scripts/run-runtime.mjs:340-358`.

`judgment-evals.mjs` records local judgment trend and floor-calibration plans and scoring
receipts. The plan and receipt expose whether execution was available, and workers receive no answer
key. Schedule the trend run weekly through local automation. Run floor calibration locally when
policy requires it. Both are model-quality measurements, not GitHub-hosted merge checks.

## Atlas freshness

Atlas is a durable cache of code-grounded judgment. `atlas-check.mjs` reports malformed, stale, or fresh sections and can make stale content a gate failure. Evidence: `scripts/atlas-check.mjs:301-437`.

Context bundles include an Atlas excerpt only when the matching section is fresh. This prevents stale prose from silently becoming agent context. Evidence: `scripts/context-bundle.mjs:58-74`.

## Performance evidence

The canonical [performance reference](PERFORMANCE.md) owns the measurement protocol, current baseline, retained optimizations, and known hot paths. A context-snapshot cache hit should reuse the content-addressed structural index. A cold run includes repository map, import graph, and Atlas work.

## Session and tool-output receipts

A `PreCompact` hook prints what a compaction summary must preserve, and the host reads that stdout as the compaction's custom instructions, so a resumed session does not redo work or lose a stated constraint. Evidence: `plugins/code-ops-suite/hooks/precompact-preserve.mjs:1-11`.

The `SessionEnd` hook `session-receipt.mjs` appends one row per session to a local ledger: exact tokens by class for the main thread and its subagents, tool calls by tool, model mix, wall time, and the switches that session ran under. It is on by default, prints nothing to the model, and fails open on every error. Evidence: `plugins/code-ops-suite/hooks/session-receipt.mjs:1-20`.

The `PreToolUse` hook `digest-rewrite.mjs` changes what a tool result looks like, and it is on by default. An allowlisted simple Bash command runs under `digest.mjs`, so the result the session sees is the compressed view: kept lines, an `[elided N lines: sed -n 'A,Bp' <raw path>]` marker for each region that went, and a closing trailer naming the exit code, the shape, the line counts before and after, and the raw file's sha256. The whole untouched output stays on disk at that raw path, under `~/.claude/code-ops/digest/<project slug>/<ISO date>/` by default, with one row per run in `DIGEST_RECEIPTS.jsonl` beside it. A command outside the contract arrives exactly as it always did. The [infrastructure reference](../50%20Platform/INFRASTRUCTURE.md) owns the off switch. Evidence: `plugins/code-ops-suite/hooks/digest-rewrite.mjs:1-41` and `scripts/digest.mjs:166-195`.

`context-audit.mjs` reads the same transcripts on demand and reports tokens, context characters by tool, Bash output by command family, and repeat reads, sanitized by default. `context-audit.mjs receipts --by-arm` reads the ledger instead and prints per-session means grouped by the switches each session ran under, which is how one mechanism's effect is read off two checkouts. The [measurements reference](MEASUREMENTS.md) owns the baseline rows and the method for adding one. The sanitization contract lives beside the family function. Evidence: `scripts/context-audit.mjs:1-18`, `scripts/context-audit.mjs:93-132`, and `scripts/transcript-lib.mjs:63-70`.

## Record-collection signals

`records check` reports record and citation counts, citation states, pending admissions, and history state. It blocks incomplete classification, incomplete batch coverage, immutable drift, malformed authority or curation chains, citation regression, invalid identities, and semantic-index drift.

Diagnose existing evidence before intake. History loss, broken receipts, and immutable drift take precedence over `pending-admission`. An empty incremental plan is a measured no-op, not a repair.

`history-unavailable` identifies checkout or object availability. `mutable-drifted` identifies current bytes that differ from pinned evidence. `evidence-lost` applies only after complete-history verification cannot recover the authoritative digest.

Generated inventories and indexes are bounded operational signals. Agents receive those projections by default and fetch a record body only by ID when a task needs it.

## Operator response

Treat a failed CI check, stale Atlas section, invalid snapshot, bundle budget marker, runtime binding drift, or unresolved acceptance criterion as a blocking signal. Reproduce the failure, repair the source, run the owning gate, and record the proof before merge.
