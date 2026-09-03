# Calibration graph

The calibration graph is the store behind real-scale calibration: runs and lessons as
nodes, the work that closed a lesson as edges. Read it if you ingest a run, query the
trend, or add an edge. This page is the source of truth for the store's shape, and
[calibration-protocol.md](calibration-protocol.md) holds the doctrine around the runs.

Real-scale calibration used to remember only a table row. A row can say what a run
measured. It cannot say whether the lesson that run taught was ever fixed, whether the fix
was ever enforced, or whether a later run confirmed it landed. Three runs in, the same two
lessons had recurred verbatim while the table had no way to show it. So
`evals/CALIBRATION_TABLE.md` is now a rendered view of the store rather than the record.

## Store layout

```
evals/calibration/runs/R-001.json   one document per calibration run
evals/calibration/lessons.json      array of lesson nodes
evals/calibration/edges.jsonl       one JSON object per line
evals/CALIBRATION_TABLE.md          DERIVED: rendered from the above, never hand-edited
```

The store sits on the repo side of the one-way channel and therefore contains only
already-sanitized data: counts, enum words, kebab slugs, and the prose that already passed
`--validate-note`. Nothing enters it that did not cross the channel as a sanitized note.

## Node ID formats

| Form | Node |
| --- | --- |
| `R-NNN` | a calibration run |
| `L-NNN` | a lesson |
| `PR-NN` | a pull request **in this repo** |
| `COMMIT:<sha>` | a direct commit **in this repo**, 7-40 lowercase hex |
| `EVAL:<repo-relative path>` | an eval that enforces a lesson |
| `GATE:<script>#<check-slug>` | a single named check inside a lint or gate script |
| `VER:<plugin>@<semver>` | a released plugin version |

## Run document schema

All fields are required unless marked optional.

```json
{
  "id": "R-003",
  "date": "YYYY-MM-DD",
  "suite": { "<plugin>": "<semver>" },
  "target": { "label": "<sanitized prose label>", "class": "<kebab-slug>", "control": false },
  "track": "assess-only",
  "quality": {
    "findings": 0, "confirmed": 0,
    "refutation": { "paneled": 0, "survived": 0, "reproExempt": 0, "panelEligible": null },
    "severity": null
  },
  "tokens": { "operative": null, "dispatches": 0 },
  "orchestration": { "dangling": 0, "failed": 0, "redispatched": 0 },
  "standardization": { "enforcementsAdded": 0, "tracelessClean": true },
  "coverage": { "coveredNegatives": null, "slicesSwept": null, "slicesUnswept": null },
  "atlas": { "sections": 0, "fresh": 0, "refreshed": 0, "falsified": 0 },
  "config": { "lead": "<kebab-slug[+kebab-slug...]>", "operatives": "<kebab-slug>" },
  "host": "<kebab-slug>",
  "lessons": ["L-001"],
  "notes": "<verbatim notes prose>"
}
```

- `track` is `assess-only` or `implement`.
- `severity` is the `critical/high/medium/low/nit` count object, or `null` when the run did
  not record a mix.
- `panelEligible`, `tokens.operative`, and the three `coverage` fields are `int|null`.
  `null` means not measured by that run, which is not the same as zero.
- `atlas` is **optional**. It records the target's atlas as this run consumed it: how many
  sections it held, how many were consumed FRESH, how many the run refreshed, and how many
  it falsified. A run with no atlas leg omits the field entirely rather than storing zeros,
  since "no atlas was involved" and "an atlas nobody used" are different runs. When
  present, all four counts are non-negative, `fresh + refreshed` may not exceed `sections`,
  and neither may `falsified`. `query trend` prints an atlas tail only for the runs that
  carry it.
- `config` is **optional**. It records the orchestration the run was driven under, in kebab
  model-class slugs: the `lead` that planned and judged, and the tier its `operatives` ran
  at. A run that did not record it omits the field entirely. Absence means not recorded and
  never a default, since a guessed lead class would silently mis-group a comparison between
  configurations.
- `host` is **optional**, a kebab harness slug such as `claude-code`, `codex`,
  `grok-build`, or `opencode`. It answers the sibling question to `config`: `config` records
  which model drove the run, and `host` records which harness ran it. The slug is
  deliberately open rather than a closed enum, so a new host needs no schema change.
- `lessons` lists the lessons this run surfaced or re-surfaced.
- `notes` is the row's prose verbatim. For a new run it is the note's Lessons prose.

### How a config slug is read

`lead` is one or more plus-separated model classes, in the order they held the session, as
in `"fable-5+opus-5"`. A lead that changed hands mid-run records every lead rather than
dropping the field. It stays one ordered string, and an array `lead` is refused. Only the
lead splits, because `operatives` is a single class.

A split-lead run stays queryable and cannot serve as an arm of an orchestration
configuration experiment. The operator applies that exclusion when selecting arms. No gate
fails closed on `config` beyond schema validation. `query trend` renders the field as
stored, only for the runs that carry it, and `query cross-model` splits the lead,
attributing the run to every provider that held the session.

The slugs are model classes rather than tiers on purpose: a class is what a run actually
ran, and it is what a later reader can attribute to a provider.
`scripts/model-tiers.mjs` is the single source that maps a class to its provider-agnostic
rung, so a stored class stays comparable after a provider moves its lineup.

## Lesson node schema

```json
{ "id": "L-001", "class": "instrument", "title": "<short>",
  "statement": "<one-to-three sentences>", "firstSeen": "R-001" }
```

`class` says what was wrong, which decides who fixes it:

| class | meaning |
| --- | --- |
| `instrument` | the measurement pipeline was wrong: the run measured the wrong thing |
| `suite` | the plugins' behavior |
| `protocol` | the calibration doctrine itself |

## Edge vocabulary

```json
{ "from": "L-001", "rel": "fixed-in", "to": "PR-44", "note": "<optional short>" }
```

**`from` is always a lesson.** The graph records what each lesson caused. There are no
run-to-run or PR-to-eval edges.

| `rel` | `to` | Means |
| --- | --- | --- |
| `fixed-in` | `PR-NN` / `COMMIT:<sha>` | the change that addressed the lesson |
| `enforced-by` | `EVAL:` / `GATE:` | the mechanical check that stops it recurring |
| `verified-in` | `R-NNN` | a later run's evidence the fix actually landed |
| `deferred` | the literal string `"deferred"` | consciously not fixed. `note` is **required** |
| `supersedes` | `L-NNN` | `from` corrects or replaces `to` |

Use `COMMIT:<sha>` for a fix that landed as a direct commit with no PR behind it. `PR-NN`
stays the form whenever a pull request exists. Both are validated by shape only, never
resolved against GitHub or the object database. Both are historical records, and a
resolution check would fail falsely in a shallow clone that no longer holds the object.

`fixed-in` without `enforced-by` is the dangerous state: fixed once, free to recur.
`deferred` is a decision, not a gap, which is why the note is mandatory and why a deferred
lesson does not show up as open work.

**`surfaced-in` and `recurred-in` are derived, never stored.** They fall out of the run
documents' `lessons` arrays. The first run listing a lesson surfaced it, and every later
one re-surfaced it. Writing them as edges would create a second, drift-prone copy of a fact
the run documents already own.

## Derived metrics

The tooling computes these on read, and never stores them:

| Metric | Definition |
| --- | --- |
| `confirmedRatio` | `quality.confirmed ÷ quality.findings` |
| `confirmedPer100kTokens` | confirmed findings per 100k operative tokens. `null` when `tokens.operative` is `null` |
| `refutationSurvival` | `refutation.survived ÷ refutation.paneled`, always reported **with its paneled denominator** |
| `recurrence` | how many run documents list the lesson. `>= 2` is recurrent |

A survival rate without its denominator is not a number you can compare. A rate of 1.00 on
one paneled finding and 0.83 on six are different claims.

## Tool modes

`scripts/calibration-graph.mjs` is root-only, not vendored into plugins, and uses `node:`
builtins only. Reach it as `co calibrate graph <mode>`. It has four modes:

| Mode | Exit contract |
| --- | --- |
| `validate` | **fail-closed**, exit 1 on any schema violation, bad ID format, duplicate ID, non-monotonic `R` or `L` numbering, an edge endpoint that does not resolve (an unknown lesson or run, an `EVAL:` path absent from disk, a `fixed-in` target that is neither a numeric `PR-NN` nor a well-formed `COMMIT:<sha>`), a run listing an unknown lesson, or a lesson no run lists |
| `render` | rewrites `evals/CALIBRATION_TABLE.md` from the run documents. `--check` exits 1 on drift, with byte-diff semantics matching `build-codex-marketplace.mjs --check` |
| `query <sub>` | read-only, exit 0. `--gate` promotes RED lines to exit 1 |
| `ingest --note <file>` | parses a sanitized note's Machine block into a new `runs/R-NNN.json` skeleton and appends any `lesson: new …` entries to `lessons.json`. Exits 1 if the note fails the line shapes. **Never overwrites an existing run document** |

Rows render in date then id order, and the notes cell is the `notes` field verbatim. The
table's preamble is a fixed template inside the renderer, so the "this file is derived"
statement cannot be edited away in the table itself.

A lesson no run lists is a validate failure, not a warning. A lesson with no run behind it
is either a typo or an opinion, and neither belongs in the trend record.

## Query cookbook

| Question | Command |
| --- | --- |
| What is still open? | `query open` |
| What did we consciously not fix? | `query deferred` |
| What was fixed but can recur? | `query unenforced` |
| What shipped without a later run confirming it? | `query unverified` |
| What has already come back? | `query recurrent` |
| Is a lesson one model's problem or the suite's? | `query cross-model` |
| How is a target class trending? | `query trend` |
| Everything about one lesson | `query lesson L-NNN` |

- **`open`**: lessons with no `fixed-in`, no `deferred` edge, and no successor lesson. A
  `deferred` edge counts as closed with a reason, so `open` prints only genuinely
  unaddressed work. The deferred items are a separate query rather than a second list
  inside this one. Read both.
- **`deferred`**: lessons parked with a `deferred` edge, each printed with the note saying
  why there is no mechanical home yet. Not RED, because a deferral is a decision.
- **`unenforced`**: lessons with `fixed-in` and no `enforced-by`. That is the backlog which
  predicts the next recurrence.
- **`unverified`**: lessons with `fixed-in` and no `verified-in`, so a change shipped and no
  later run has watched it hold. RED when nothing mechanical holds it either, since an
  enforced fix has a gate standing in for field evidence and an unenforced one has nothing
  at all.
- **`recurrent`**: lessons with `recurrence >= 2`, and **RED** when the lesson is also
  unenforced. A RED recurrent lesson is the graph's strongest signal. The same defect has
  cost two or more real-scale runs and nothing mechanical stands in its way. Under `--gate`
  it fails the run, so treat it as a build break rather than a note.
- **`cross-model`**: every lesson partitioned by how far it has spread, across two
  independent axes, the run's `config` line and its `host` line. Crossing either axis calls
  the lesson the suite's problem. The doctrine behind the partition lives in
  [calibration-protocol.md](calibration-protocol.md).
- **`trend`**: per target class and track, one line per run, carrying findings, confirmed
  ratio, confirmed per 100k tokens, and refutation survival with its paneled denominator.
  Runs that recorded a `config` get a tail rendering it as stored, split lead included
  (`config fable-5+opus-5->opus-5`), and a run that recorded a `host` gets that too.
- **`lesson L-NNN`**: the full dossier, with the statement, the runs that listed it, every
  edge, and its derived status.

CI runs `validate` and `render --check`. No query runs under `--gate` in CI, so a RED line
is a signal to read, and only the two fail-closed modes break the build.

## The derived-table rule

`evals/CALIBRATION_TABLE.md` is a rendered artifact, in the same class as
`codex-marketplace/`. Change the source, re-render, and never hand-edit. Record a run by
ingesting its note into `evals/calibration/` and re-rendering. Editing the table directly
puts a number in the trend record that no run document supports.

CI runs `calibration-graph validate` and `render --check` against the real store, so a
hand-edited table or an inconsistent edge fails the build rather than quietly becoming the
new truth.

## Shared graph conventions and the movement graph

This store's shape is the house pattern for any graph in this ecosystem, not a one-off:

- **Stable, prefixed node IDs**: a short uppercase prefix plus a serial (`R-NNN`), or a prefix plus a kebab or path key (`GATE:<script>#<check-slug>`). IDs are never renumbered.
- **One JSON document per node collection, plus an `edges.jsonl`** holding one `{ from, rel, to, note? }` object per line. A line per edge keeps appends conflict-free.
- **Derived, not stored**: anything computable from the nodes is computed on read, including rates, ratios, recurrence, and reverse edges. A second copy is a drift source.
- **One zero-dependency tool per graph**, exposing `validate` (fail-closed), `render --check` for every derived view, and read-only `query` subcommands.
- **New edge vocabularies extend, never repurpose.** A `rel` name means one thing across every graph. Where the semantics differ, the name is new.

A second graph, the movement graph, is design-noted here and is not part of this store. It
indexes how agent work moves across projects. It holds three things:

- per-repo context manifests, now built as the atlas ([atlas.md](atlas.md))
- per-run manifests, recording artifacts produced and consumed, the PR, the outcome, and per-dispatch token stamps
- a user-level index of repos, runs, and sessions

A per-repo context manifest is a durable
artifact with a `kind`, a `verified-at` sha, and a freshness state, generalizing the
`revalidate-register.mjs` pattern. Reserved edge vocabulary: `produced`, `consumed`,
`superseded-by`, and `resumed-from`.

**Boundary rule.** The calibration graph is public-repo data, gated by the one-way channel.
The movement graph touches private repos and session data, so it lives at user level, with
only per-repo manifests checked into their own repos. The two stores share conventions and
are never merged. Fusing them would either leak private-repo detail into this repo or force
the calibration store out of it.

*Verified-at: b0ffede*
