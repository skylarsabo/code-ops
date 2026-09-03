# Calibration protocol

This page is the protocol `/code-ops-suite:calibration-run` follows when it measures the
suite against a real codebase. Read it before running a calibration or writing a note. It
covers the one-way channel rule, the run design, the metrics, and the sanitized-note
template the run validates before anything crosses back into this repo.

`/code-ops-suite:calibration-run` measures the suite against a real, non-toy codebase,
which the small fixtures under `evals/` cannot do, because they saturate at toy scale.

## The one-way channel

A calibration target is someone's real repository. Its file names, code, structure, and
defects are never quoted back here. Only a sanitized note returns, carrying counts, deltas,
and lessons. That mirrors the real-scale calibration channel in `evals/README.md`: the
target repo's internals stay on that side, and only aggregate numbers and prose lessons
cross. `calibration-metrics.mjs --validate-note` is the mechanical floor under the rule. It
fails closed on a path, code fence, URL, or email in the note. Reach the script as
`co calibrate metrics`.

## Run design

- **Fresh, isolated session.** No other repo's context bleeds into the calibration run, and
  Phase 0 of `calibration-run` confirms that before dispatching anything.
- **Assess-only first.** The baseline sweep runs `assess-only`, meaning read and document
  with no code changes on the target, so a calibration run never mutates someone else's
  repo as a side effect of measuring the suite.
- **The atlas leg.** If the target keeps an atlas ([atlas.md](atlas.md)), run `co atlas
  check` at run start. Hand each section's FRESH or STALE state into the sweep briefs
  alongside the repo-map pointer, because a FRESH section is consumed as truth and a STALE
  one is a lead. Refresh the STALE sections during the run, in the session that has the
  context, rather than deferring them. If the target keeps no atlas, `init` one as part of
  the run, since the sweep has just derived the understanding the atlas exists to bank.
- **Falsified sections are findings about the instrument.** A section is falsified when the
  sweep disproves one of its claims, not merely when the code moved under it, which is
  ordinary staleness. A falsified section means a run was handed a false premise, so it
  feeds a `lesson:` line under the existing classes. Use `instrument` when the atlas
  workflow produced the false claim, and `protocol` when the doctrine around consuming it
  did.
- **Comparative, not absolute.** A single run's numbers mean little alone. Every note
  reports deltas against the prior row for the same or a comparable target class, never a
  bare snapshot. Read them from the rendered `evals/CALIBRATION_TABLE.md`, or from
  `calibration-graph.mjs query trend`.

## Comparing CONFIRMED ratios

Compare a run's CONFIRMED ratio within its own track only: assess-only against assess-only,
the same target class against itself over time.

**Assess-only caps remediation, not reproduction.** An earlier version of this page claimed
an assess-only run structurally cannot execute a repro and therefore cannot promote a
finding past PROBABLE. The 2026-07-29 calibration run disproved that. Four findings reached
CONFIRMED under assess-only, through repro scripts written outside the target tree and a
failing read-only gate run against the target. The rule the track actually imposes is no
code changes on the target. Operatives may execute against the target read-only, and may
build and run reproductions anywhere outside it. Do not tier a finding down to PROBABLE
merely because the track is assess-only. Tier it on the evidence that exists.

The within-track-only comparison rule stays, on the honest rationale. Tracks differ in
remediation affordances, because an IMPLEMENT-mode run can patch, re-run, and bisect in
place. They also differ in typical reproduction depth, because an assess-only run reaches
for the out-of-tree repro only where it is cheap. So a cross-track ratio comparison still
measures the track rather than the suite, and still misleads, for reasons of affordance and
habit rather than structural impossibility.

## Artifact shapes

Five run artifacts this protocol measures must conform to the grammars in
[artifact-grammars.md](artifact-grammars.md): `DISPATCH_LEDGER.md`,
`FINDINGS_REGISTER.md`, `REFUTATION_LOG.md`, `CONFORMANCE_REPORT.md`, and
`RUN_CONFORMANCE.md`. `calibration-metrics.mjs` warns when a present, non-empty artifact
parses to zero items. Check the shape before assuming there is nothing to report.

## Conformance snapshots

Standardization used to be measured only as enforcements added, a count of what a run
built and never a measure of what had drifted. Two conformance snapshots close that gap,
and both belong to every run's ingest rather than a separate exercise:

- **`CONFORMANCE_REPORT.md`**: the target's standardization surfaces, per
  [artifact-grammars.md](artifact-grammars.md) `(d)`, produced by `/code-ops-suite:conform`
  in assess-only mode.
- **`RUN_CONFORMANCE.md`**: the run's own orchestration discipline, per that page's `(e)`,
  produced by `/code-ops-suite:run-cost-audit` over the finished artifact folder.

`calibration-metrics.mjs` parses both, so three drift metrics become a time series:

| Metric | Definition |
| --- | --- |
| drift rate | surfaces not CONFORMANT, of surfaces assessed |
| repair latency | runs between a surface first reading DRIFTED and its first CONFORMANT |
| post-enforcement recurrence | a surface drifting again after an `enforced-by` edge closed its lesson |

Read the third one as a defect in the gate, not in the repo. An enforcement that a later
run drifts past has a hole in it, so the repair belongs in the check rather than in another
round of manual repair.

**Re-derivation waste belongs to `run-cost-audit`, not here.** The cost of a run rebuilding
understanding that a conformant artifact already held is an orchestration cost, and
splitting it across two skills would produce two numbers for one fact.

Between sessions, the detection cadence is a scheduled assess-only `conform` run against
each repo on the standard. Assess-only, because a scheduled run has no developer at its
checkpoint, and a repair nobody approved is exactly the change a schedule must not make.
Its output crosses the one-way channel under the unchanged rule above: counts and enum
verdicts return, and target internals never do.

## What gets measured

| Axis | Metrics |
| --- | --- |
| Quality | CONFIRMED ratio (CONFIRMED ÷ total findings), refutation survival rate, **paneled coverage** (paneled of panel-eligible), severity mix (critical/high/medium/low/nit counts) |
| Tokens | dispatch count × model tier × reasoning effort, **CONFIRMED per 100k operative tokens**, artifact sizes (lines per register/report) |
| Orchestration | dangling-dispatch rate, failed-dispatch rate, redispatch rate (from `DISPATCH_LEDGER.md`) |
| Standardization | enforcements added (new lint/gate checks the run's findings drove), traceless-scan clean rate, **drift rate** from the conformance snapshot |
| Coverage | **slice coverage**: slices swept, of those the covered-negative count, and slices left unswept |
| Atlas | sections in the target's atlas, of those the count consumed FRESH, the count refreshed during the run, and the count the run falsified |
| Configuration | the orchestration the run was driven under: the lead's model class, and the class its operatives ran at |

Three of those axes each close a hole a real run fell into:

- **Paneled coverage.** The paneled denominator shrank across runs, from 3 to 6 to 1, with
  nobody able to see it, so a survival rate rose while the panel practice decayed. Report
  paneled of panel-eligible, never a bare rate.
- **CONFIRMED per 100k operative tokens.** Token totals and finding counts sat in different
  cells, so "was this run worth its spend" had no answer. One number per run makes cost per
  real finding comparable within a track.
- **Slice coverage.** A well-formed zero-finding slice was indistinguishable from a dispatch
  that failed. Counting swept slices and covered negatives, the `NO-FINDINGS:` lines of
  [artifact-grammars.md](artifact-grammars.md), separates examined and clean from never
  examined.

## The sanitized-note template

```
## Calibration note: <suite>@<version>, <YYYY-MM-DD>

Target: <generic label, e.g. "mid-size backend service", never the repo name>

Quality: CONFIRMED ratio <x>, refutation survival <x>, severity mix c/h/m/l/n as <N/N/N/N/N>
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
atlas: sections N; fresh N; refreshed N; falsified N (optional)
config: lead <model-class>; operatives <model-class> (optional; a mid-run handover plus-separates the lead classes in order)
host: <kebab-slug> (optional; the harness: claude-code, codex, grok-build, opencode)
lesson: recur L-NNN
lesson: new <instrument|suite|protocol> — <statement>
```

A filled note carries no paths, code fences, or URLs anywhere. Those are exactly what
`calibration-metrics.mjs --validate-note` scrubs for and fails closed on. The rule covers
the Machine block too. The block is line-based prose rather than a code block, so write no
fences around it and no paths inside it.

Write the severity mix only in the `c/h/m/l/n as N/N/N/N/N` form, in the prose half as well
as the Machine block. A bare `0/6/22/9/10` is five slash-separated segments, and the path
detector reads it as a unix path, so an earlier template shape made a note written exactly
to template fail closed. The fixed `c/h/m/l/n as` head is pre-filtered public vocabulary
the scrub already allows. The scrub itself is unchanged and no less strict.

The Machine block is what `calibration-graph.mjs ingest` parses into a run document, so its
shapes are load-bearing. `--validate-note` fails closed on a note missing the
`## Machine block` section, so a note written against the older template no longer
validates. It also fails on any present line that does not match its shape grammar above.
New lessons get their `L-NNN` id assigned at ingest, so the note writes the statement
rather than the id, and a recurrence cites the existing id. The block adds no leak surface,
carrying counts, kebab slugs, and enum words only, and it still passes through every
existing scrub.

### The optional metric lines

The `atlas:` and `config:` lines are optional. A note without either validates and ingests
exactly as before, since the runs recorded before those legs existed have none. A note
carrying `atlas:` must carry all four counts. Both sides refuse `fresh + refreshed`
exceeding `sections`, and refuse `falsified` exceeding it, because those are arithmetic
that went wrong upstream rather than a measurement. Section counts cross the channel.
Section names, scopes, and prose never do.

The `config:` line records the run's orchestration in kebab model-class slugs: the lead
that planned and judged, and the tier its operatives ran at, as in
`config: lead fable-5; operatives opus-5`. It is what makes one run's numbers comparable to
another's rather than merely sequential, so a run comparing configurations must carry it.
Absence means not recorded. A run doc omits the field rather than defaulting one, since a
guessed lead class would silently mis-group a comparison. Model classes are public
vocabulary, so the line adds no leak surface, and no version string, endpoint, or session
id crosses on it.

A lead that changed mid-run records every lead class in order, plus-separated, as in
`config: lead fable-5+opus-5; operatives opus-5`, rather than omitting the field. A
handover after a safety-classifier interruption left the session to be recovered under
another class is the case this covers. The order is the order they held the session, first
class first, and the run doc stores it as that one string. Only the lead may split.
`operatives` stays a single class, since the tier is pinned per dispatch for the whole run.
The single-lead form is the canonical one. The split exists so an honest handover is
expressible, not as an alternative way to write an ordinary run.

## Recording a run

A validated note is not the record. The run document is. Five steps, in order:

1. **Validate the note.** Run `calibration-metrics.mjs --validate-note <note>`, which fails
   closed on a leak or a malformed Machine block. Nothing downstream runs on an unvalidated
   note.
2. **Ingest.** Run `calibration-graph.mjs ingest --note <note>`, which writes
   `evals/calibration/runs/R-NNN.json` and appends any new lessons to `lessons.json`. It
   refuses to overwrite an existing run document.
3. **Render.** Run `calibration-graph.mjs render`, which regenerates
   `evals/CALIBRATION_TABLE.md`. The table is a derived view. It is never hand-edited, and
   CI's `render --check` fails the build on drift.
4. **Validate the graph.** Run `calibration-graph.mjs validate`, which fails closed on a
   broken schema, id, or edge endpoint before the store is committed.
5. **Sync the eval.** `evals/calibration-graph/run.mjs` runs against the real store and
   hardcodes its answers: store counts, the open and recurrent lesson sets, per-run trend
   lines, and the run id a scratch ingest mints. Update those expectations by hand, then run
   `node evals/calibration-graph/run.mjs` until it exits 0. No expectation generator exists.
   Skipping this step passes every other gate and fails only in CI.

Edges are written when the follow-up work lands, not at ingest: `fixed-in`, `enforced-by`,
`verified-in`, `deferred`, and `supersedes`. A lesson enters the store open and is closed by
the PR, eval, or gate that answers it. The store lives on this side of the one-way channel
and holds only data that already crossed it as a sanitized note, so the channel rule above
is unchanged by any of this. For schemas, edge vocabulary, derived metrics, and the query
cookbook, see [calibration-graph.md](calibration-graph.md).

## Confirming prior fixes held

A `fixed-in` edge records that a change shipped. A `verified-in` edge records that a later
run watched it hold. Only the second is evidence, and the store has far more of the first:

```bash
node scripts/calibration-graph.mjs query unverified
```

Every run opens by reading that list, and closes by adding a `verified-in` edge for each
lesson it was in a position to observe. Skipping the step is how the loop ends up measuring
its own output instead of its own effect. Shipping a fix and gating it both feel like
progress, and neither shows whether the next run stopped paying for the problem.

Two rules keep the edge honest:

- Add `verified-in` only for a lesson this run could actually have hit. A run that never
  touched the code path proves nothing about it, and a speculative edge is worse than none,
  because it retires the lesson from the worklist.
- A lesson that recurs instead gets its recurrence recorded in the run's `lessons` array,
  never a `verified-in` edge. Recurrence and verification are opposite findings, and the
  store must not carry both.

A fix with a gate behind it is not RED here, because the gate stands in for field evidence
until a run supplies it. A fix with neither a gate nor a verification is RED and fails
`--gate`, since nothing at all is holding it.

## Reading lessons across providers

The `config:` line already records which model class ran a calibration, so the store can
answer the question that decides where a fix belongs:

```bash
node scripts/calibration-graph.mjs query cross-model
```

It reads two independent axes. The `config:` line says which model drove the run, and the
`host:` line says which harness ran it. Both matter, and they fail differently. A lesson
can be one model's habit or one harness's mechanics, and only the two together separate
"the suite is wrong" from "this particular setup is wrong". Record both, or a lesson stays
unclassifiable.

Every lesson is then partitioned by how far it has spread. Crossing either axis is enough
to call it the suite's problem:

- **CROSS-MODEL**, meaning two or more providers or two or more hosts: a suite defect. No
  single model's habits or harness's mechanics explain it, so the repair belongs in the
  skill text, the conventions, or a gate. These are the highest-value repairs in the store,
  because every provider and host keeps paying for them on every run. One with nothing
  mechanical holding it is RED, and `--gate` exits non-zero on it.
- **single-provider**: an adaptation until a second provider or host corroborates it. Fix
  the routing or the prose for that setup, and watch whether it reappears elsewhere.
  Rewriting shared doctrine off one setup's evidence over-fits the suite to it.
- **unattributed**: cited only by runs that recorded neither line. Not a weaker signal, just
  an unclassifiable one. A run predating these fields cannot be back-filled without
  guessing.

Attribution never guesses. A slug matching no known provider pattern stays unattributed,
because a wrong attribution would merge two providers' evidence and invent corroboration
that does not exist. The patterns live in `scripts/model-tiers.mjs` alongside the tier
ladder, so adding a provider is one edit.

## Pre-registered: the orchestration-configuration experiment

Three runs against the control target, identical in every respect but the `config:` line,
declared here before any of the three executes. It is the same pre-registration discipline
as `evals/FLOOR_TABLE.md`, and for the same reason: a comparison whose axes are chosen
after the numbers are in measures the chooser, not the configuration. Each arm is defined
by tier, because a tier survives a model generation and a model name does not. The recorded
`config:` value is the model class that actually ran.

- **R-NNN(a): a frontier lead over strong-tier operatives. The quality baseline.** Recorded
  as `config: lead fable-5; operatives opus-5`. It is the configuration used for the
  highest-stakes engineering work, and its row defines the bar the other two are read
  against, rather than a third data point.
- **R-NNN(b): a strong lead over strong-tier operatives. The candidate.** Recorded as
  `config: lead opus-5; operatives opus-5`. The primary outcome of the experiment is (b)'s
  gap to baseline on each axis below. Where a gap appears, the question to answer is which
  lead-level behavior accounts for it: verdict and tier-assignment quality, escalation
  handling, or brief precision. Then doctrine, brief skeletons, or mechanical gates can be
  hardened until the candidate performs at baseline level for less.
- **R-NNN(c): a strong lead over mid-tier operatives. The cost-floor reference.** Recorded
  as `config: lead opus-5; operatives sonnet-5`. Read against (b), it says what the
  operative-tier premium buys independently of the lead tier. It is context for the gap, not
  a candidate for adoption.

Axes, fixed in advance: CONFIRMED per 100k operative tokens, refutation survival rate,
failed-dispatch and redispatch rates from the run's `DISPATCH_LEDGER.md`, atlas falsified
count, CONFIRMED labels re-tiered on review, and total operative tokens. The operator sets
the lead by choosing the session's model, and pins the operative tier in every dispatch
brief of the run. An unpinned brief silently re-tiers the arm and voids it. An arm requires
a single-lead config. A run whose lead changed hands is recorded honestly with its
plus-separated lead, and is excluded from the three arms, because its numbers cannot be
attributed to one lead class.

Gaps found in (b) are recorded as `lesson:` lines under the existing classes,
`instrument`, `suite`, or `protocol`, and enter the remediation loop like any other lesson.
The candidate configuration is adopted for high-stakes work only once they are closed.

## Optional: defect seeding

To also measure recall on a real target, rather than cost and orchestration alone, seed a
small, known set of planted defects before the baseline sweep, mirroring the toy fixtures'
planted-bug approach at real scale, and fold recall into the quality axis above. Seeding is
optional because it requires write access to the target and is itself a behavior-changing
act. Skip it for a pure cost and orchestration calibration.

*Verified-at: b0ffede*
