# scale-parquet eval

Measures bug-finding **recall** and **false-positive rate** of a finding skill on a real-scale target: a Parquet reader of about 6,100 source lines with 18 planted defects and 10 decoys. The toy fixtures saturate, so a tier, effort, or prompt change shows no difference there; this fixture leaves headroom. See `ANSWER_KEY.md` for what is planted.

## Run it
1. **With the skill**: point `/rigor:bug-hunt` at `evals/scale-parquet/repo` and save its output as a `FINDINGS_REGISTER.md` or a JSON array of `{ "file": "...", "line": N }`.
2. **Score it** (deterministic):
   ```
   node evals/score.mjs evals/scale-parquet/ANSWER_KEY.json <findings.md|findings.json>
   ```
3. **Baseline and reps**: repeat with a plain model and no skill, and run 3 or more reps of each, as for `evals/bug-garden/`.

## Notes
- `repo/`, `ANSWER_KEY.json`, and `ANSWER_KEY.md` are derived. Do not hand-edit them: change the bench target or its seeds, then run `node evals/scale-parquet/build.mjs`.
- The unseeded source is `evals/bench/targets/hyparquet`. Keep it, `build.mjs`, and the answer key out of the skill's context, because a diff against the source reveals every seed.
- Run the skill on a copy of `repo/` outside this repository. A worker that runs inside the repository can search its way to the unseeded source.
- The pass bar is recall 50% with no decoy flagged, set in `ANSWER_KEY.json`. The recall bar sits below the scorer default of 0.7 because a two-defect swing would flip a strong run across it. The bar was set after the first pilot rep. Compare arms on the raw counts, not the verdict.
- The CI gate is `node evals/scale-parquet/run.mjs`: the build check, the key anchors, and the hidden oracles on the tracked tree.

## Pilot (instrument check, 2026-11-10)

Three read-only control reps per tier on a copy outside the repository. Same prompt, no skill, medium effort. The pass rule was written before reps 2 and 3 ran: the fixture discriminates when the strong and light recall ranges do not overlap.

| Tier | Model | Defects found of 18 | Decoys flagged of 10 | Unkeyed flags | Mean tokens |
|------|-------|---------------------|----------------------|---------------|-------------|
| light | Haiku 5.5 | 11, 11, 9 | 1, 0, 0 | 6, 7, 8 | 213,820 |
| mid | Sonnet 5.5 | 14, 9, 12 | 0, 0, 0 | 1, 2, 1 | 145,958 |
| strong | Opus 5.5 | 15, 15, 16 | 0, 0, 0 | 1, 1, 1 | 150,719 |

- The strong range (15 to 16) sits above the light range (9 to 11), so the fixture separates those tiers on recall. The unkeyed-flag counts separate them too.
- No rep reached the ceiling. All nine missed `bh-bloom-truncated-silent` and `bh-page-range-touch`.
- The mid range (9 to 14) overlaps the light range and ends one defect below the strong range. Three reps do not separate mid from either neighbor.
- Decoys carry little signal here: one flag in nine reps.
- The unkeyed flag that every rep shares, `src/geoparquet.js:27`, is unseeded upstream code.
- Each finding is scored at one line. One mid rep returned the range `src/scan.js:265-272`, which holds a keyed defect at line 269; it is scored as a hit. Scored at line 265, that rep finds 11, and the mid range stays 9 to 14.
- The pilot prompt did not define the confidence tiers, so the pilot does not measure tier inflation.
- The first rep of each tier ran before the decoy bar moved from 1 to 0. The counts above do not depend on the bar.
