---
type: reference
status: current
updated: 2026-09-01
---

# Observability

## Scope

Code-ops is a repository and marketplace, not a running product service. It has no application telemetry pipeline, metrics backend, trace collector, alert policy, or service-level objective in the current tree. This document records repository observability.

## CI evidence

GitHub Actions is the primary operational signal. The `validate` workflow gives named job and step results for package shape, generated-output drift, dependency policy, vault conformance, and regression evals. Both operating-system jobs run the long-horizon runtime eval. Evidence: `.github/workflows/validate.yml:23-154` and `220-313`.

The local review gate provides separate deep-review and OpSec signals before a pull request.
Its plan binds base SHA, HEAD SHA, binary diff, and changed paths. Its receipts bind reviewer,
tier, effort, report digest, verdict, and predecessor digest. Remote verification adds live base
and feature-tip evidence before status publication. Evidence:
`scripts/local-review-gate.mjs:147-275` and `scripts/local-review-gate.mjs:340-484`.

## Durable records

An orchestrated run records its plan in `RUN_CONTRACT.json`, work state in `DISPATCH_LEDGER.md`, acceptance in `ACCEPTANCE_LEDGER.md`, and successful completion in `RUN_CONTRACT_RESULT.json`. Evidence: `scripts/run-contract.mjs:221-241`.

The dispatch ledger stores a JSONL journal beside the Markdown table. The checker replays journal entries and detects malformed history, state drift, and retry-limit violations. Evidence: `scripts/dispatch-ledger.mjs:192-243` and `scripts/dispatch-ledger.mjs:379-429`.

The context compiler records exact-state receipts and cache payload digests. It verifies the receipt before a context-bound contract or bundle can be used. Evidence: `scripts/context-index-lib.mjs:140-205`, `scripts/run-contract.mjs:57-65`, and `scripts/context-bundle.mjs:41-50`.

The long-horizon runtime records a host-capability binding and a hash-chained checkpoint log. It binds checkpoints to the contract, snapshot, stable prefix, and optional ledger, acceptance, handoff, bundle, and artifact references. Evidence: `scripts/runtime-lib.mjs:183-215`, `300-346`, and `scripts/run-runtime.mjs:159-218`.

Use `run-runtime.mjs metrics --json` to obtain receipt, checkpoint, resume, replan, stable-prefix, prompt-cache, and receipt-size metrics. Elapsed time is `UNKNOWN`; the tool does not convert host wall-clock readings into a false cross-session measure. Evidence: `scripts/runtime-lib.mjs:353-384` and `scripts/run-runtime.mjs:340-358`.

`judgment-evals.mjs` records local judgment trend and floor-calibration plans and scoring
receipts. The plan and receipt expose whether execution was available; workers receive no answer
key. Schedule trend weekly through local Codex automation. Run floor calibration locally when
policy requires it. These are model-quality measurements, not GitHub-hosted merge checks.

## Atlas freshness

Atlas is a durable cache of code-grounded judgment. `atlas-check.mjs` reports malformed, stale, or fresh sections and can make stale content a gate failure. Evidence: `scripts/atlas-check.mjs:301-437`.

Context bundles include an Atlas excerpt only when the matching section is fresh. This prevents stale prose from silently becoming agent context. Evidence: `scripts/context-bundle.mjs:58-74`.

## Performance evidence

The canonical [performance reference](PERFORMANCE.md) owns the measurement protocol, current baseline, retained optimizations, and known hot paths. A context-snapshot cache hit should reuse the content-addressed structural index; a cold run includes repository map, import graph, and Atlas work.

## Record-collection signals

`records check` reports record and citation counts, citation states, pending admissions, and history state. It blocks incomplete classification, incomplete batch coverage, immutable drift, malformed authority or curation chains, citation regression, invalid identities, and semantic-index drift.

Diagnose existing evidence before intake. History loss, broken receipts, and immutable drift take precedence over `pending-admission`. An empty incremental plan is a measured no-op, not a repair.

`history-unavailable` identifies checkout or object availability. `mutable-drifted` identifies current bytes that differ from pinned evidence. `evidence-lost` applies only after complete-history verification cannot recover the authoritative digest.

Generated inventories and indexes are bounded operational signals. Agents receive those projections by default and fetch a record body only by ID when a task needs it.

## Operator response

Treat a failed CI check, stale Atlas section, invalid snapshot, bundle budget marker, runtime binding drift, or unresolved acceptance criterion as a blocking signal. Reproduce the failure, repair the source, run the owning gate, and record the proof before merge.
