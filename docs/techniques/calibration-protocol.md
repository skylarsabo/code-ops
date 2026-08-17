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
- **The atlas leg.** If the target keeps an atlas ([atlas.md](atlas.md)), run
  `atlas-check.mjs check` at run start and hand each section's FRESH/STALE state into the
  sweep briefs alongside the repo-map pointer — a FRESH section is consumed as truth, a
  STALE one is a lead. Refresh the STALE sections during the run, in the session that has
  the context, rather than deferring them. If the target keeps no atlas, `init` one as part
  of the run: the sweep has just derived the understanding the atlas exists to bank.
- **Falsified sections are findings about the instrument.** A section is *falsified* when
  the sweep disproves one of its claims — not merely when the code moved under it, which is
  ordinary staleness. A falsified section means a run was handed a false premise, so it
  feeds a `lesson:` line under the existing classes: `instrument` when the atlas workflow
  produced the false claim, `protocol` when the doctrine around consuming it did.
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
| Atlas | sections in the target's atlas, of those the count consumed FRESH, the count refreshed during the run, and the count the run falsified |
| Configuration | the orchestration the run was driven under — the lead's model class and the class its operatives ran at |

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
host: <kebab-slug> (optional; the harness — claude-code, codex, grok-build, opencode)
lesson: recur L-NNN
lesson: new <instrument|suite|protocol> — <statement>
```

No paths, code fences, or URLs anywhere in a filled note — those are exactly what
`calibration-metrics.mjs --validate-note` scrubs for and fails closed on. That applies
to the Machine block too: it is **line-based prose, not a code block** — no fences
around it, and no paths inside it.

Write the severity mix **only** in the `c/h/m/l/n as N/N/N/N/N` form, in the prose half as
well as the Machine block. A bare `0/6/22/9/10` is five slash-separated segments and the
path detector reads it as a unix path, so an earlier template shape made a note written
exactly to template fail closed. The fixed `c/h/m/l/n as` head is the pre-filtered public
vocabulary the scrub already allows; the scrub itself is unchanged and no less strict.

The Machine block is what `calibration-graph.mjs ingest` parses into a run document, so
its shapes are load-bearing. `--validate-note` fails closed on a note **missing** the
`## Machine block` section (a note written against the older template no longer
validates), and on any present line that does not match its shape grammar above. New
lessons get their `L-NNN` id assigned at ingest, so the note writes the statement, not
the id; a recurrence cites the existing id. The block adds no leak surface — counts,
kebab slugs, and enum words only — and still passes through every existing scrub.

The `atlas:` and `config:` lines are the **optional** metric lines: a note without either
validates and ingests exactly as before (the runs recorded before those legs existed have
none). A note carrying `atlas:` must carry all four counts, and both sides refuse
`fresh + refreshed` exceeding `sections`, or `falsified` exceeding it — those are
arithmetic that went wrong upstream, not a measurement. Section *counts* cross the
channel; section names, scopes, and prose never do.

The `config:` line records the run's orchestration in kebab model-class slugs — the
lead that planned and judged, and the tier its operatives ran at (`config: lead fable-5;
operatives opus-5`). It is what makes one run's numbers comparable to another's rather
than merely sequential, so a run comparing configurations must carry it. Absence means
*not recorded*: a run doc omits the field rather than defaulting one, since a guessed lead
class would silently mis-group a comparison. Model classes are public vocabulary, so the
line adds no leak surface — no version string, endpoint, or session id crosses on it.

A lead that changed mid-run — a handover, say after a safety-classifier interruption left
the session to be recovered under another class — records **every** lead class in order,
plus-separated (`config: lead fable-5+opus-5; operatives opus-5`), rather than omitting the
field. The order is the order they held the session, first class first, and the run doc
stores it as that one string. Only the lead may split; `operatives` stays a single class,
since the tier is pinned per dispatch for the whole run. The single-lead form is the
canonical one — the split exists so an honest handover is expressible, not as an
alternative way to write an ordinary run.

## Recording a run

A validated note is not the record — the run document is. Five steps, in order:

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
5. **Sync the eval** — `evals/calibration-graph/run.mjs` runs against the real store and
   hardcodes its answers: store counts, the open and recurrent lesson sets, per-run trend
   lines, and the run id a scratch ingest mints. Update those expectations by hand, then
   run `node evals/calibration-graph/run.mjs` until it exits 0. No expectation generator
   exists. Skipping this step passes every other gate and fails only in CI.

Edges (`fixed-in`, `enforced-by`, `verified-in`, `deferred`, `supersedes`) are written
when the follow-up work lands, not at ingest — a lesson enters the store open and is
closed by the PR, eval, or gate that answers it. The store lives on this side of the
one-way channel and holds only data that already crossed it as a sanitized note; the
channel rule above is unchanged by any of this. Schemas, edge vocabulary, derived
metrics, and the query cookbook: [calibration-graph.md](calibration-graph.md).

## Confirming prior fixes held

A `fixed-in` edge records that a change shipped. A `verified-in` edge records that a later
run watched it hold. Only the second is evidence, and the store has far more of the first:

```bash
node scripts/calibration-graph.mjs query unverified
```

Every run opens by reading that list and closes by adding a `verified-in` edge for each
lesson it was in a position to observe. Skipping the step is how the loop ends up measuring
its own output instead of its own effect — shipping a fix and gating it both feel like
progress, and neither shows whether the next run stopped paying for the problem.

Two rules keep the edge honest:

- Add `verified-in` only for a lesson this run could actually have hit. A run that never
  touched the code path proves nothing about it, and a speculative edge is worse than none
  because it retires the lesson from the worklist.
- A lesson that recurs instead gets its recurrence recorded in the run's `lessons` array,
  never a `verified-in` edge. Recurrence and verification are opposite findings and the
  store must not carry both.

A fix with a gate behind it is not RED here, because the gate stands in for field evidence
until a run supplies it. A fix with neither a gate nor a verification is RED and fails
`--gate`: nothing at all is holding it.

## Reading lessons across providers

The `config:` line already records which model class ran a calibration, so the store can
answer the question that decides where a fix belongs:

```bash
node scripts/calibration-graph.mjs query cross-model
```

It reads two independent axes. The `config:` line says which **model** drove the run; the
`host:` line says which **harness** ran it. Both matter, and they fail differently: a
lesson can be one model's habit or one harness's mechanics, and only the two together
separate "the suite is wrong" from "this particular setup is wrong". Record both, or a
lesson stays unclassifiable.

Every lesson is then partitioned by how far it has spread. Crossing **either** axis is
enough to call it the suite's problem:

- **CROSS-MODEL** (two or more providers, **or** two or more hosts) — a suite defect. No
  single model's habits or harness's mechanics explain it, so the repair belongs in the
  skill text, the conventions, or a gate. These are the highest-value repairs in the
  store: every provider and host keeps paying for them on every run. One with nothing
  mechanical holding it is RED, and `--gate` exits non-zero on it.
- **single-provider** — an adaptation until a second provider or host corroborates it.
  Fix the routing or the prose for that setup, and watch whether it reappears elsewhere.
  Rewriting shared doctrine off one setup's evidence over-fits the suite to it.
- **unattributed** — cited only by runs that recorded neither line. Not a weaker signal,
  just an unclassifiable one; a run predating these fields cannot be back-filled without
  guessing.

Attribution never guesses. A slug matching no known provider pattern stays unattributed,
because a wrong attribution would merge two providers' evidence and invent corroboration
that does not exist. The patterns live in `scripts/model-tiers.mjs` alongside the tier
ladder, so adding a provider is one edit.

## Pre-registered: the orchestration-configuration experiment

Three runs against the **control target**, identical in every respect but the `config:`
line, declared here before any of the three executes — the same pre-registration
discipline as `evals/FLOOR_TABLE.md`, and for the same reason: a comparison whose axes
are chosen after the numbers are in measures the chooser, not the configuration.

- **R-NNN(a) — lead `fable-5`, operatives `opus-5`. The quality baseline.** The
  configuration used for the highest-stakes engineering work; its row *defines the bar*
  the other two are read against, not a third data point.
- **R-NNN(b) — lead `opus-5`, operatives `opus-5`. The candidate.** The primary outcome
  of the experiment is (b)'s **gap to baseline** on each axis below. Where a gap appears,
  the question to answer is which lead-level behavior accounts for it — verdict and
  tier-assignment quality, escalation handling, or brief precision — so that doctrine,
  brief skeletons, or mechanical gates can be hardened until the candidate performs at
  baseline level for less.
- **R-NNN(c) — lead `opus-5`, operatives `sonnet-5`. The cost-floor reference.** Read
  against (b), it says what the operative-tier premium buys independently of the lead
  tier; it is context for the gap, not a candidate for adoption.

Axes, fixed in advance: CONFIRMED per 100k operative tokens; refutation survival rate;
failed-dispatch and redispatch rates (from the run's `DISPATCH_LEDGER.md`); atlas
falsified count; CONFIRMED labels re-tiered on review; and total operative tokens. The
operator sets the lead by choosing the session's model and pins the operative tier in
**every** dispatch brief of the run — an unpinned brief silently re-tiers the arm and
voids it. An arm requires a **single-lead** config: a run whose lead changed hands is
recorded honestly with its plus-separated lead, but it is excluded from the three arms,
because its numbers cannot be attributed to one lead class.

Gaps found in (b) are recorded as `lesson:` lines under the existing classes
(`instrument`, `suite`, `protocol`) and enter the remediation loop like any other lesson;
the candidate configuration is adopted for high-stakes work only once they are closed.

## Optional: defect seeding

To also measure recall on a real target (not just cost/orchestration), seed a small,
known set of planted defects before the baseline sweep — mirroring the toy fixtures'
planted-bug approach at real scale — and fold recall into the quality axis above.
Seeding is optional because it requires write access to the target and is itself a
behavior-changing act; skip it for a pure cost/orchestration calibration.

*Verified-at: 2df53bf*
