# scale-prolog eval

Measures bug-finding **recall** and **false-positive rate** of a finding skill on a real-scale target: a Prolog interpreter of about 12,100 source lines with 38 planted defects and 15 decoys. One file, `modules/core.js`, holds about 9,100 lines and 26 of the seeds. The fixture is harder than `evals/scale-parquet/`: it is twice the size, and it holds twice the defects. See `ANSWER_KEY.md` for what is planted.

## Run it
1. **With the skill**: point `/rigor:bug-hunt` at `evals/scale-prolog/repo` and save its output as a `FINDINGS_REGISTER.md` or a JSON array of `{ "file": "...", "line": N }`.
2. **Score it** (deterministic):
   ```
   node evals/score.mjs evals/scale-prolog/ANSWER_KEY.json <findings.md|findings.json>
   ```
3. **Baseline and reps**: repeat with a plain model and no skill, and run 3 or more reps of each, as for `evals/bug-garden/`.

## Refutation task
The refutation task measures whether a reviewer can tell a real defect from a plausible false claim.
- `REFUTATION_CLAIMS.md` is the worker-facing input. It holds 30 claims, each on one seed site in `repo/`, and some are wrong.
- The worker gets only `REFUTATION_CLAIMS.md` and a staged copy of `repo/`. Everything else in `evals/scale-prolog/` stays out of its context, including `run.mjs` and this README.
- `ANSWER_KEY.refutation.json` gives the verdict and the seed for each claim. Keep it, `ANSWER_KEY.json`, and `ANSWER_KEY.md` out of the worker's context.
- The worker returns one line per claim in the form `- C-NN · REAL|NOT-A-DEFECT · <reason>`.
- Score the output with `node evals/scale-prolog/score-refutation.mjs <candidate.md>`. Add `--json` for one JSON object. The scorer prints the correct count of 30, the split between real and false claims, and the wrong ids. A claim with no verdict or two different verdicts counts as wrong.
- `run.mjs` checks the claim set against its key and the seed sites, and checks the scorer on fixed candidates.
- `REFUTATION_CLAIMS_HARD.md` is a second, harder set of 20 claims, ids `H-NN`, in the same line form. Each claim needs code far from the cited line, such as a check in a caller, a fixed flag, or a helper in another function, and its sites are not bound to the seeds.
- `ANSWER_KEY.refutation-hard.json` gives the verdict for each hard claim and a probe that fixes it by execution. `run-probes.mjs` runs every probe against `repo/`, and `run.mjs` fails when an observed outcome differs from the `expect` value.
- The `expect` values reveal the outcomes, so keep the hard key and `run-probes.mjs` out of the worker's context. Score a hard candidate with `node evals/scale-prolog/score-refutation.mjs <candidate.md> --key evals/scale-prolog/ANSWER_KEY.refutation-hard.json`.

## Results: medium against high effort (2026-11-12)

Pre-registered, five reps per cell, a strong-tier model reading a staged copy of `repo/` with no execution.

| Task | Medium | High | Difference | High cost |
|---|---|---|---|---|
| Review, defects found of 38 | 29.4 | 28.4 | -1.0 (p 0.9167) | 9.9% tokens, 39.4% wall time |
| Refutation, correct verdicts of 30 | 28.8 | 29.0 | 0.2 (p 0.5) | 21.4% tokens, 122.4% wall time |

- Review has headroom at medium (77 percent recall) and shows no gain from high effort.
- Refutation is at ceiling at medium, so it cannot show a gain. Only claim C-23 needs code far from the cited line; medium got it wrong in 5 of 5 reps and high in 3 of 5.
- Four defects were missed by all ten review reps: `ca-answer-limit-rejects`, `ca-permutation-partial`, `ca-json-prolog-pairs`, `ca-getenv-value-type`.
- A second run used the hard claim set (20 claims, each false claim prevented by code 167 to 6,676 lines from the cited line). Medium scored 20.0 of 20 and high 19.8, at ceiling again. Distance from the cited line does not make a claim hard when a search for the helper settles it.
- Limits: five reps per cell, static reading only, whole-repository review, and review reps stop near 300,000 tokens with a partial read of the 9,101-line `core.js`.

## Notes
- `repo/`, `ANSWER_KEY.json`, and `ANSWER_KEY.md` are derived. Do not hand-edit them: change the bench target or its seeds, then run `node evals/scale-prolog/build.mjs`. Run `node evals/scale-prolog/build.mjs --check` to compare the tracked bytes with the derivation.
- The seeds are the union of the bench bug-hunt and codebase-audit seed files for the target. The two files were written apart, so some seeds edit the same site, sit closer than the bench minimum gap, or break the oracle of another seed. `build.mjs` drops 19 seeds and records the reason for each in `DROPPED`.
- The unseeded source is `evals/bench/targets/tau-prolog`. Keep it, `build.mjs`, and the answer key out of the skill's context, because a diff against the source reveals every seed.
- Run the skill on a copy of `repo/` outside this repository. `node scripts/judgment-evals.mjs stage` makes that copy for a planned run. A worker that runs inside the repository can search its way to the unseeded source.
- The pass bar is recall 50% with no decoy flagged, set in `ANSWER_KEY.json`. It matches `evals/scale-parquet/`. Compare arms on the raw counts, not the verdict.
- The CI gate is `node evals/scale-prolog/run.mjs`: the build check, the key anchors, and the hidden oracles on the tracked tree.
