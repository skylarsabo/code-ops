---
name: performance
description: "Use when something is measurably slow or you want hot paths optimized with proof. It profiles first. For broad behavior-preserving measured wins, see rigor:improve-measured."
---

# Performance optimization: measure, optimize, verify

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:performance`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section.
**Mode:** IMPLEMENT · **Produces:** optimizations, each commit carrying before-and-after numbers,
plus `PERFORMANCE_REPORT.md`. Remaining opportunities go to `FINDINGS_REGISTER.md`.

This is a **measurement-driven** pass, and the prime directive is to measure first. Never
optimize code that has not been demonstrated hot. Every optimization is confirmed hot by
profiling, proven faster by a benchmark, and verified behavior-preserving by tests. Document a
tempting but cold target as not worth it, with the data, rather than optimizing it.

## Phase 0: the baseline  *(checkpoint)*

Identify the performance-critical paths: user-facing latency, throughput hot loops, memory,
bundle size, cold start, and build or CI time. Set up repeatable **profiling and benchmarks**,
and capture the **baseline numbers**. Profile under realistic load and data, and rank the hot
spots by actual cost. Ingest any performance findings from an earlier audit as leads.

> **CHECKPOINT:** present the baseline numbers, the profiled hot spots ranked by cost, and a proposed order. Confirm the priorities and any acceptable-complexity limits.

## Phase 1: the optimization

Dispatch an ephemeral implementation operative per hot path, with conflict-aware fan-out
(`CONVENTIONS §1`). Work only where the profiling points, across these targets:
- **Algorithmic complexity**, reduced.
- **Data access**: N+1 queries, indexes with approval, batching, pagination, and caching with correct invalidation and bounds. Never cache sensitive data in a way that creates a leak.
- **Concurrency**: parallelize, and remove blocking.
- **Memory and allocation.**
- **Payload and serialization size.**
- **Frontend**: code-split, trim heavy dependencies, fix render thrash, and optimize assets, measured with the UI tool.
- **Build and CI time.**

The method per optimization: confirm the path is hot, make the smallest change, benchmark before
and after, get the tests green, then commit with the delta. When a change does not move the
number, revert it.

## The guardrails

Behavior preservation is non-negotiable (`CONVENTIONS §4`). Never sacrifice correctness,
security, or privacy for speed. Do not micro-optimize cold paths. Do not add complexity
disproportionate to the gain without sign-off.

## Deliverables

- The optimizations, each with before-and-after numbers in the commit message.
- **`PERFORMANCE_REPORT.md`**: the baseline against the after state per area with the actual measurements, what was optimized and how, what was left alone with the data showing why, and the reproducible measurement setup.
- Remaining design or behavior-changing opportunities, routed to `FINDINGS_REGISTER.md`.

## Done when

- Every targeted hot path is either optimized with proof or documented as not worth it.
- All changes preserve behavior with tests green, and preserve the security and privacy posture.
- The improvements are measured and reproducible, and the report is complete.
- The report is presented with the biggest measured wins first.
