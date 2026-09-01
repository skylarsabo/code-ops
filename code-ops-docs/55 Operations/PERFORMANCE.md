---
type: reference
status: current
updated: 2026-09-01
---

# Performance

## Contract

Performance is a quality constraint for the repository and its generated plugins. Measure the real path before changing it. Retain an optimization only when repeatable evidence shows a material improvement and the owning regression eval preserves behavior.

Optimize end-to-end operator latency, agent context bytes, child-process count, filesystem work, and CI feedback time. Prefer removing work, reusing exact results, and narrowing inputs at authority boundaries. Do not trade away correctness, validation coverage, deterministic output, or readable control flow.

The long-horizon runtime uses a bounded stable prefix for cache-ready prompt input. It records cache events and token counts only when the host exposes them. Keep unsupported or unobservable cache data explicit. Evidence: `scripts/runtime-lib.mjs:17-22`, `148-174`, and `291-309`.

## Measurement protocol

Use the zero-dependency cross-platform runner:

```text
node scripts/benchmark-command.mjs --runs 7 --warmup 1 --json -- <executable> [args ...]
```

The runner executes without a shell. Pass an executable interpreter explicitly for shell aliases or Windows `.cmd` and `.bat` shims. This keeps argument boundaries predictable on every host. The report records raw wall-time samples, median, p95, range, timeout, working-directory mode, Node version, operating system, architecture, and logical CPU count. It bounds repeats and per-run timeout. A failed or timed-out executable fails the measurement.

Record the Git revision, visible working-tree state, input or fixture identity, and cold or warm cache state beside the result. Compare the same command and state. Host-sensitive wall time is diagnostic evidence, not a universal service-level objective.

## Current measurements

The 2026-08-26 Windows baseline used Node v24.16.0 on x64 with 32 logical CPUs at revision `41c5fc9`. The repository held 891 tracked files.

| Path | Protocol | Result |
| --- | --- | ---: |
| Repository map | 7 measured runs, 1 warmup | 310.004 ms median |
| Import graph | 7 measured runs, 1 warmup | 204.457 ms median |
| Atlas check, baseline implementation | 7 measured runs, 1 warmup | 1,694.947 ms median |
| Atlas check, optimized implementation | 7 measured runs, 1 warmup | 1,264.359 ms median |

The map and graph commands were `node scripts/repo-map.mjs --root . --out NUL` and `node scripts/import-graph.mjs --root . --out NUL` in the clean baseline worktree. Their raw samples in milliseconds were `[300.637, 317.448, 313.255, 308.345, 310.004, 307.945, 323.077]` and `[207.235, 204.457, 181.915, 202.929, 207.366, 197.281, 214.284]`.

The Atlas comparison ran both implementations against the same seven freshly digest-stamped sections in the candidate worktree based on `41c5fc9`. The baseline command loaded `scripts/atlas-check.mjs` from the clean baseline worktree; the candidate command loaded it from the staged candidate and passed the same explicit candidate `--atlas` and `--root` paths. Baseline samples were `[1711.692, 1674.193, 1704.833, 1694.947, 1648.573, 1713.567, 1689.172]`. Candidate samples were `[1297.810, 1268.396, 1253.024, 1256.069, 1315.157, 1244.291, 1264.359]`.

Atlas was the dominant exploratory component of a cold context snapshot. Reusing the tracked paths already returned by each digest query and caching repeated immutable revision pins reduced the explicit-root seven-section check used by context snapshots from 44 Git subprocesses to 33. The matched median fell 25.4%. `atlas-check check --stats` exposes the deterministic process count, and its regression eval pins the optimized two-section fixture at 13 calls.

Exploratory measurements also observed a 321.0 ms warm context-snapshot median, a 316.0 ms verification median, one 2,297.3 ms cold snapshot, and one 216.40 s record-collection eval. They are routing leads, not conformance baselines: their raw samples or comparable cold-state preparation were not retained. An unretained CPU profile suggested that record-eval process startup deserves the next investigation. Retain no change there until a separate isolation design preserves every platform case, history shape, failure distinction, and zero-output refusal guarantee.

## Regression policy

- Benchmark a stable command at least seven times after one warmup when the runtime is short enough.
- Separate cold-cache and warm-cache results.
- Prefer deterministic structural budgets, such as child-process counts and context-byte ceilings, over fragile machine-wide time limits.
- Keep runtime elapsed time as `UNKNOWN` unless one monotonic source measures it across the complete run.
- Require failing-then-passing regression proof for changed behavior.
- Preserve the full case count when optimizing an eval or CI path.
- Revert a speculative optimization that has no material repeatable effect.

Operations exposes the current signals in [OBSERVABILITY.md](OBSERVABILITY.md). Engineering policy lives in [ENGINEERING_STANDARDS.md](../40%20Engineering/ENGINEERING_STANDARDS.md).
