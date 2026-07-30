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
  note reports deltas against the prior row for the same or a comparable target class,
  not a bare snapshot — read them from the rendered `evals/CALIBRATION_TABLE.md` or from
  `calibration-graph.mjs query trend`.

## Comparing CONFIRMED ratios

Compare a run's CONFIRMED ratio **within its own track only** (assess-only vs.
assess-only, the same target class against itself over time).

**Assess-only caps remediation, not reproduction.** An earlier version of this page
claimed an assess-only run structurally cannot execute a repro and therefore cannot
promote a finding past PROBABLE. The 2026-07-29 calibration run disproved that: four
findings reached CONFIRMED under assess-only, via repro scripts written **outside** the
target tree and a **failing read-only gate run** against the target. The rule the track
actually imposes is *no code changes on the target* — operatives may execute against
the target read-only, and may build and run reproductions anywhere outside it. Do not
tier a finding down to PROBABLE merely because the track is assess-only; tier it on the
evidence that exists.

The within-track-only comparison rule stays, on the honest rationale: tracks differ in
**remediation affordances** (an IMPLEMENT-mode run can patch, re-run, and bisect in
place) and in **typical reproduction depth** (an assess-only run reaches for the
out-of-tree repro only where it is cheap). So a cross-track ratio comparison still
measures the track rather than the suite, and still misleads — just for reasons of
affordance and habit, not structural impossibility.

## Artifact shapes

The three run artifacts this protocol measures — `DISPATCH_LEDGER.md`,
`FINDINGS_REGISTER.md`, `REFUTATION_LOG.md` — must conform to the grammars in
[artifact-grammars.md](artifact-grammars.md). `calibration-metrics.mjs` warns when a
present, non-empty artifact parses to zero items; check the shape before assuming
there's nothing to report.

## What gets measured

| Axis | Metrics |
| --- | --- |
| Quality | CONFIRMED ratio (CONFIRMED ÷ total findings), refutation survival rate, **paneled coverage** (paneled of panel-eligible), severity mix (critical/high/medium/low/nit counts) |
| Tokens | dispatch count × model tier × reasoning effort, **CONFIRMED per 100k operative tokens**, artifact sizes (lines per register/report) |
| Orchestration | dangling-dispatch rate, failed-dispatch rate, redispatch rate (from `DISPATCH_LEDGER.md`) |
| Standardization | enforcements added (new lint/gate checks the run's findings drove), traceless-scan clean rate |
| Coverage | **slice coverage** — slices swept, of those the covered-negative count, and slices left unswept |

The three additions each close a hole a real run fell into:

- **Paneled coverage** — the paneled denominator shrank across runs (3, then 6, then 1)
  with nobody able to see it, so a survival rate rose while the panel practice decayed.
  Report `paneled of panel-eligible`, never a bare rate.
- **CONFIRMED per 100k operative tokens** — token totals and finding counts sat in
  different cells, so "was this run worth its spend" had no answer. One number per run
  makes cost per real finding comparable within a track.
- **Slice coverage** — a well-formed zero-finding slice was indistinguishable from a
  dispatch that failed. Counting swept slices and covered negatives (the `NO-FINDINGS:`
  lines of [artifact-grammars.md](artifact-grammars.md)) separates *examined and clean*
  from *never examined*.

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

## Machine block

run-date: YYYY-MM-DD
suite: <plugin>@<semver> [, more]
target-class: <kebab-slug>; control: yes|no
track: assess-only|implement
findings: N; confirmed: N
paneled: N of M eligible; survived: N; repro-exempt: N (or: N of unknown eligible)
severity: c/h/m/l/n as N/N/N/N/N (or: unknown)
tokens: N operative; dispatches: N (or: unknown operative)
orchestration: dangling N; failed N; redispatched N
standardization: enforcements N; traceless clean|dirty
coverage: covered-negatives N; slices swept N of M (or: unknown)
lesson: recur L-NNN
lesson: new <instrument|suite|protocol> — <statement>
```

No paths, code fences, or URLs anywhere in a filled note — those are exactly what
`calibration-metrics.mjs --validate-note` scrubs for and fails closed on. That applies
to the Machine block too: it is **line-based prose, not a code block** — no fences
around it, and no paths inside it.

The Machine block is what `calibration-graph.mjs ingest` parses into a run document, so
its shapes are load-bearing. `--validate-note` fails closed on a note **missing** the
`## Machine block` section (a note written against the older template no longer
validates), and on any present line that does not match its shape grammar above. New
lessons get their `L-NNN` id assigned at ingest, so the note writes the statement, not
the id; a recurrence cites the existing id. The block adds no leak surface — counts,
kebab slugs, and enum words only — and still passes through every existing scrub.

## Recording a run

A validated note is not the record — the run document is. Four steps, in order:

1. **Validate the note** — `calibration-metrics.mjs --validate-note <note>`; fail-closed
   on a leak or a malformed Machine block. Nothing downstream runs on an unvalidated note.
2. **Ingest** — `calibration-graph.mjs ingest --note <note>` writes
   `evals/calibration/runs/R-NNN.json` and appends any new lessons to `lessons.json`.
   It refuses to overwrite an existing run document.
3. **Render** — `calibration-graph.mjs render` regenerates `evals/CALIBRATION_TABLE.md`.
   The table is a **derived view**; it is never hand-edited, and CI's `render --check`
   fails the build on drift.
4. **Validate the graph** — `calibration-graph.mjs validate` fails closed on a broken
   schema, id, or edge endpoint before the store is committed.

Edges (`fixed-in`, `enforced-by`, `verified-in`, `deferred`, `supersedes`) are written
when the follow-up work lands, not at ingest — a lesson enters the store open and is
closed by the PR, eval, or gate that answers it. The store lives on this side of the
one-way channel and holds only data that already crossed it as a sanitized note; the
channel rule above is unchanged by any of this. Schemas, edge vocabulary, derived
metrics, and the query cookbook: [calibration-graph.md](calibration-graph.md).

## Optional: defect seeding

To also measure recall on a real target (not just cost/orchestration), seed a small,
known set of planted defects before the baseline sweep — mirroring the toy fixtures'
planted-bug approach at real scale — and fold recall into the quality axis above.
Seeding is optional because it requires write access to the target and is itself a
behavior-changing act; skip it for a pure cost/orchestration calibration.

*Verified-at: 09df64b*
