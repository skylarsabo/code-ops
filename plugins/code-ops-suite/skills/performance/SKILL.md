---
description: "Use when something is measurably slow or you want hot paths optimized with proof; profiles first. For broad behavior-preserving measured wins, see rigor:improve-measured."
disable-model-invocation: true
---

# PERFORMANCE OPTIMIZATION — Measure, Optimize, Verify

**Invoked as `/code-ops-suite:performance`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** IMPLEMENT · **Produces:** optimizations (each commit carries before/after numbers), `PERFORMANCE_REPORT.md`; remaining opportunities → `FINDINGS_REGISTER.md`.

A **measurement-driven** pass. **Prime directive: measure first.** Never optimize code not demonstrated to be hot. Every optimization is (1) confirmed hot by profiling, (2) proven faster by a benchmark, and (3) verified behavior-preserving by tests. A tempting-but-cold target is documented as "not worth it — here's the data," not optimized.

## Phase 0 — Baseline  *(checkpoint)*
Identify the perf-critical paths (user-facing latency, throughput hot loops, memory, bundle size, cold start, build/CI time). Set up repeatable **profiling + benchmarks** and capture **baseline numbers**. Profile under realistic load/data and rank hot spots by actual cost. Ingest any audit perf findings as leads.
> **CHECKPOINT:** present baseline numbers, profiled hot spots ranked by cost, and a proposed order; confirm priorities and any acceptable-complexity limits.

## Phase 1 — Optimize (fan out per hot path)
Where profiling points: reduce **algorithmic** complexity; fix **data access** (N+1, indexes [with OK], batching, pagination, caching with correct invalidation and bounds — never cache sensitive data in a way that creates a leak); **concurrency** (parallelize, remove blocking); **memory/allocation**; **payload/serialization** size; **frontend** (code-split, trim heavy deps, fix render thrash, optimize assets — measure with the UI tool); **build/CI**. Method per optimization: confirm hot → smallest change → benchmark before/after → tests green → commit with the delta. If a change doesn't move the number, revert it.

## Guardrails
Behavior preservation is non-negotiable (`CONVENTIONS §4`). Never sacrifice correctness, security, or privacy for speed. Don't micro-optimize cold paths or add complexity disproportionate to the gain without sign-off.

## Deliverables
The optimizations (each with before/after numbers in the message); **`PERFORMANCE_REPORT.md`** (baseline→after per area with the actual measurements, what was optimized and how, what was left and the data showing why, and the reproducible measurement setup); remaining design/behavior-changing opportunities → `FINDINGS_REGISTER.md`.

## Done when
Every targeted hot path is optimized-with-proof or documented-as-not-worth-it; all changes preserve behavior (tests green) and the security/privacy posture; improvements are measured and reproducible; report complete. Present the report, biggest measured wins first.
