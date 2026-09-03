# Artifact grammars

Nine run artifacts are both written by skills and read back by mechanical tools. Read this
page before you hand-author one, or when a tool reports zero items from a file you know is
full. It is the source of truth for the nine grammars below.

Real-scale calibration runs found the metrics extractor parsing zero items from non-empty
artifacts in two straight runs. The artifacts were not empty. Their shape had drifted from
what the parser expects. Get the shape exactly right and every consumer below reads it
correctly. Drift the shape and a consumer silently reports zero, which reads as "nothing
here" instead of "wrong shape".

## (a) DISPATCH_LEDGER.md row

Five pipe-delimited cells, written by `scripts/dispatch-ledger.mjs`. Skills call
`add`, `update`, or `check` on the generator, and never hand-author rows:

```
| id | role | brief | expected artifact | status |
| --- | --- | --- | --- | --- |
| D-001 | explorer@claude-sonnet-5 | map the auth module | AUTH_MAP.md | dispatched |
```

- `id`: `D-NNN`, strictly increasing within the ledger.
- `role`: stamped `role@model` at dispatch time, as in `explorer@claude-sonnet-5`, holding
  the resolved model that actually ran the dispatch. A cell with no `@model` is a legacy
  unstamped row. It still parses, and the tier-mix metric cannot reconstruct that row. See
  [The model half of the role cell](#the-model-half-of-the-role-cell).
- `brief`: at most 10 words.
- `expected artifact`: the filename, or `diff`, the dispatch is expected to produce.
- `status`: one of `dispatched | reported | failed | redispatched`.

Rows are written at dispatch time, atomically with the dispatch call itself. The
`Dispatch ledger` passage in each plugin's `CONVENTIONS.md` says why.

The row pattern and its status set live in `scripts/ledger-grammar.mjs`, which the writer
and both readers import. Each reader counts a non-matching row as malformed rather than
failing, so three separate copies of this grammar would have drifted into quietly
undercounted dispatches. One module removes that path.

### The model half of the role cell

The role cell is one cell holding two facts. Both consumers split it on its last `@`,
because a role name that itself carried `@` would otherwise misparse the model. They read
the right half back as counts:

- **Per model.** `dispatch-ledger.mjs check` prints `model mix:` and
  `calibration-metrics.mjs` prints `tier mix:`, each a dispatch count per resolved model id.
- **Per model class.** Both also print `model-class mix:`, resolving each stamped id to a
  canonical rung through `scripts/model-tiers.mjs`, the ladder source of truth. Raw ids
  change whenever a provider moves its lineup. The rungs do not, so the class mix is what
  stays comparable across runs, across months, and across providers.

Three answers are possible, and the last two are refusals rather than guesses:

| Class | When | Why not a rung |
| --- | --- | --- |
| `light` · `mid` · `strong` · `frontier` | the id serves exactly one rung in `PROVIDER_TIERS` | n/a |
| `ambiguous` | the id serves several rungs (`grok-4.6` serves all four; `gemini-3.1-pro-preview` serves two) | a single-model ladder carries no tier signal, and naming one rung would invent a distinction the provider does not make |
| `unclassified` | the id is real but sits in no pinned ladder | a model this repo has not pinned cannot be placed by the shape of its name, and a wrong placement reads as a routing verdict |

A row with no stamp, or one whose model half is empty (`explorer@`), is `unstamped` in both
lines. It gets its own bucket and is never folded into a class, because a hole in the record
is not a tier that was observed. The addition is backward compatible in both directions. A
bare `role` cell stays valid and still parses, and absence is reported as `unstamped`, never
as an error.

The forward-looking consumer of the same grammar is `scripts/estimate-run-cost.mjs`. It
reads prior runs' ledgers before a run, to estimate that run's dispatch count and class mix.
See [handbook 09 § Pre-run estimation](../Handbook/09-cost-and-scoping.md).

### Phase markers

A ledger may be segmented by phase-marker lines, written by the generator rather than
hand-authored:

```
node scripts/dispatch-ledger.mjs phase --ledger <file> --title <title> --lead-model <id>
```

The line it writes looks like this:

```
> phase: Phase 2 bug hunt · lead@claude-opus-5
```

The form is `> phase: <title> · lead@<model>`. Every row following a marker belongs to that
phase, until the next marker. The addition is non-breaking, because existing parsers skip
non-pipe lines, so a ledger with markers still parses row for row exactly as before.
`dispatch-ledger.mjs check` fails closed on a malformed `> phase:` line rather than skipping
it as prose, whether the fault is a missing title, a missing ` · lead@`, or an empty model.
`calibration-metrics.mjs` reports the lead model per phase, and raises an advisory when the
lead model changes mid-run. A lead swap between phases is a legitimate but noteworthy event,
not a silent one.

### Orchestration rates are journal-first

`dispatch-ledger.mjs` also maintains a write journal beside the ledger,
`DISPATCH_LEDGER.md.journal.jsonl`, holding one JSONL entry per `add`, `update`, or `phase`,
appended at write time. `check` replays it to catch phantom rows.
`calibration-metrics.mjs` replays it for a second reason. A row's `status` cell holds only
the final status, so a unit that failed and was then retried reads as `redispatched` alone.
Failed rate and redispatch rate were therefore mutually exclusive for one unit, and the pair
understated recovery.

So the two rates are derived journal-first:

- **Journal present and clean**: per-unit history is replayed from it. A unit counts toward
  the failed rate if it ever entered `failed`, and toward the redispatch rate if it was ever
  redispatched, independently. The report says `rate basis: journal-derived`.
- **No journal**, meaning a pre-journal artifact folder: the snapshot statuses are counted
  exactly as before, and the report says `rate basis: snapshot-only`.
- **Journal present but malformed**: an unreadable line means the journal cannot be trusted
  to prove anything, so it is rejected whole and never partly used. Each violation prints as
  `!! JOURNAL`, and the basis line names the fallback, so a degraded rate is never silent.

The dangling rate is untouched by any of that, because still-`dispatched` is a question
about the final status by definition. `by status` likewise keeps reporting the snapshot.

## (b) FINDINGS_REGISTER.md entry

An entry begins where an item ID matching `revalidate-register.mjs`'s `ID_RE` appears at
entry-heading position. The ID grammar is:

`/\b([A-Z][A-Z0-9]{1,}-[A-Z]?\d{1,6})\b/g`

That is a prefix of two or more uppercase alphanumerics starting with a letter, a hyphen, an
optional single uppercase round-letter, then 1 to 6 digits. Examples: `BUG-007`, `PERF-003`,
`FEAT-012`, and `FND-A12`. The optional round-letter exists because real runs number
findings per review round (`FND-A12`, `FND-B03`). Before it was added, a whole run's
lettered IDs matched nothing and were counted as zero findings.

Two guards keep the grammar from over-matching. They live in `isItemId`, mirrored in
`scan-narration.mjs` and `calibration-metrics.mjs`:

- The prefix is dropped if it is a known standards token, so `RFC-2616` and
  `CVE-2021-44228` never register as items. The tokens are `RFC`, `ISO`, `CVE`, `CWE`,
  `CAPEC`, `GHSA`, `UTF`, `SHA`, `MD`, `AES`, `RGB`, `HTTP`, `HTTPS`, `IEEE`, `ANSI`,
  `FIPS`, `NIST`, `PEP`, `ECMA`, `UTC`, `GMT`, and `IPV`.
- A trailing hyphen followed by another digit marks a longer numeric token rather than a new
  item boundary. So `CVE-2021-44228` is not split mid-string, while a slug suffix like
  `BUG-042-auth-bypass` still counts as one item.

### Entry-heading position

Matching the ID grammar is necessary and not sufficient. An ID creates an entry only at
entry-heading position: at the start of a line, optionally preceded by up to six `#` heading
markers (`### BUG-007 auth bypass`), or by a table row's leading pipe (`| BUG-007 | … |`,
for table-form registers). An ID-shaped token sitting mid-line inside evidence prose no
longer opens an entry, so a paragraph that mentions three sibling findings does not inflate
the count to four. The refutation-log grammar in (c) matches its receipts at the same
position, for the same reason.

### Where an entry ends

An entry runs to the last line that belongs to it. It is terminated by whichever of these
comes first:

- the next entry head
- a covered-negative `NO-FINDINGS:` line (see below)
- a non-entry markdown heading (`## Covered negatives`, `## Method notes`), which is a
  section boundary rather than part of the entry above it
- end of file

Both consumers of the per-entry budget apply that rule. Without a terminator, a register's
trailing covered-negative block was attributed to the final entry and reliably tripped that
entry's hard cap on a register whose entries were every one of them tight. A real
calibration run's 47-finding register failed on its last entry, for lines it did not own.

### Conforming and non-conforming IDs

| Example | Counts? | Why |
| --- | --- | --- |
| `BUG-003` at line start | yes | 3-char letter prefix, hyphen, 3 digits, entry-heading position |
| `### FND-A12` | yes | optional single uppercase round-letter `A` before the serial |
| `F-001` | no | single-letter prefix; the grammar needs two or more prefix characters |
| `BUG-b3` | no | lowercase round letter; the round-letter slot is uppercase only |
| `BUG-12A` | no | letter *after* the serial; the ID must end at the digits |
| `…as noted in BUG-003 above…` | no | right shape, wrong position: mid-sentence in evidence prose, not an entry heading |

The last two rows are the pair that bit a real calibration run from opposite sides. The
lettered IDs the run actually used went silently invisible, while ID-shaped tags in prose
were counted as entries.

### Covered negatives

A slice that was examined and found clean is recorded with a covered-negative line, at the
start of a line in `FINDINGS_REGISTER.md`:

```
NO-FINDINGS: token refresh path — traced all 3 call sites, every branch re-checks expiry
```

The form is the token `NO-FINDINGS:`, then the slice label, then a spaced em-dash, then a
one-line reason or piece of evidence, exactly as the example above shows.
`calibration-metrics.mjs` reports these as `covered negatives: N`. The line answers the
question a bare empty register cannot. Was this slice examined and clean, or did the
dispatch fail? A register with zero entries and one or more `NO-FINDINGS:` lines is a
covered negative rather than shape drift, so the zero-items warning is suppressed for it.

### Findings live in FINDINGS_REGISTER.md

Register-shaped entries written into a themed sibling report draw a not-counted warning from
the extractor, whether the file is `SECURITY_FINDINGS.md`, `PERF_NOTES.md`, or any other
`.md`. Those entries exist and are invisible to every register consumer. Findings belong in
`FINDINGS_REGISTER.md`, and a sibling report links to entries there rather than restating
them in entry shape.

The sweep that raises the warning walks the artifact folder recursively, bounded by a depth
cap, skipping dot-directories and `node_modules`. So a per-slice report written into a
subdirectory is seen rather than silently exempt. Top-level-only, an entire run's per-slice
reports stayed invisible. `calibration-metrics.mjs`'s own report is not a run artifact and
is excluded from the sweep, by its `--out` or `--json` path and by the
`# calibration-metrics — ` header it always opens with. The per-entry length lines it emits
(`    FIND-004: 26 non-blank line(s)`) sit at entry position and would otherwise read back
as a register.

Every entry carries the `Finding` schema fields (CONVENTIONS `§7`): `Tier`
(`CONFIRMED|PROBABLE|SPECULATIVE`), `Location`, `Anchor`, `Verified-at`, `Evidence`,
`Disconfirmation`, `Refutation`, `Impact`, `Recommendation`, `Track`
(`NOW-SAFE|NEEDS-REVIEW|NEEDS-DESIGN`, CONVENTIONS `§6`), `Effort`, `Risk-if-fixed`, plus
`Severity`, `Confidence`, `Lens`, and `Scope`. An item with no `Tier:` field, or a value
outside the known three, is unparseable to `calibration-metrics.mjs`. It is counted, never
silently dropped.

Both `scan-narration.mjs` and `calibration-metrics.mjs` apply a per-entry length budget to
register-shaped files with parseable entries: advisory at 10 non-blank lines per entry, hard
at 20. The preamble before the first entry gets its own budget, advisory 15 and hard 30. A
normal `Tier/Location/Anchor/...` block runs about 5 to 8 lines and passes cleanly, because
the budgets flag prose padding rather than finding count. The flat file-level cap, 60
advisory and 120 hard, is the fallback only, for a register-shaped file whose entries do not
parse. A register with many legitimate findings is no longer penalized for its length by
either tool.

## (c) REFUTATION_LOG.md receipt line

One receipt per line, keyed by the finding's own ID at the start of that line, and
middot-delimited (CONVENTIONS `§7`):

```
SEC-003 · r1 · SURVIVED · reviewer · searched: caller chain + middleware
BUG-007 · r2 · REFUTED · reviewer · src/api/limits.ts:88 · Anchor: `clamp(size, MAX)`
```

The fields are item ID, panel round, verdict (`SURVIVED|REFUTED`), panelist role, and
evidence. Evidence is the search trail for `SURVIVED`. For `REFUTED` it is a re-greppable
`file:line` plus a backtick-delimited or quote-delimited `Anchor`, so
`revalidate-register.mjs --refutation-log` can confirm the killing guard still exists. A
line that opens with an item ID and carries neither verdict token is unparseable, not
silently skipped.

Receipt position mirrors the entry-heading position of (b). The ID must sit at the start of
the line. A line that cites findings mid-sentence, such as "the panel read BUG-001 as a
duplicate of BUG-003", is prose rather than a receipt. Matched mid-line, such a round note
was counted as an unparseable receipt, and a note that happened to contain the word
`REFUTED` attached itself to the finding it cited as a second, unanchored verdict.

## (d) CONFORMANCE_REPORT.md surface row

One row per standardization surface, written by `/code-ops-suite:conform` Phase A and
re-written with the closing output in Phase C. Four pipe-delimited cells:

```
| surface | verdict | checker | evidence |
| --- | --- | --- | --- |
| vault | DRIFTED | check-vault-standard.mjs | 3 notes carry no `type` frontmatter |
| atlas | UNKNOWN | atlas-check.mjs check | manifest did not parse |
```

- `surface`: a kebab slug naming the surface. The five the skill walks are `contract`,
  `vault`, `atlas`, `doc-alignment`, and `global-contract`. The slot stays open so a profile
  can add one without editing the parser.
- `verdict`: one of `CONFORMANT | DRIFTED | ABSENT | UNKNOWN`. Uppercase is the written
  convention, and the parser reads the cell case-insensitively. `UNKNOWN` is the verdict for
  a checker that could not run. A check that did not execute proves nothing, and recording
  it as `CONFORMANT` is the failure this enum exists to prevent.
- `checker`: the command whose exit code decided the verdict, or `none` for a surface with
  no mechanical check. A prose reading is not a checker.
- `evidence`: a pointer to the output that decided it, meaning the failing line, the count,
  or the exit code, optionally preceded by the opening verdict when Phase C re-writes the
  row. Never a general impression.

A row is unparseable when its shape does not match, when its verdict is outside the four, or
when its `surface` repeats an earlier row's. An unparseable row is counted and reported,
never skipped. On a repeated surface the first row wins, because the file carries one row
per surface, so a duplicate is a producer defect rather than a second opinion.
`calibration-metrics.mjs` reports the per-surface verdict counts, so drift becomes a trended
series rather than a one-off reading.

## (e) RUN_CONFORMANCE.md check row

One row per mechanically checkable discipline rule, written by
`/code-ops-suite:run-cost-audit` over a completed run's artifact folder. Three
pipe-delimited cells:

```
| check | result | evidence |
| --- | --- | --- |
| ledger-coverage | PASS | 7 dispatches, 7 ledger rows |
| tier-routing | FAIL | D-004 reviewer routed below the strong tier |
| artifact-placement | N/A | target repo carries no vault |
```

- `check`: a kebab slug naming the rule. The five the audit scores are `ledger-coverage`
  (every dispatched agent has a ledger row, cross-checked against the `DISPATCH_LEDGER`
  grammar in (a)), `no-dangling` (no row left `dispatched` with no reported, failed, or
  redispatched successor), `tier-routing` (judgment roles at the strong tier, mech-class
  work at or above its lint-enforced floor), `effort-routing` (no low effort on a review
  dispatch, no xhigh on a breadth sweep), and `artifact-placement` (dated artifacts under
  the vault's `80 Runs/` when the repo carries a vault). The slot stays open for the same
  reason as (d)'s.
- `result`: one of `PASS | FAIL | N/A`. Uppercase is the written convention, and the parser
  reads the cell case-insensitively. `N/A` is for a rule the run could not violate, such as
  no vault to place artifacts in or no review dispatch to mis-effort. It is never a quiet
  pass.
- `evidence`: the ledger row, count, or path that decided the result.

A row is unparseable when its shape does not match, when its result is outside the three, or
when its `check` repeats an earlier row's. An unparseable row is counted and reported, never
skipped. On a repeated check the first row wins, as in (d). Neither this grammar nor (d)
introduces a gate. Both are measured and trended, and the run-level judgment stays with the
lead.

## (f) RUN_CONTRACT.json and RUN_CONTRACT_RESULT.json

`RUN_CONTRACT.json` is the run's versioned intent and work graph. Generate it after Phase 0,
then run `scripts/run-contract.mjs check` before fan-out. Version 2 is the bounded-run
contract. Version 3 adds runtime state for multi-phase or resumable runs. Its top-level
fields are:

```
version · revision · runId · head · objective · nonGoals · lead · quality · budget
sharedContext · replanOn · units · context (versions 2 and 3) · runtime (version 3 only)
```

Quality is a vector of named dimensions and stable `Q-NNN` criteria. Each criterion names
its oracle, required proof, blocking state, and acceptance owner. A unit has a stable
`D-NNN`, phase and wave, lens, read and write mode, role, work kind, resolved model and
tier, effort, short brief, scope, artifact, dependencies, and linked criteria.

The compiler rejects unknown keys, stale HEADs, invalid routing, dependency cycles,
overlapping same-wave writes, undeclared criteria, and budgets smaller than the graph.
Learning may revise the contract, and then `revision` increases and `replanOn` states why.
Actual dispatches never silently rewrite intent.

Version 2 binds `context.snapshot`, `snapshotId`, `bundleDir`, `untrackedPolicy`,
`maxBundleBytes`, and `maxAtlasExcerptBytes`. `context-drift` joins the canonical replan
triggers. A snapshot or bundle that does not match the current visible state fails before
dispatch.

Version 3 retains the version 2 context binding. Its `runtime` declares a capability
descriptor, receipt chain, stable-prefix paths and byte cap, and one policy per capability.
`HOST_CAPABILITIES.json` records host, provider, model, observation source, timestamp, and
states for prompt caching, compaction, context editing, host memory, and task budget. Do not
infer those states from the model name. A required unavailable capability fails validation.

`RUN_RUNTIME_RECEIPTS.jsonl` is a hash-chained sequence of `init`, `checkpoint`, `resume`,
`replan`, and optional observation receipts. Each runtime binding includes contract,
snapshot, host-capability, and stable-prefix digests. A resume repeats the latest checkpoint
references. A replan preserves `runId` and advances `revision` by one. Binding drift blocks
continuation until a replan records the next valid contract. Cache observations are optional
telemetry. They accelerate work when observed, and they never replace receipts or artifacts.

The stable prefix is deterministic UTF-8 content from regular stage-0 tracked files without
linked components, within its declared byte cap. `run-runtime.mjs prefix` emits it, and no
script injects it into a host. Use it only when the selected host can inject that exact
payload. The runtime receipt chain serializes mutations with a sibling lock directory. A
surviving lock requires owner and chain inspection before manual removal.

`RUN_CONTRACT_RESULT.json` is a compiler-owned terminal artifact. `finalize` creates it only
after strict plan-to-ledger reconciliation and PASS evidence for every blocking criterion.
Its `status` is therefore always `PASS`. Absence means active, failed, or unfinalized, never
success. Cost estimation excludes contract-backed runs without this successful result.

## (g) CONTEXT_SNAPSHOT.json and context bundles

`CONTEXT_SNAPSHOT.json` records the exact visible repository identity: HEAD, tracked diff,
index entries, untracked policy and digests, ignored-content policy, generator digests, and
the content-addressed index key. It never records raw untracked content. An unchanged state
reuses the cached repo map, import graph, and Atlas report exactly.

A unit bundle is JSON with `status: READY`, run and revision binding, unit ID, snapshot ID,
compiler digest, scope, selected map entries, direct import edges, visible scoped changes,
optional delta, freshness-gated Atlas excerpts, and completeness labels. `bundleId` hashes
the semantic payload. `actualBytes` is informational and excluded from that hash.

The compiler writes `<bundle>.BROAD_CONTEXT_REQUIRED` when bounded selection would be
unsafe. It writes `<bundle>.BUDGET_EXCEEDED` when the complete bundle exceeds its declared
budget. It does not truncate either case.

## (h) DOCS_MANIFEST.json and extraction plans

`code-ops-docs/98 System/DOCS_MANIFEST.json` is the only documentation registry. Each domain
has a kebab ID, hub-relative target, `current` or `not-applicable` status, source patterns,
source digest, and content digest. `not-applicable` requires concrete evidence.

An extraction plan records the manifest digest, changed-path digest, and one `DOC-NNN` task
per affected domain. Each task names one canonical target and the changed source paths that
triggered it. Domains outside the source-delta intersection receive no task.

## (i) ACCEPTANCE_LEDGER.md row

Six pipe-delimited cells, appended only through `scripts/run-contract.mjs record`:

```
| criterion | attempt | verdict | proof | accepted by | reason |
| --- | --- | --- | --- | --- | --- |
| Q-001 | 1 | PASS | node evals/run-contract/run.mjs | tool | regression eval passed |
```

- `criterion`: a `Q-NNN` declared in the matching contract.
- `attempt`: strictly increasing for that criterion. Later attempts preserve earlier failures.
- `verdict`: one of `PASS | FAIL | UNKNOWN | N/A`.
- `proof`: the replayed command, receipt, review artifact, or concrete observation.
- `accepted by`: `tool`, `user`, or an authorized `lead@model` or `reviewer@model`.
- `reason`: optional context, never a substitute for proof.

The latest attempt decides finalization. Every blocking criterion must end at `PASS`. `N/A`
is explicit non-applicability, not a quiet pass. Operative `reported` status is execution
state, not acceptance state.

## Producer and consumer contract

Skills and the run-artifact scripts produce these artifacts.
`scripts/calibration-metrics.mjs`, `scripts/revalidate-register.mjs`,
`scripts/run-contract.mjs`, and `scripts/estimate-run-cost.mjs` consume them. Reach any of
them through the `co` entrypoint, as in `co calibrate metrics` and `co run contract`.

If a consumer parses zero items from a file that is present and non-empty, that is a
shape-drift signal rather than an absence signal. Check the artifact against the grammars
above before concluding there is nothing to report. The one exception is the covered-negative
register in (b). Zero entries plus at least one `NO-FINDINGS:` line is a deliberate,
examined-and-clean result, not drift.

*Verified-at: b0ffede*
