---
type: design
status: draft
updated: 2026-10-14
tags:
  - design
  - evals
  - benchmark
---

# Beat the bare model benchmark

This design defines a repeatable benchmark that answers one question per skill: does running the skill beat the bare model on the same task? The first snapshot covers the five highest-traffic skills: `rigor:bug-hunt`, `rigor:deep-review`, `code-ops-suite:debug`, `code-ops-suite:codebase-audit`, and `code-ops-suite:ship`. The benchmark result is the north-star metric for the suite. Each skill gets a KEEP, FIX, or RETIRE verdict from a rule fixed before the first scored run.

## Why the current evidence is not enough

The suite has one measurement against a no-skill control, and it cannot carry a keep or retire decision. The evidence has four gaps:

- The control arm in [FLOOR_TABLE.md](../../evals/FLOOR_TABLE.md) runs on 7 toy fixtures. Recall is saturated on most of them, so the only axis that moved was tier inflation (weak with-skill about 26 against control about 58, FLOOR_TABLE.md:127-130).
- The floor arms hand `SKILL.md` text to a read-only agent. They measure skill prose, not the installed plugin with its agents, hooks, and scripts. FLOOR_TABLE.md:168 concludes that prose has hit its ceiling, so prose is the wrong unit to test.
- The real-scale calibration runs in [CALIBRATION_TABLE.md](../../evals/CALIBRATION_TABLE.md) have no control arm and no seeded defects. Defect seeding is optional in the protocol ([calibration-protocol.md](../40%20Engineering/Techniques/calibration-protocol.md), section "Optional: defect seeding"), so real-scale recall is unmeasured.
- The weak arm moved to `claude-haiku-5-5` on 2026-10-07 and has not been re-measured (FLOOR_TABLE.md:35).

The investment split makes the gap urgent. Since September, about 9k changed lines went to skill content and about 79k to scripts, and no instrument says which of either earns its cost.

## Terms

This document uses these terms with one meaning each:

- **Skill arm**: a run of the installed plugin, with the skill invoked by its slash command.
- **Control arm**: a run of the same host and model with no plugin, no hooks, and no user or project instructions.
- **Target**: a vendored, real-scale source tree that tasks run against.
- **Seed**: one declarative edit to the target. A defect seed plants a real bug. A decoy seed plants code that looks wrong and is correct.
- **Task**: one skill, one target, one seed set, and one neutral task statement.
- **Unit**: one run of one task in one arm at one rep.
- **Snapshot**: one complete pre-registered execution of every unit, under fixed model ids, host version, and plugin tree.
- **Primary metric**: the single per-skill number the verdict rests on.
- **Guard metric**: a per-skill number that must not regress past its bound.
- **Minimum delta**: the smallest primary-metric gain that justifies the skill's cost.

## What the arms compare

The skill arm and the control arm differ in one variable: whether the plugin is loaded and its skill invoked. Both arms hold these fixed:

- The host and its exact version (`claude` 2.1.293 at the time of writing).
- The lead model id, pinned per snapshot.
- The sandbox contents, the tool set, the permission mode, and the per-unit dollar cap.
- The neutral task statement and the exit contract, byte for byte.

The skill arm prompt is the slash command, then the neutral task statement, then the exit contract. The control arm prompt is the neutral task statement, then the exit contract. The task statement names no defect class, file, or fixture topic. That removes the topic-hint threat that FLOOR_TABLE.md:85-87 records for the floor control prompt.

Both arms run with `claude -p --bare`. Bare mode skips settings hooks, plugin sync, auto-memory, and `CLAUDE.md` discovery. The skill arm adds `--plugin-dir` for the plugin under test, copied from the pinned plugin tree. The benchmark therefore measures the installed plugin: skill text, agents, hooks, and vendored scripts together. Probe P-1 must confirm that `--bare` still runs hooks from a `--plugin-dir` plugin. The help text says bare mode skips hooks "by installed plugins", which is ambiguous for a directory plugin. If P-1 fails, both arms run without `--bare` under a fresh, empty `CLAUDE_CONFIG_DIR` per unit, which gives the same isolation by a different route.

Both arms deny `WebFetch` and `WebSearch` through `--disallowedTools`. A run with web access could fetch the upstream pristine source and diff it against the seeded target.

The plugin also ships MCP servers, and `get-docs` and `resolve-library` can fetch over the network. That path exists only in the skill arm, and the transcript audit cannot see inside it. Both arms therefore run with `--strict-mcp-config` and an MCP configuration that holds only the plugin's local servers with network fetch disabled. If a server cannot run without network access, the report declares it as a confound. Probe P-1 covers MCP loading as well as hooks and agents.

## Targets and fixture sizes

The benchmark uses one vendored real-scale target in the first snapshot, with a second target deferred. The toy fixtures stay in place as regression guards and do not feed the verdict.

The real-scale target must meet every rule below:

- Runtime source between 5,000 and 15,000 lines, excluding tests, docs, and generated files.
- Zero runtime dependencies, and only relative and `node:` imports in source and tests. `scripts/check-no-deps.mjs` walks the whole repository, so a bare third-party import in the vendored tree fails the gate.
- Source that runs on Node with no build step. The upstream test suite is not vendored. The benchmark authors its own `node:test` suite: a pristine characterization suite that detects regressions, plus the hidden oracle tests. Dropping the upstream tests removes their devDependencies and keeps the hidden test oracle cheap and hermetic.
- A permissive license, vendored with its `LICENSE` file and a provenance note that pins the upstream commit.
- Plain JavaScript with no build step.

The target must not be this repository. The skill arm loads plugins whose `scripts/` directories are byte-identical copies of this repository's `scripts/`, so the skill arm could diff a seeded copy against its own pristine one. The skills also encode this repository's conventions, which would favor the skill arm for reasons unrelated to skill quality.

The target lives at `evals/bench/targets/<name>/` as a tracked tree. Vendoring adds no new egress at run time, and the tree digest binds every plan. The candidate shortlist is in the appendix. The final pick is a build-phase step.

## Seeds

Seeds are declarative records, never free-form patches. Each record holds:

- `id`, `kind` (`defect` or `decoy`), and `class`.
- `base`: null for a seed on the pristine target, or the id of the review change it sits in.
- `file`, `find` (an exact snippet that occurs once in the seed's base), and `replace`. A based seed's `find` must sit in text that the change adds.
- `oracle`: the hidden test file that fails when the defect seed is present, or that passes for a decoy seed.
- `symptom`: for repair tasks, an issue-style description of the observed behavior with no file or line.

The defect classes follow the calibration bug classes: an off-by-one boundary, an inverted or missing guard, a wrong default, a swallowed error, a missing `await` or wrong ordering, a wrong variable, and an unsafe input path. Decoy seeds are equivalent mutants that look like a class and are correct. Examples are a guard moved into the sole caller and a defensive re-check that is redundant but harmless.

Seeds live in `ANSWER_KEY.seeds/<group>.json`, one file per skill group, so parallel authors write disjoint files. Changes live in `ANSWER_KEY.changes/<id>.json`. A `review` change is the commit a deep-review task reviews, and a `reference` change is a ship task's reference solution, which proves that its acceptance test can be passed. Oracles and acceptance tests live in `ANSWER_KEY.oracles/`. `bench.mjs` excludes every `ANSWER_KEY.` path segment from the tree digest and from every copy. The per-task answer key with post-injection line numbers is derived at plan time into the run folder. It is never tracked.

`bench.mjs check` validates seeds with no model in the loop and runs in CI:

- Each `find` snippet occurs exactly once in the pristine target.
- Seeds in one task sit at least 10 lines apart in the same file.
- With one defect seed applied, its oracle fails and every pristine test still passes.
- With one decoy seed applied, its oracle and every pristine test pass.
- No `replace` text contains a tell word such as `bug`, `seed`, `planted`, `decoy`, `TODO`, or `FIXME` that the pristine snippet lacked.
- The derived answer key regenerates byte-identical from the seeds and the target.

The pilot may change the number of seeds per task and the class mix. The pilot never drops an individual seed because the control arm missed it. Per-item selection on control misses would bias the seed set.

## Tasks per skill

Each skill gets its own task shape, primary metric, and minimum delta. The verdict never compares one skill against another.

| Skill | Tasks | Task shape | Primary metric | Minimum delta |
| --- | --- | --- | --- | --- |
| `rigor:bug-hunt` | 2 | Whole target, 6 defect seeds and 4 decoy seeds | Keyed F0.5 | +0.10 |
| `code-ops-suite:codebase-audit` | 2 | Whole target, 8 defect seeds over 4 lens classes and 4 decoy seeds | Keyed F0.5 | +0.10 |
| `rigor:deep-review` | 3 | A change commit on the target: two carry 2 defect seeds and 2 decoy seeds, one is clean with 2 decoy seeds | Keyed F0.5 on the two defective changes | +0.10 |
| `code-ops-suite:debug` | 3 | One defect seed, given as a symptom report | Resolved rate | +0.20 |
| `code-ops-suite:ship` | 2 | A small feature specification with hidden acceptance tests | Accepted rate | +0.20 |

Keyed F0.5 is 0 when a unit has no keyed hits, so a unit with no findings never divides by zero. F0.5 weights precision twice as heavily as recall, which matches the suite's claim of fewer findings that are real. Keyed precision counts decoy hits only. Unkeyed findings on a real target can be native bugs, so they never count as false positives automatically.

A debug unit is resolved when the hidden oracle passes and no pristine test regresses. A ship unit is accepted when every hidden acceptance test passes and no pristine test regresses. Ship stops at a committed branch, because the sandbox has no remote. The exit contract says so in both arms.

## Guard metrics

Each guard has a bound. A skill that wins on its primary metric and breaches a guard gets FIX, not KEEP. The guards are:

- **Inflation rate**: CONFIRMED findings whose proof does not resolve, or that hit a decoy, divided by all CONFIRMED findings. Bound: skill arm at most control plus 0.05.
- **Decoy hits per task**: bound: skill arm at most control plus 0.5.
- **Regressions**: pristine tests broken by the run's edits, for debug, ship, and codebase-audit (which applies safe fixes). Bound: skill arm at most control.
- **False blocks**: a block verdict on the clean deep-review change. Bound: skill arm at most control.
- **Unkeyed findings per 1,000 lines**: reported for both arms. Bound: skill arm at most 1.5 times control, unless the adjudication sample below shows that at least half of the skill arm's extra findings are true.

The inflation guard reuses the proof resolver in `scripts/revalidate-register.mjs`: a matching `RCPT-NNN` receipt, an in-tree file, or a test name in a test file resolves, and an unexecuted command does not (FLOOR_TABLE.md:173-176). The guard does not apply the suite's strict register schema. That schema requires suite-only fields such as `Disconfirmation` and `Track`, which the control arm has no reason to emit.

Adjudication is a fixed sample of 10 unkeyed findings per arm per detection skill, judged blind to arm by the operator or a strong-tier judge. It runs only when the unkeyed guard decides the verdict.

## Cost and time

The benchmark records cost and wall time for every unit, and the verdict caps them. The measures are:

- **Cost**: `total_cost_usd` from the final stream-json result, plus input, output, and cache tokens. Probe P-2 must confirm that the result includes subagent spend by comparing it against the transcript total from the existing transcript parser. If P-2 fails, the runner sums the transcript instead.
- **Wall time**: the runner's clock from process spawn to exit.
- **Turns**: `num_turns` from the result.

Every unit runs under the same `--max-budget-usd` cap in both arms. The pilot sets the cap at twice the highest pilot unit cost. A unit that hits the cap is scored as it stands, never voided, and the report counts cap hits per arm as a declared confound.

The cost cap for KEEP is a skill-to-control ratio of 4.0 on mean cost and 4.0 on mean wall time.

## Reps and the statistic

Each task runs 4 reps per arm. That gives 8 to 12 rep pairs per skill and 96 units per snapshot. Real-scale recall is not saturated, so the strong-arm n=1 sanity rule from the floor protocol does not apply.

The effect for a skill is the mean over its tasks of the per-task difference in arm means on the primary metric. The uncertainty is a stratified bootstrap: resample reps with replacement inside each task and arm, 10,000 iterations, from a fixed seed, so the interval is deterministic. The report states the 90% interval.

The runner interleaves arms and tasks in a fixed alternating order. Provider latency and load drift then fall on both arms alike.

## Verdict rule

The rule is fixed before the first scored run. It applies per skill, in this order:

1. **INCONCLUSIVE (instrument)**: the control arm scores at least 0.9 on the primary metric on every task, or more than 25% of the skill's units are void. The fixture must change. Saturation never yields KEEP.
2. **KEEP**: the effect is at least the minimum delta, the interval's lower bound is above 0, every guard holds, and both cost ratios are at most 4.0.
3. **FIX (cost or guard)**: the effect clears the minimum delta and the lower bound is above 0, but a guard or a cost ratio fails. The fix is a mechanical backstop or a cut in dispatches, not more prose (FLOOR_TABLE.md:168-178).
4. **FIX (guard value)**: the interval includes 0 on the primary metric, but the skill beats control on the inflation or decoy guard by at least twice its bound. The skill's value is honesty, not recall, so the fix makes that value cheaper or moves it into a gate.
5. **RETIRE candidate**: the interval's upper bound is below the minimum delta, and step 4 does not apply.
6. **INCONCLUSIVE (power)**: any other case. A larger n runs only as a new, pre-registered snapshot. No snapshot is extended after its results are seen.

A skill also gets INCONCLUSIVE (power) before steps 2 to 5 when a task in the bootstrap has fewer than 2 scored units in either arm. With one sample per arm, every resample returns the same value, so the interval collapses to a point and cannot support KEEP, FIX, or RETIRE. A zero-width interval at 2 or more units per arm, such as every skill unit passing and every control unit failing, is a real separation and keeps its branch. This check was added on 2026-10-16, after snapshot-tau-bhca gave a RETIRE candidate at one rep per arm; it applies to every snapshot from then on.

A RETIRE candidate becomes RETIRE only when a second snapshot gives the same verdict. The operator may authorize one FIX attempt between the two snapshots. Every verdict is a recommendation, and the operator owns retirement.

## Answer-key isolation

Isolation is enforced by checks, not by instructions. Each unit runs in a sandbox under the operating system temp directory, outside this repository. The sandbox is a fresh Git repository with one commit by a fixed author at a fixed date, so history shows no seed. Deep-review tasks get a second commit that holds the change under review.

The sandbox holds the seeded target and its pristine characterization suite, so both arms can run tests and write failing ones as proof. The characterization suite is designed not to fail on any seed, which `bench.mjs check` enforces. The pristine target, the seeds, the derived answer key, and the hidden oracle tests stay in the run folder under `code-ops-docs/80 Runs/`. Oracle tests enter the sandbox only after the agent process exits.

The skill arm's plugin copy lives in a third location: a sibling of the sandbox under the operating system temp directory, never under this repository or the run folder. The plugin's own Bash calls cite that path, so the audit treats it as the one allowed path outside the sandbox.

The plan writes a random 32-hex canary into the derived answer key and into the pristine target's run-folder copy. After each unit, `bench.mjs run` audits the full stream-json transcript and the findings file. A unit is void when any of these appear:

- The repository root path, the run folder path, the bench targets folder, the key file, or the key helper in any tool input. The audit matches absolute, home-relative (`~`, `$HOME`, `%USERPROFILE%`), and relative forms.
- The string `ANSWER_KEY`, in any letter case, or the canary anywhere in the transcript or the findings.
- The upstream project name inside a network command such as `curl`, `git clone`, `npm view`, `gh api`, or `Invoke-RestMethod`, or an upstream URL in any tool input.

A void unit reruns once under the same plan. A second void leaves the unit void, and the void counts toward the instrument rule. `--bare` confines nothing for Bash, so the audit is the enforcement. An operating-system boundary, such as a separate user account, is an optional hardening.

Both arms run with deny rules for host-wide process kills, such as `taskkill`, `pkill`, `killall`, and `Stop-Process`. In earlier runs a unit ran `taskkill /F /IM node.exe` and stopped the runner. Bare mode skips hooks, so the deny rules are command-line flags. Before each attempt the runner writes an in-flight marker. If the runner stops, the next start finds the marker, records the attempt as killed, and runs the unit again.

Every attempt's spend is recorded, including a voided first attempt and a killed attempt. A killed attempt with no result line is recorded as unrecorded spend. The report states the total spend, the void spend, and the number of killed attempts.

The unit and its test runs get an allowlisted environment: the variables the claude binary and Git Bash need to start, with HOME, USERPROFILE, APPDATA, and LOCALAPPDATA pointed at a scratch folder. Tokens such as `GH_TOKEN` stay out. The key helper lives in its own temporary folder outside the sandbox, and the API key is masked as `<REDACTED:api-key>` in the saved transcript. `plan` refuses a run folder inside the repository that git does not ignore. The runner computes the proofs before it copies the oracles in, checks plan drift before each unit, and stops on an attempt with no result line unless the attempt timed out.

## Exit contract

Both arms end their prompt with the same exit contract, so the scorer reads one format. Detection tasks write `BENCH_FINDINGS.json` at the sandbox root. Each entry holds `file`, `line`, `anchor` (a verbatim substring of the cited line), `tier` (`CONFIRMED`, `PROBABLE`, or `SPECULATIVE`), `proof`, and `summary`. Deep-review tasks also write a `verdict` of `block` or `approve`.

Repair and build tasks commit their change in the sandbox repository and write `BENCH_SUMMARY.json` with a root-cause `file` and `line` and a summary. The contract states that no remote exists and that the run ends at a committed change.

The sandbox also holds the task's contract section as `CLAUDE.md`, committed in the initial import in both arms, so subagents that the skill dispatches load it too. A vendored target may not ship its own agent instruction file. The detection section also requires every proof file to stay inside the repository, because the scorer resolves a proof only against files in the sandbox. Pilot-4 showed why that rule is necessary: a codebase-audit unit had the contract as `CLAUDE.md` and still wrote its reproductions to a scratch folder under the operating system temp directory, so 1 of its 11 CONFIRMED proofs resolved.

Scoring reuses the matching rules of [score.mjs](../../evals/score.mjs): path suffix plus basename, a line tolerance of 3, and an ambiguous flag scored as the decoy.

## Harness

The benchmark is a separate harness under `evals/bench/`. It does not extend `evals/judgment-matrix.json`, because `scripts/judgment-evals.mjs` validates that file with exact keys at version 1. Its planner contract is also read-only units with an answer-key-free brief, which does not fit sandboxed runs with edits. The bench harness reuses the binding pattern and the helpers in `scripts/context-index-lib.mjs`: digests, atomic writes, and Git reads.

| Path | Role | In CI |
| --- | --- | --- |
| `evals/bench/bench-matrix.json` | Targets, tasks, skills, task statements, and seed-set ids | Shape checked |
| `evals/bench/targets/<name>/` | The vendored target with its license and provenance note | Tree digest checked |
| `evals/bench/targets/<name>/ANSWER_KEY.{seeds,changes,oracles}/` | Seeds, review and reference changes, and hidden tests | `check` |
| `evals/bench/bench.mjs` | Verbs `check`, `plan`, `run`, `score`, and `report` | `check` only |
| `evals/bench/run.mjs` | Deterministic regression eval for the scorer, the statistic, the verdict rule, and the audit | Yes |
| `evals/BENCH_TABLE.md` | Accepted snapshot summaries and verdicts | No |

The plan binds HEAD, the matrix digest, the target tree digest, the seed digest, the plugin tree digest per skill, the lead model id, the host version, and the canary digest. `run` refuses a plan whose bound inputs drifted, the same way `judgment-evals.mjs check-plan` does. `run` spawns `claude` as a child process, so the harness keeps zero third-party imports. On Windows, `run` resolves the `claude` shim with the `where.exe` fallback that `scripts/preflight.mjs` already uses.

`run.mjs` covers the parts that need no model: the scorer on synthetic findings, the bootstrap on fixed inputs, keyed F0.5 with no hits, each verdict branch, each void trigger in the audit, and a plugin-copy path in a tool input that must not void. Each part has a mutant that must fail it. GitHub Actions runs `check` and `run.mjs`. Model-in-the-loop snapshots stay operator-run and never gate a merge.

## Models

Each snapshot pins one lead model id for both arms. The first snapshot uses `claude-opus-5-5`, the operator's session lead. Inside the skill arm, the plugin's agents keep their own frontmatter tiers, because those tiers are part of the skill. The report records every model id seen in the transcripts.

The weak-arm re-measure on `claude-haiku-5-5` is out of scope here. It reruns the existing floor protocol on the toy fixtures with `judgment-evals.mjs plan --mode floor`, which is cheap and needs no new harness.

## Pilot and pre-registration

A pilot runs one rep per arm per task before the first snapshot, and its data never enters a verdict. The pilot settles five probes:

- **P-1**: hooks, agents, and MCP servers from a `--plugin-dir` plugin load under `--bare`.
- **P-2**: `total_cost_usd` includes subagent spend.
- **P-3**: no task is saturated in the control arm. If one is, change the seed count or class mix for that task.
- **P-4**: the snapshot cost estimate, which sets the spend the operator approves.
- **P-5**: the void rate, with the audit tuned only for false triggers on benign paths.

After the pilot, the seeds, the task statements, the per-unit cap, and this document's metrics and verdict rule freeze. The snapshot report opens with the filled pre-registration block from [evals/README.md](../../evals/README.md): hypothesis, matched arms, n and stopping rule, metric and minimum delta, and instrument check.

## Build plan

The build follows design approval. Each step is one bounded unit:

1. Pick the target by the appendix procedure. Vendor its source with its license and provenance note, write its pristine `node:test` characterization suite, and confirm `check-no-deps.mjs` and the lint gate pass.
2. Write `bench.mjs check` and `run.mjs`, then wire both into `.github/workflows/validate.yml` and list the eval in `evals/README.md`. Oracle tests live in `targets/<name>/ANSWER_KEY.oracles/`. The `AGENTS.md` glob `evals/*/ANSWER_KEY.*` is one directory deep and does not match this path. The enforcement is in `bench.mjs`: it drops every path segment that starts with `ANSWER_KEY.` from the tree digest and every copy, and the step 4 sandbox copy and audit reuse that rule. Until step 4, `run.mjs` covers `check` only, and the regenerated answer key is checked at plan time.
3. Author the seeds, the oracle tests, the deep-review change commits, and the ship specifications, with `check` green.
4. Write `bench.mjs plan`, `run`, `score`, and `report`.
5. Run the pilot, record P-1 to P-5, and freeze the pre-registration.
6. Run the first snapshot and write `evals/BENCH_TABLE.md` with per-skill verdicts.

Step 3 is the largest unit and splits by skill. Steps 5 and 6 spend model budget and need the operator's approval of the P-4 estimate.

## Authority the build needs

The build needs three grants that this design does not assume:

- **Vendoring third-party code** into `evals/bench/targets/` under its own license. Granted on 2026-10-14 for build step 1.
- **API-key billing** for the pilot and the snapshot. Bare mode reads credentials only from `ANTHROPIC_API_KEY` or an `apiKeyHelper`, never from OAuth.
- **Snapshot spend**, approved against the P-4 estimate.

## Validity threats

The known threats and their handling are:

- **Memorization**: the model may know the upstream target. Both arms share the exposure, and seeds are new edits. A less-known target reduces it.
- **Two targets, one language**: results generalize to JavaScript libraries of this size only. A target in another language is the first follow-up.
- **Seed realism**: authored seeds can be easier or harder than native bugs. The class mix follows the calibration bug classes, and unkeyed adjudication watches native finds.
- **Cap hits**: a skill arm that hits the dollar cap scores lower. The report counts cap hits per arm.
- **Host drift**: a host or model change is a snapshot boundary, the same rule as the floor table.
- **Answer-key leakage**: covered by the sandbox location, the transcript audit, and the canary. A leak that the audit cannot see, such as model memory of this design, is out of reach.
- **Power**: at n=4 per arm, a small true effect can land INCONCLUSIVE. The rule says so instead of forcing a verdict.

## `claude plugin eval` stays a cross-check

`claude plugin eval` is not part of this benchmark and never enters CI. Its with and without ablation runs the same comparison as the skill and control arms, so it adds no new measure. Its LLM judges are advisory, and a model-in-the-loop result is never a merge gate. It may run locally to cross-check one bench result: when the two disagree on a skill, the bench verdict rule decides, and the disagreement is recorded in the run folder as a lead to investigate. Decided in [Anthropic plugin lessons 2026-10](Anthropic%20plugin%20lessons%202026-10.md) (P7).

## Appendix: target candidates

A first web shortlist on 2026-10-14 found no project that met every original rule. The rule that failed most often was a test suite runnable on Node with no devDependencies: the candidates that were checked used `ava`, `jest`, `tape`, `mocha`, `grunt`, or a generated parser. The rule now drops the upstream tests and the benchmark authors its own suite, so that cause no longer disqualifies a candidate.

The build-phase pick follows this selection procedure:

1. List candidates through repository search for plain JavaScript projects with zero runtime dependencies.
2. Fetch each candidate's recursive tree. Sum the JavaScript lines outside `test/`, `dist/`, and `docs/`, and keep candidates between 5,000 and 15,000 lines.
3. Scan the kept source for bare import specifiers, and reject any candidate that has one.
4. Prefer the least famous candidate that remains, and confirm its license.

The checked rejects were n2words (source too large, `ava` tests), pure-http (`jest`), hyntax (`babel` and `tape`), jsmart (`dist/` build, `grunt` and `karma`), and toml-node (generated parser). yadda (ISC, `node:test`) is probably under 5,000 lines, which is UNVERIFIED. Acorn is a lead from memory only: it has zero dependencies and is large enough, but it is famous, so the memorization threat is higher.

### Pick: hyparquet

The build-phase pick is hyparam/hyparquet at commit `2a4b96cc04ca0ac268596302667d39e2d505b560`, vendored on 2026-10-14 at `evals/bench/targets/hyparquet/`. Its `PROVENANCE.md` lists the files taken and every local change. The facts behind the pick:

- **License**: MIT, vendored unchanged.
- **Dependencies**: zero runtime dependencies. The source is plain ESM with no build step. The only bare specifier was the builtin `'fs'` in `src/node.js`. It became `'node:fs'`, which resolves to the same builtin, so the gate passes. No third-party import exists.
- **Size**: 5,508 physical lines in `src/*.js`, which passes step 2 as written. Of these, 1,346 are comment lines and 399 are blank, so the code-only count is about 3,760. The target is therefore at the low edge of the size rule. A reader who counts code lines only must read the size claim as below 5,000.
- **Fame**: it is newer and less known than xmldom, the fallback. xmldom was not downloaded, because the physical count did not fall under 5,000.
- **Data**: 8 upstream test files. Two other files need ZSTD or GZIP decoders, which the core lacks, so they were dropped.
- **Characterization suite**: `test/characterization.test.js` passes 8 of 8 on the pristine tree. A one-byte mutation in the snappy decoder, made on a scratch copy, failed 3 of 8. The suite covers full-file decode paths only, so step 3 seeds go in paths it does not reach, such as row ranges, column selection, filters, and query planning.

### Second target: tau-prolog

Pilot-2 and pilot-3 showed that the bare model clears mid-size seeds on hyparquet, which sits at the low edge of the size rule. The second target is tau-prolog/tau-prolog at commit `5bd606a255910d8e34ff1d721e80969af294b64c`, vendored on 2026-10-14 at `evals/bench/targets/tau-prolog/`. Its `PROVENANCE.md` lists the files taken and every local change. The run folder holds the shortlist with the measured line counts of the rejected candidates.

- **License**: BSD-3-Clause, vendored unchanged.
- **Dependencies**: the CLI `taupl.js` needs `readline-sync`, so it is left out. A lazy `require('readline-sync')` in `modules/core.js` became a `node:fs` line read from standard input. The bare builtins became `node:` specifiers. `modules/dom.js` throws when required under Node, so it is left out.
- **Size**: 12,060 physical lines in the 10 vendored `modules/*.js` files, 9,101 of them in `core.js`.
- **Fame**: about 650 stars. It is less known than matter-js, the other candidate above 10,000 lines.
- **Characterization suite**: `test/characterization.test.js` runs 25 queries over one consulted program (lists, arithmetic, findall and bagof, atom builtins, format) and compares every formatted answer with values recorded from the pristine source. Seeds go in paths it does not reach.

The tau-prolog tasks add to the hyparquet tasks, so each skill declares twice as many tasks.
