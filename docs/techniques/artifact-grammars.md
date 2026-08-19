# Artifact grammars

Five run artifacts are both written by skills and read back by mechanical tools.
Real-scale calibration runs found the metrics extractor parsing **zero items** from
non-empty artifacts in two straight runs — not because the artifacts were empty, but
because their shape had drifted from what the parser expects. This page is the SSOT
for the five grammars: get the shape exactly right and every consumer below reads it
correctly; drift the shape and a consumer silently reports zero, which reads as
"nothing here" instead of "wrong shape."

## (a) DISPATCH_LEDGER.md row

Five pipe-delimited cells, written by `scripts/dispatch-ledger.mjs` (the generator —
skills should call `add`/`update`/`check`, never hand-author rows):

```
| id | role | brief | expected artifact | status |
| --- | --- | --- | --- | --- |
| D-001 | explorer@claude-sonnet-5 | map the auth module | AUTH_MAP.md | dispatched |
```

- `id` — `D-NNN`, strictly increasing within the ledger.
- `role` — stamped `role@model` at dispatch time (e.g. `explorer@claude-sonnet-5`), the
  resolved model that actually ran the dispatch. A cell with no `@model` is a legacy
  unstamped row — it still parses, but the tier-mix metric can't reconstruct that row.
  See [The model half is parsed, not just carried](#the-model-half-is-parsed-not-just-carried).
- `brief` — ≤10 words.
- `expected artifact` — the filename or `diff` the dispatch is expected to produce.
- `status` — one of `dispatched | reported | failed | redispatched`.

Rows are written **at dispatch time**, atomically with the dispatch call itself — see
the `Dispatch ledger` passage in each plugin's `CONVENTIONS.md` for why.

The row pattern and its status set live in `scripts/ledger-grammar.mjs`, which the writer
and both readers import. Each reader counts a non-matching row as malformed rather than
failing, so three separate copies of this grammar would have drifted into quietly
undercounted dispatches; one module removes that path.

### The model half is parsed, not just carried

The role cell is one cell, but it holds two facts. Both consumers split it on its **last**
`@` — a role name that itself carried `@` would otherwise misparse the model — and read the
right half back as counts:

- **Per model.** `dispatch-ledger.mjs check` prints `model mix:` and
  `calibration-metrics.mjs` prints `tier mix:`, each a dispatch count per resolved model id.
- **Per model class.** Both also print `model-class mix:`, resolving each stamped id to a
  canonical rung through `scripts/model-tiers.mjs`, the ladder SSOT. Raw ids change whenever
  a provider moves its lineup; the rungs do not, so the class mix is what stays comparable
  across runs, across months, and across providers.

Three answers are possible, and the last two are refusals rather than guesses:

| Class | When | Why not a rung |
| --- | --- | --- |
| `light` · `mid` · `strong` · `frontier` | the id serves exactly one rung in `PROVIDER_TIERS` | — |
| `ambiguous` | the id serves several rungs (`grok-4.6` serves all four; `gemini-3.1-pro-preview` serves two) | a single-model ladder carries no tier signal, and naming one rung would invent a distinction the provider does not make |
| `unclassified` | the id is real but sits in no pinned ladder | a model this repo has not pinned cannot be placed by the shape of its name, and a wrong placement reads as a routing verdict |

A row with no stamp, or one whose model half is empty (`explorer@`), is `unstamped` in both
lines — its own bucket, never folded into a class, because a hole in the record is not a
tier that was observed. The addition is backward compatible in both directions: a bare
`role` cell stays valid and still parses, and absence is reported as `unstamped`, never as
an error.

The forward-looking consumer of the same grammar is `scripts/estimate-run-cost.mjs`, which
reads prior runs' ledgers **before** a run to estimate its dispatch count and class mix —
see [handbook 09 § Pre-run estimation](../handbook/09-cost-and-scoping.md).

### Phase markers

A ledger may be segmented by phase-marker lines, written by
`scripts/dispatch-ledger.mjs phase --ledger <file> --title <title> --lead-model <id>`
(the generator — never hand-author the line):

```
> phase: Phase 2 — bug hunt · lead@claude-opus-5
```

The form is `> phase: <title> · lead@<model>`. Every row **following** a marker belongs
to that phase, until the next marker. The addition is non-breaking: existing parsers
skip non-pipe lines, so a ledger with markers still parses row-for-row exactly as
before. `dispatch-ledger.mjs check` fails closed on a malformed `> phase:` line (a
missing title, missing ` · lead@`, or an empty model) rather than skipping it as prose.
`calibration-metrics.mjs` reports the lead model **per phase** and raises an advisory
when the lead model changes mid-run — a lead swap between phases is a legitimate but
noteworthy event, not a silent one.

### Orchestration rates are journal-first

`dispatch-ledger.mjs` also maintains a write journal beside the ledger,
`DISPATCH_LEDGER.md.journal.jsonl` — one JSONL entry per `add`/`update`/`phase`, appended
at write time. `check` replays it to catch phantom rows; `calibration-metrics.mjs` replays
it for a second reason: a row's `status` cell holds only the **final** status, so a unit
that failed and was then retried reads as `redispatched` alone. Failed-rate and
redispatch-rate were therefore mutually exclusive for one unit, and the pair understated
recovery.

So the two rates are derived **journal-first**:

- **Journal present and clean** — per-unit history is replayed from it. A unit counts
  toward the failed rate if it **ever** entered `failed`, and toward the redispatch rate if
  it was **ever** redispatched, independently. The report says `rate basis: journal-derived`.
- **No journal** (a pre-journal artifact folder) — the snapshot statuses are counted exactly
  as before, and the report says `rate basis: snapshot-only`.
- **Journal present but malformed** — an unreadable line means the journal cannot be trusted
  to prove anything, so it is rejected **whole**, never partly used. Each violation prints as
  `!! JOURNAL`, and the basis line names the fallback: a degraded rate is never silent.

The dangling rate is untouched by this: still-`dispatched` is a question about the final
status by definition. `by status` likewise keeps reporting the snapshot.

## (b) FINDINGS_REGISTER.md entry

An entry begins where an item ID matching `revalidate-register.mjs`'s `ID_RE` appears
**at entry-heading position**. The ID grammar is:

`/\b([A-Z][A-Z0-9]{1,}-[A-Z]?\d{1,6})\b/g`

— a prefix of **two or more** uppercase alphanumerics that **starts with a letter**, a
hyphen, an **optional single uppercase round-letter**, then 1–6 digits (e.g. `BUG-007`,
`PERF-003`, `FEAT-012`, `FND-A12`). The optional round-letter exists because real runs
number findings per review round (`FND-A12`, `FND-B03`); before it was added, a whole
run's lettered IDs matched nothing and were counted as zero findings.

Two guards keep this from over-matching (`isItemId`, mirrored in `scan-narration.mjs`
and `calibration-metrics.mjs`):

- the prefix is dropped if it's a known standards token (`RFC`, `ISO`, `CVE`, `CWE`,
  `CAPEC`, `GHSA`, `UTF`, `SHA`, `MD`, `AES`, `RGB`, `HTTP`, `HTTPS`, `IEEE`, `ANSI`,
  `FIPS`, `NIST`, `PEP`, `ECMA`, `UTC`, `GMT`, `IPV`) — so `RFC-2616` and `CVE-2021-44228`
  never register as items;
- a trailing hyphen followed by another digit marks a longer numeric token rather than
  a new item boundary, so `CVE-2021-44228` isn't split mid-string, while a slug suffix
  like `BUG-042-auth-bypass` still counts as one item.

### Entry-heading position

Matching the ID grammar is necessary but not sufficient: an ID **creates an entry only
at entry-heading position** — at the start of a line, optionally preceded by up to six
`#` heading markers (`### BUG-007 — auth bypass`) or by a table row's leading pipe
(`| BUG-007 | … |`, for table-form registers). An ID-shaped token sitting mid-line
inside evidence prose no longer opens an entry, so a paragraph that mentions three
sibling findings does not inflate the count to four. The refutation-log grammar in (c)
now matches its receipts at the same position, for the same reason.

### Where an entry ends

An entry runs to the last line that **belongs** to it. It is terminated by whichever comes
first:

- the next entry head;
- a covered-negative `NO-FINDINGS:` line (see below);
- a **non-entry markdown heading** (`## Covered negatives`, `## Method notes`) — a section
  boundary, not part of the entry above it;
- end of file.

Both consumers of the per-entry budget apply this. Without a terminator, a register's
trailing covered-negative block was attributed to the final entry and reliably tripped
that entry's hard cap on a register whose entries were every one of them tight — a real
calibration run's 47-finding register failed on its last entry for lines it did not own.

### Conforming vs. non-conforming IDs

| Example | Counts? | Why |
| --- | --- | --- |
| `BUG-003` at line start | yes | 3-char letter prefix, hyphen, 3 digits, entry-heading position |
| `### FND-A12` | yes | optional single uppercase round-letter `A` before the serial |
| `F-001` | no | single-letter prefix — the grammar needs two or more prefix characters |
| `BUG-b3` | no | lowercase round letter — the round-letter slot is uppercase only |
| `BUG-12A` | no | letter *after* the serial; the ID must end at the digits |
| `…as noted in BUG-003 above…` | no | right shape, wrong position — mid-sentence in evidence prose, not an entry heading |

The last two rows are the pair that bit a real calibration run from opposite sides: the
lettered IDs the run actually used went silently invisible, while ID-shaped tags in
prose were counted as entries.

### Covered negatives

A slice that was examined and found clean is recorded with a covered-negative line, at
the start of a line in `FINDINGS_REGISTER.md`:

```
NO-FINDINGS: token refresh path — traced all 3 call sites, every branch re-checks expiry
```

Form: `NO-FINDINGS: <slice label> — <one-line why/evidence>`. `calibration-metrics.mjs`
reports these as `covered negatives: N`. This line is what answers the question a bare
empty register cannot: **was this slice examined and clean, or did the dispatch fail?**
A register with zero entries but one or more `NO-FINDINGS:` lines is a **covered
negative**, not shape drift — the zero-items warning is suppressed for it.

### Findings live in FINDINGS_REGISTER.md

Register-shaped entries written into a themed sibling report (`SECURITY_FINDINGS.md`,
`PERF_NOTES.md`, any other `.md`) draw a **not-counted warning** from the extractor:
those entries exist but are invisible to every register consumer. Findings belong in
`FINDINGS_REGISTER.md`; a sibling report links to entries there rather than restating
them in entry shape.

The sweep that raises this warning walks the artifact folder **recursively** (bounded by a
depth cap, skipping dot-directories and `node_modules`), so a per-slice report written into
a subdirectory is seen rather than silently exempt — top-level-only, an entire run's
per-slice reports stayed invisible. `calibration-metrics.mjs`'s own report is not a run
artifact and is excluded from the sweep — by its `--out`/`--json` path and by the
`# calibration-metrics — ` header it always opens with — because the per-entry length lines
it emits (`    FIND-004: 26 non-blank line(s)`) sit at entry position and otherwise read
back as a register.

Every entry carries the `Finding` schema fields (CONVENTIONS `§7`): `Tier`
(`CONFIRMED|PROBABLE|SPECULATIVE`), `Location`, `Anchor`, `Verified-at`, `Evidence`,
`Disconfirmation`, `Refutation`, `Impact`, `Recommendation`, `Track`
(`NOW-SAFE|NEEDS-REVIEW|NEEDS-DESIGN`, CONVENTIONS `§6`), `Effort`, `Risk-if-fixed`,
plus `Severity`/`Confidence`/`Lens`/`Scope`. An item with no `Tier:` field, or a value
outside the known three, is unparseable to `calibration-metrics.mjs` — counted, never
silently dropped.

Per-entry length budget, applied by **both** `scan-narration.mjs` and
`calibration-metrics.mjs` to register-shaped files with parseable entries: advisory at
10 non-blank lines per entry, hard at 20; the preamble before the first entry gets its
own budget, advisory 15 / hard 30. A normal `Tier/Location/Anchor/...` block runs ~5-8
lines and passes cleanly — these budgets flag prose padding, not finding count. The
flat file-level cap (60 advisory / 120 hard) is the **fallback only**, for a
register-shaped file whose entries do not parse; a register with many legitimate
findings is no longer penalized for its length by either tool.

## (c) REFUTATION_LOG.md receipt line

One receipt per line, keyed by the finding's own ID **at the start of that line**,
middot-delimited (CONVENTIONS `§7`):

```
SEC-003 · r1 · SURVIVED · reviewer · searched: caller chain + middleware
BUG-007 · r2 · REFUTED · reviewer · src/api/limits.ts:88 · Anchor: `clamp(size, MAX)`
```

Fields: item ID · panel round · verdict (`SURVIVED|REFUTED`) · panelist role · evidence
(the search trail for `SURVIVED`; a re-greppable `file:line` + backtick/quote-delimited
`Anchor` for `REFUTED`, so `revalidate-register.mjs --refutation-log` can confirm the
killing guard still exists). A line that opens with an item ID but carries neither verdict
token is unparseable, not silently skipped.

**Receipt position** mirrors the entry-heading position of (b): the ID must sit at the start
of the line. A line that cites findings mid-sentence ("the panel read BUG-001 as a duplicate
of BUG-003") is prose, not a receipt — matched mid-line, such a round note was counted as an
unparseable receipt, and a note that happened to contain the word `REFUTED` attached itself
to the finding it cited as a second, unanchored verdict.

## (d) CONFORMANCE_REPORT.md surface row

One row per standardization surface, written by `/code-ops-suite:conform` Phase A and
re-written with the closing output in Phase C. Four pipe-delimited cells:

```
| surface | verdict | checker | evidence |
| --- | --- | --- | --- |
| vault | DRIFTED | check-vault-standard.mjs | 3 notes carry no `type` frontmatter |
| atlas | UNKNOWN | atlas-check.mjs check | manifest did not parse |
```

- `surface` — a kebab slug naming the surface. The five the skill walks are `contract`,
  `vault`, `atlas`, `doc-alignment`, and `global-contract`; the slot stays open so a
  profile can add one without editing the parser.
- `verdict` — one of `CONFORMANT | DRIFTED | ABSENT | UNKNOWN`. Uppercase is the written
  convention; the parser reads the cell case-insensitively. `UNKNOWN` is
  the verdict for a checker that could not run: a check that did not execute proves
  nothing, and recording it as `CONFORMANT` is the failure this enum exists to prevent.
- `checker` — the command whose exit code decided the verdict, or `none` for a surface
  with no mechanical check. A prose reading is not a checker.
- `evidence` — a pointer to the output that decided it: the failing line, the count, or
  the exit code, optionally preceded by the opening verdict when Phase C re-writes the
  row. Never a general impression.

A row whose shape does not match, whose verdict is outside the four, or whose `surface`
repeats an earlier row's is **unparseable** — counted and reported, never skipped. On a
repeated surface the first row wins; the file carries one row per surface, so a
duplicate is a producer defect, not a second opinion. `calibration-metrics.mjs`
reports the per-surface verdict counts, so drift becomes a trended series rather than a
one-off reading.

## (e) RUN_CONFORMANCE.md check row

One row per mechanically checkable discipline rule, written by
`/code-ops-suite:run-cost-audit` over a **completed** run's artifact folder. Three
pipe-delimited cells:

```
| check | result | evidence |
| --- | --- | --- |
| ledger-coverage | PASS | 7 dispatches, 7 ledger rows |
| tier-routing | FAIL | D-004 reviewer routed below the strong tier |
| artifact-placement | N/A | target repo carries no vault |
```

- `check` — a kebab slug naming the rule. The five the audit scores are
  `ledger-coverage` (every dispatched agent has a ledger row, cross-checked against the
  `DISPATCH_LEDGER` grammar in (a)), `no-dangling` (no row left `dispatched` with no
  reported, failed, or redispatched successor), `tier-routing` (judgment roles at the
  strong tier, mech-class work at or above its lint-enforced floor), `effort-routing`
  (no low effort on a review dispatch, no xhigh on a breadth sweep), and
  `artifact-placement` (dated artifacts under the vault's `80 Runs/` when the repo
  carries a vault). The slot stays open for the same reason as (d)'s.
- `result` — one of `PASS | FAIL | N/A`. Uppercase is the written convention; the
  parser reads the cell case-insensitively. `N/A` is for a rule the run could
  not violate — no vault to place artifacts in, no review dispatch to mis-effort — and
  is never a quiet pass.
- `evidence` — the ledger row, count, or path that decided the result.

A row whose shape does not match, whose result is outside the three, or whose `check`
repeats an earlier row's is **unparseable** — counted and reported, never skipped. On a
repeated check the first row wins, as in (d). Neither this grammar nor (d)
introduces a gate: both are measured and trended, and the run-level judgment stays with
the lead.

## Producer/consumer contract

Skills and `scripts/dispatch-ledger.mjs` **produce** these five shapes.
`scripts/calibration-metrics.mjs` and `scripts/revalidate-register.mjs` **consume**
them. If either consumer parses zero items from a file that is present and non-empty,
that is a **shape-drift signal, not an absence signal** — check the artifact against
the grammars above before concluding "nothing to report." The one exception is the
covered-negative register in (b): zero entries plus at least one `NO-FINDINGS:` line is
a deliberate, examined-and-clean result, not drift.

*Verified-at: 6eaf3f3*
