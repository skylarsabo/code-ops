---
type: reference
status: current
updated: 2026-08-24
---

# Observability

## Scope

Code-ops is a repository and marketplace, not a running product service. It has no application telemetry pipeline, metrics backend, trace collector, alert policy, or service-level objective in the current tree. This document records repository observability.

## CI evidence

GitHub Actions is the primary operational signal. The `validate` workflow gives named job and step results for package shape, generated-output drift, dependency policy, vault conformance, and regression evals. Evidence: `.github/workflows/validate.yml:23-150`.

The deep-review and OpSec workflows provide separate pull-request signals. Both use per-pull-request concurrency groups that cancel superseded reviews. Evidence: `.github/workflows/deep-review.yml:19-22` and `.github/workflows/opsec-gate.yml:19-22`.

## Durable records

An orchestrated run records its plan in `RUN_CONTRACT.json`, work state in `DISPATCH_LEDGER.md`, acceptance in `ACCEPTANCE.md`, and a successful completion in `RUN_RESULT.json`. Evidence: `scripts/run-contract.mjs:142-177` and `scripts/run-contract.mjs:188-230`.

The dispatch ledger stores a JSONL journal beside the Markdown table. The checker replays journal entries and detects malformed history, state drift, and retry-limit violations. Evidence: `scripts/dispatch-ledger.mjs:192-243` and `scripts/dispatch-ledger.mjs:379-429`.

The context compiler records exact-state receipts and cache payload digests. It verifies the receipt before a context-bound contract or bundle can be used. Evidence: `scripts/context-index-lib.mjs:140-205`, `scripts/run-contract.mjs:57-65`, and `scripts/context-bundle.mjs:41-50`.

## Atlas freshness

Atlas is a durable cache of code-grounded judgment. `atlas-check.mjs` reports malformed, stale, or fresh sections and can make stale content a gate failure. Evidence: `scripts/atlas-check.mjs:301-437`.

Context bundles include an Atlas excerpt only when the matching section is fresh. This prevents stale prose from silently becoming agent context. Evidence: `scripts/context-bundle.mjs:58-74`.

## Operator response

Treat a failed CI check, stale Atlas section, invalid snapshot, bundle budget marker, or unresolved acceptance criterion as a blocking signal. Reproduce the failure, repair the source, run the owning gate, and record the proof before merge.
