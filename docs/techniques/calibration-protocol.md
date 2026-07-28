# Calibration protocol

`/code-ops-suite:calibration-run` measures the suite against a real, non-toy codebase —
something the small evals fixtures under `evals/` cannot do, since they saturate at
toy scale. This page is the protocol it follows: the one-way channel rule, the run
design, the metrics it extracts, and the sanitized-note template it validates before
anything crosses back into this repo.

## The one-way channel

A calibration target is someone's real repository. Its file names, code, structure,
and defects are **never** quoted back here — only a sanitized note (counts, deltas,
lessons) returns. This mirrors `evals/README.md`'s real-scale calibration channel:
the target repo's internals stay on that side; only aggregate numbers and prose
lessons cross. `calibration-metrics.mjs --validate-note` is the mechanical floor
under this rule — it fails closed on a path, code fence, URL, or email in the note.

## Run design

- **Fresh, isolated session.** No other repo's context bleeds into the calibration
  run; Phase 0 of `calibration-run` confirms this before dispatching anything.
- **Assess-only first.** The baseline sweep runs `assess-only` — read + document, no
  code changes on the target — so a calibration run never mutates someone else's
  repo as a side effect of measuring the suite.
- **Comparative, not absolute.** A single run's numbers mean little alone; every
  note reports deltas against the prior `evals/CALIBRATION_TABLE.md` row for the
  same or a comparable target class, not a bare snapshot.

## Comparing CONFIRMED ratios

Compare a run's CONFIRMED ratio **within its own track only** (assess-only vs.
assess-only, the same target class against itself over time). An assess-only
calibration run structurally cannot execute a repro — no code changes on the target —
so it cannot promote a finding past PROBABLE the way an IMPLEMENT-mode run can.
Comparing an assess-only CONFIRMED ratio against a full-rigor or IMPLEMENT-mode run's
ratio measures the track's ceiling, not the suite's quality, and misleads.

## Artifact shapes

The three run artifacts this protocol measures — `DISPATCH_LEDGER.md`,
`FINDINGS_REGISTER.md`, `REFUTATION_LOG.md` — must conform to the grammars in
[artifact-grammars.md](artifact-grammars.md). `calibration-metrics.mjs` warns when a
present, non-empty artifact parses to zero items; check the shape before assuming
there's nothing to report.

## What gets measured

| Axis | Metrics |
| --- | --- |
| Quality | CONFIRMED ratio (CONFIRMED ÷ total findings), refutation survival rate, severity mix (critical/high/medium/low/nit counts) |
| Tokens | dispatch count × model tier × reasoning effort, artifact sizes (lines per register/report) |
| Orchestration | dangling-dispatch rate, failed-dispatch rate, redispatch rate (from `DISPATCH_LEDGER.md`) |
| Standardization | enforcements added (new lint/gate checks the run's findings drove), traceless-scan clean rate |

## The sanitized-note template

```
## Calibration note — <suite>@<version> — <YYYY-MM-DD>

Target: <generic label, e.g. "mid-size backend service", never the repo name>

Quality: CONFIRMED ratio <x>, refutation survival <x>, severity mix <c/h/m/l/n>
Tokens: <n> dispatches (<tier mix>), artifact sizes <summary>
Orchestration: dangling <x>, failed <x>, redispatched <x>
Standardization: enforcements added <n>, traceless clean rate <x>

Deltas vs prior row: <what moved and by how much>
Lessons: <what this run taught, in prose, no code/paths/URLs>
```

No paths, code fences, or URLs anywhere in a filled note — those are exactly what
`calibration-metrics.mjs --validate-note` scrubs for and fails closed on.

## Optional: defect seeding

To also measure recall on a real target (not just cost/orchestration), seed a small,
known set of planted defects before the baseline sweep — mirroring the toy fixtures'
planted-bug approach at real scale — and fold recall into the quality axis above.
Seeding is optional because it requires write access to the target and is itself a
behavior-changing act; skip it for a pure cost/orchestration calibration.

*Verified-at: 09df64b*
