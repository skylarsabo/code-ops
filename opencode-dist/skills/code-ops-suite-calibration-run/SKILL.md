---
name: code-ops-suite-calibration-run
description: "Use when you want a standardized real-scale calibration run of the suite against a target repo, in an isolated assess-only session, ending in a sanitized trend-table entry. It never quotes the target's internals back into this repo. See code-ops-docs/40 Engineering/Techniques/calibration-protocol.md."
---

# CALIBRATION RUN: Standardized Real-Scale Measurement

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-calibration-run`, or by the model through the `skill` tool as `code-ops-suite-calibration-run`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. It defines the operating model,
the safety rails, and the evidence standard this skill extends to run measurement. Then read
`code-ops-docs/40 Engineering/Techniques/calibration-protocol.md` for the one-way channel rule,
the metric table, and the sanitized-note template this skill fills in.
**Mode:** ASSESS · **Consumes:** a target repo, real-scale rather than a toy fixture ·
**Produces:** a validated sanitized calibration note, an ingested run document under
`evals/calibration/`, and the re-rendered `evals/CALIBRATION_TABLE.md`. Nothing else leaves the
isolated session.

A calibration run measures the suite against a real codebase without letting that codebase's
internals leak back here. The channel is **one-way**. Only the sanitized note crosses back,
carrying counts, deltas, and lessons, and no paths, code, or URLs.

## Phase 0: the isolation preflight  *(checkpoint)*

Confirm four things before any fan-out:
1. The target repo.
2. That this session's context is **fresh and isolated**, with no other repo's state bleeding in.
3. That the run is **assess-only**, so the target takes no code changes.
4. The one-way channel rule, per `code-ops-docs/40 Engineering/Techniques/calibration-protocol.md`. Only the sanitized note returns.

Run `node <plugin-root>/scripts/preflight.mjs --artifact-dir <run folder>`. A FAIL stops
the run before any fan-out.

Confirm the run's **orchestration configuration** here too: this session's lead model class, and
the tier its operatives will run at. Pin that operative tier in every dispatch brief of the run.
It is recorded as the note's `config:` line, and a run that re-tiers mid-flight is not comparable
to any other. When the **lead** model class changes mid-run, record every lead class in the order
it held the session, plus-separated on the config line (`lead <model-class>+<model-class>`). A
handover happens when a blocked or interrupted lead's session is recovered under another class.
Never omit the field instead. A handover recorded honestly stays queryable, while a silent
omission loses the run's configuration entirely.

Record the **harness** this run executes in as the note's `host:` line. The `config:` line says
which model drove the run, and the `host:` line says which harness ran it. A lesson is
unclassifiable without both, because a model's habit and a harness's mechanics fail differently.

> **CHECKPOINT:** confirm the target, the isolation, the orchestration configuration, the host, and the one-way rule before proceeding.

## Phase 1: the baseline sweep

Start with the prior-fix worklist. From the code-ops repo, run
`node scripts/calibration-graph.mjs query unverified`. It lists every lesson whose fix shipped
but which no later run has confirmed held. Carry that list into the run and watch for those
specific behaviors. That worklist is the only step that measures the suite's *effect* rather
than its output, and Phase 4 records what you observed.

Then run the atlas leg. Run
`node <plugin-root>/scripts/atlas-check.mjs check --atlas <target atlas dir>` when the
target keeps an atlas, and `init` one when it does not
(`code-ops-docs/40 Engineering/Techniques/atlas.md`). Carry each section's FRESH or STALE state
into every sweep brief beside the repo-map pointer. Refresh the STALE sections during the run
rather than after it. Record four counts as you go: sections, consumed FRESH, refreshed, and
**falsified**. A falsified section is one whose claim the sweep disproved, which is a false
premise handed to a run rather than ordinary staleness.

Then dispatch `/code-ops-suite-full-sweep` in the **`assess-only`** track against the target, or
`/rigor-rigor-sweep` when `rigor` is the mechanism under calibration. Let the sweep run its own
phases and checkpoints. This run's artifacts (registers, `DISPATCH_LEDGER.md`,
`EXECUTIVE_SUMMARY.md`) stay inside the run folder. They are the raw material Phase 2 extracts
from, and are never quoted here directly.

## Phase 2: the extraction

Run
`node <plugin-root>/scripts/calibration-metrics.mjs --artifacts <run folder> [--out <metrics file>]`
to pull the quality, token, orchestration, and standardization metrics the protocol doc defines.
This call always exits 0. It reports what it found and never gates.

## Phase 3: the sanitized note  *(fail-closed)*

Fill the sanitized-note template
(`code-ops-docs/40 Engineering/Techniques/calibration-protocol.md`) from the extracted metrics:
counts and deltas against the prior table row, plus the lessons learned. Include zero paths,
code, or URLs from the target.

Fill the note's **`## Machine block`** too, one line per shape in that template: run-date, suite,
target-class, track, findings and confirmed, paneled and survived and repro-exempt, severity,
tokens and dispatches, orchestration, standardization, and coverage. Add the optional `atlas:`
line carrying Phase 1's four counts when the run had an atlas leg. Add the optional `config:`
line carrying Phase 0's lead and operative model classes, with every lead class plus-separated in
order when Phase 0 recorded a handover, and the operatives half always a single class. Add a
`lesson:` line per lesson: `lesson: recur L-NNN` for one already in the store, and
`lesson: new <instrument|suite|protocol> — <statement>` otherwise. Those two shapes are the
parser's literal grammar at `scripts/calibration-graph.mjs`, punctuation included, so copy them
exactly. The Machine block is line-based prose, never fenced.

Each falsified section earns its own `lesson:` line. Use `instrument` when the atlas workflow
produced the false claim, and `protocol` when the doctrine around consuming it did. Counts cross
the channel. Section names, scopes, and prose do not.

Gate the whole note with
`node <plugin-root>/scripts/calibration-metrics.mjs --validate-note <note file>`. It is
a structural scrub that fails closed on any path, code fence, URL, or email, and on a missing or
malformed Machine block. Fix the note and re-validate rather than working around a hit.

## Phase 4: the record  *(fail-closed)*

Back in the code-ops repo, from its root, run three commands in order:
1. `node scripts/calibration-graph.mjs ingest --note <note file>` writes `evals/calibration/runs/R-NNN.json` plus any new lessons, and refuses to overwrite an existing run.
2. `node scripts/calibration-graph.mjs render` regenerates `evals/CALIBRATION_TABLE.md`, a derived view that is never hand-edited.
3. `node scripts/calibration-graph.mjs validate` fails closed on a broken schema, id, or edge endpoint.

See `code-ops-docs/40 Engineering/Techniques/calibration-graph.md` for the store's shape.

Then close the Phase 1 worklist. Append a `verified-in` edge to `evals/calibration/edges.jsonl`
for each unverified lesson this run was actually in a position to observe holding. Never append
one for a lesson whose code path the run did not touch, because a speculative edge retires the
lesson from the worklist without evidence. A lesson that recurred instead belongs in the run's
`lessons` array, never in a `verified-in` edge. Recurrence and verification are opposite
findings.

Then sync the eval. `evals/calibration-graph/run.mjs` runs against the real store and hardcodes
its answers, so an ingest is always a two-file change: the store plus that eval. Update its
expectations by hand and run `node evals/calibration-graph/run.mjs` until it exits 0. Skipping
this step passes every other gate and fails only in CI.

## Done when

- The sanitized note passes `--validate-note`, with the Machine block included, carrying the `atlas:` line whenever the run had an atlas leg, and the `config:` and `host:` lines always.
- Every prior fix the run was in a position to observe carries a `verified-in` edge or an explicit recurrence, never silence.
- Every STALE section the run touched is refreshed, or left STALE with an inbox note, and never stamped to clear the report.
- The run is ingested into `evals/calibration/`, the table is re-rendered from it, `calibration-graph.mjs validate` passes, and `evals/calibration-graph/run.mjs` passes against the updated store.
- Nothing from the target's internals, meaning no path, code, or URL, appears anywhere outside the isolated session.
- The sanitized note and the rendered table row are presented.
