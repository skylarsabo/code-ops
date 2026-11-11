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
- Run the skill on a copy of `repo/` outside this repository. `node scripts/judgment-evals.mjs stage` makes that copy for a planned run. A worker that runs inside the repository can search its way to the unseeded source.
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

## Matched arm: Sonnet 5.5 against Opus 5.5 (2026-11-10)

Pre-registered before the first run. Five fresh read-only control reps per model, same prompt and outside copy as the pilot, only the model varied. Opus shows a gain when the mean difference is at least 2.0 defects and a one-sided exact permutation test gives p at most 0.05.

| Model | Defects found of 18 | Mean | Decoys flagged | Unkeyed flags | Mean tokens | Mean wall time |
|-------|---------------------|------|----------------|---------------|-------------|----------------|
| Sonnet 5.5 | 12, 13, 12, 12, 12 | 12.2 | 0 in 5 reps | 1, 1, 1, 0, 1 | 146,303 | 207 s |
| Opus 5.5 | 15, 16, 14, 15, 15 | 15.0 | 0 in 5 reps | 0, 2, 1, 0, 1 | 148,917 | 475 s |

- Result: Opus shows a quality gain. The mean difference is 2.8 defects, and 1 of 252 splits is as extreme (p = 0.004). Every Opus rep is above every Sonnet rep.
- Sonnet missed `bh-scan-column-await` in all five reps and `bh-split-stream-layout` in four. Opus found the first in all five and the second in four.
- Both models used about the same tokens. Opus took about 2.3 times the wall time.
- Pooled with the three pilot reps per model, the means are 12.0 and 15.1 of 18. The pooled figure is descriptive only.
- Limits: one fixture, a control prompt with no skill, a read-only hunt. The arm does not measure implementation work or tier inflation.

## Fan-out against tier (2026-11-11)

Computed from the ten matched-arm registers, with no new run. The rule was written before the union counts were computed, but after the per-rep counts were known, so the result is descriptive. A union of k registers finds a defect when any of the k found it.

| Registers in the union | Sonnet 5.5 mean (range) | Opus 5.5 mean (range) | Tokens |
|------------------------|-------------------------|-----------------------|--------|
| 1 | 12.2 (12 to 13) | 15.0 (14 to 16) | about 147,000 |
| 2 | 13.8 (13 to 15) | 16.0 (15 to 17) | about 295,000 |
| 3 | 14.5 (14 to 15) | 16.5 (15 to 17) | about 442,000 |
| 5 | 15.0 | 17.0 | about 738,000 |

- Two Sonnet registers do not match one Opus register: 13.8 against a bar of 14.0. Three match it at about three times the tokens. No Sonnet union beats one Opus register.
- The Sonnet misses are correlated. All five reps missed the same three defects, so more reps cannot find them.
- A union also sums the false reports of its registers.

## Skill arm: `rigor:bug-hunt` against the control prompt (2026-11-11)

Pre-registered before the first run. Five fresh read-only reps per model. The prompt is the control prompt plus one paragraph that tells the worker to read and apply copies of the skill and the rigor conventions. The control is the matched arm above. The skill shows a gain when the mean difference is at least 2.0 defects and a one-sided exact permutation test gives p at most 0.05.

| Model | Control mean | Skill, defects found of 18 | Skill mean | Difference | p | Mean tokens | Mean wall time |
|-------|--------------|----------------------------|------------|------------|---|-------------|----------------|
| Sonnet 5.5 | 12.2 | 15, 14, 13, 13, 14 | 13.8 | +1.6 | 0.012 | 163,915 (+12%) | 300 s |
| Opus 5.5 | 15.0 | 15, 15, 15, 14, 15 | 14.8 | -0.2 | 0.86 | 170,240 (+14%) | 622 s |

- Result: the rule is not met for either model. The Sonnet gain of 1.6 is below the registered minimum of 2.0. Opus shows no gain and pays 14 percent more tokens.
- Sonnet with the skill stays 1.2 defects below Opus on the control prompt.
- With the skill, no Sonnet rep missed four defects that control reps missed 1 to 3 times each. The four hardest defects did not move for either model.
- No rep flagged a decoy.
- Scoring: a skill register quotes other `file:line` references inside its sentences, and `evals/score.mjs` counts each as a flag. Both arms were rescored on the leading citation of each finding only. No defect count changed; the skill-arm unkeyed counts fell from 3 to 11 per rep to 0 to 2.
- Limits: the control reps ran one day earlier. The worker cannot execute, so the skill's proof step did not run. One fixture.

## Trimmed skill arm (2026-11-11)

Pre-registered before the first run. Five fresh read-only reps per model. The worker reads one file: `SKILL.md` verbatim plus five convention sections verbatim (evidence tiers, disconfirmation pass, evidence standard, root cause, quality lenses). That file is 10,927 bytes against 39,334 for the full skill and conventions. The trim keeps the gain when the Sonnet mean is at least 12.8 and shows no loss when the Opus mean is at least 14.0.

| Model | Control mean | Full skill mean | Trimmed, defects found of 18 | Trimmed mean | Mean tokens: control, full, trimmed |
|-------|--------------|-----------------|------------------------------|--------------|-------------------------------------|
| Sonnet 5.5 | 12.2 | 13.8 | 13, 13, 13, 14, 14 | 13.4 | 146,303; 163,915; 161,344 |
| Opus 5.5 | 15.0 | 14.8 | 15, 15, 15, 15, 14 | 14.8 | 148,917; 170,240; 161,918 |

- Result: both bars are met. The trim keeps the Sonnet gain and leaves Opus unchanged.
- Cutting 72 percent of the document bytes saved 1.6 percent of tokens on Sonnet and 4.9 percent on Opus. The trimmed arm still costs 9 to 10 percent more than control.
- The document size is not the cost. A rep spends about 150,000 tokens reading the library across about 32 tool calls. A token cut has to come from fewer or smaller turns.
- No rep flagged a decoy.
- Limits: a margin of 1.0 defect at five reps is a descriptive check, not proof of equivalence. The worker cannot execute. One fixture.

## Read-discipline arm (2026-11-11)

Pre-registered before the first run. Five fresh read-only reps per model. The prompt is the control prompt plus one paragraph: list the directory once, read each file at most once and whole, send up to ten reads in one message, and run no search. The discipline shows no loss when the mean is within 1.0 of the control mean, and a loss when it is at least 2.0 lower at p at most 0.05.

| Model | Control, defects found of 18 | Control mean | Discipline, defects found of 18 | Discipline mean | Mean tokens: control, discipline | Mean tool calls: control, discipline | Mean wall time: control, discipline |
|-------|------------------------------|--------------|---------------------------------|-----------------|----------------------------------|--------------------------------------|-------------------------------------|
| Sonnet 5.5 | 12, 13, 12, 12, 12 | 12.2 | 13, 14, 13, 12, 14 | 13.2 | 146,303; 157,366 | 30.0; 29.4 | 207 s; 244 s |
| Opus 5.5 | 15, 16, 14, 15, 15 | 15.0 | 13, 16, 15, 13, 15 | 14.4 | 148,917; 152,452 | 31.0; 29.8 | 475 s; 373 s |

- Result: no loss for either model, and no saving. Tokens rose 7.6 percent on Sonnet and 2.4 percent on Opus.
- The control already reads the library once. The fixture has 29 files and the control reps made 30 to 32 tool calls, so the discipline had at most two calls to remove.
- This corrects the reading in the trimmed skill section: the cost is not repeated reading. It is one whole read of the library, about 150,000 tokens. A token cut on this task has to come from reading fewer files.
- Sonnet rose 1.0 defect (p 0.063) and Opus fell 0.6 (p 0.28). Neither difference meets a registered rule. Opus wall time fell 21 percent.
- No rep flagged a decoy.
- Limits: the token figure is the subagent total the host reports. A margin of 1.0 defect at five reps is a descriptive check. The control reps ran one day earlier. One fixture.

## Scoped hunt arm (2026-11-11)

Pre-registered before the first run. The 28 files of `src/` in name order are cut into three contiguous slices of near-equal bytes (`assemble.js` to `filter.js`, `geoparquet.js` to `rowgroup.js`, `scan.js` to `xxhash.js`). One read-only worker hunts each slice and reads no other file. A rep is the union of three registers, five reps per model. Quality shows no loss when the mean is within 1.0 of the control mean. Cost shows a saving when the summed tokens of the three workers are at most 90 percent of the control mean.

| Model | Control mean | Scoped, defects found of 18 | Scoped mean | Mean tokens: control, scoped (sum of three) | Mean wall time: control, scoped (longest worker) |
|-------|--------------|-----------------------------|-------------|---------------------------------------------|--------------------------------------------------|
| Sonnet 5.5 | 12.2 | 13, 10, 13, 14, 11 | 12.2 | 146,303; 198,186 | 207 s; 121 s |
| Opus 5.5 | 15.0 | 13, 15, 15, 15, 15 | 14.6 | 148,917; 189,897 | 475 s; 220 s |

- Result: no loss for either model, and the saving rule is not met. Summed tokens rose 35.5 percent on Sonnet and 27.5 percent on Opus.
- Each worker pays a fixed startup cost. A worker used about 60,000 to 70,000 tokens for a third of the source, so each extra worker adds about 20,000 to 26,000 tokens. Splitting a hunt that fits in one context costs tokens.
- Scoping buys wall time: 42 percent less on Sonnet and 54 percent less on Opus.
- Precision fell. Three of ten reps flagged a decoy, against none in control, and unkeyed flags rose to 3 to 5 per rep.
- No scoped rep on either model found `bh-scan-column-await`, which every Opus control rep found. The defect needs a callee in another slice. Four of five Opus reps found `bh-page-range-touch`, which no Opus control rep found.
- Limits: one slicing rule, and a worker could not read outside its slice. The token figure is the subagent total the host reports. A margin of 1.0 defect at five reps is a descriptive check. One fixture, about 210,000 source bytes.

## Opus effort ladder (2026-11-11)

Pre-registered before the first run. Five fresh read-only reps of Opus 5.5 at low effort and five at high effort, on the control prompt. The control reps ran at medium effort. Low holds when its mean is at least 14.0 and shows a loss when it is at least 2.0 below control at p at most 0.05. High shows a gain when its mean is at least 16.0 at p at most 0.05.

| Effort | Defects found of 18 | Mean | Mean tokens | Mean tool calls | Mean wall time |
|--------|---------------------|------|-------------|-----------------|----------------|
| Low | 13, 12, 13, 14, 13 | 13.0 | 129,841 | 29.2 | 174 s |
| Medium (control) | 15, 16, 14, 15, 15 | 15.0 | 148,917 | 31.0 | 475 s |
| High | 16, 15, 16, 16, 14 | 15.4 | 160,008 | 32.2 | 667 s |

- Result: low effort shows a loss, 2.0 defects below medium (p 0.008), for 12.8 percent fewer tokens. High effort shows no gain: 0.4 defects above medium (p 0.34) for 7.4 percent more tokens and 40 percent more wall time.
- Medium is the rung to keep for this task. Effort changes the token total little, because most tokens are the read of the library. It changes wall time a lot.
- Low effort missed four defects in all five reps. Two of them, `bh-strict-default` and `bh-column-start-zero`, are found at medium in most reps.
- No rep at any effort flagged a decoy, and no rep at any effort found `bh-bloom-truncated-silent` or `bh-page-range-touch`.
- Opus at low effort found 13.0 against 12.2 for Sonnet 5.5 at medium, with fewer tokens and less wall time. That comparison was not registered and does not weigh price per token.
- Limits: the token figure is the subagent total the host reports, and whether it counts thinking tokens in full is not verified. Five reps per rung. The control reps ran one day earlier. One fixture.
