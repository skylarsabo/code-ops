# Model-floor calibration table

Raw results of the pre-registered model-floor calibration (`.github/workflows/evals-floor.yml`),
per the measurement protocol in [`README.md`](README.md). Each row aggregates 3 reps of one
{fixture × model tier × arm} cell; per-rep raw output lives in the linked run's logs.

## Pre-registration (declared before the baseline run)

1. **Hypothesis** — the weak-model hardening batches (mechanical gates + point-of-use rule
   inlining) raise the weak-model floor: fewer inflation-by-construction CONFIRMED tiers and
   no recall/precision regression, at unchanged strong-model quality.
2. **Arms, matched** — {strong, weak} model × {with-skill, no-skill control}; same prompt
   shape, same fixtures, same rep count per cell; the only cross-snapshot variable is the
   repo's skill/CONVENTIONS text.
3. **n per arm + stopping rule** — 3 reps per cell, 84 cells per snapshot, fixed in advance;
   one baseline snapshot, one post-hardening snapshot.
4. **Metric + minimum practically-significant delta** — primary: total CONFIRMED tiers
   emitted by read-only runs (inflation by construction; target: weak-with-skill → 0 on all
   fixtures). Secondary: mean recall / decoys-flagged (must not regress by more than 0.3
   findings per cell). Deltas below those bounds are directional, not definitive.
5. **Instrument check** — recall is saturated on most fixtures even for the weak tier
   (known toy-fixture ceiling; they serve as regression guards). The DISCRIMINATING axis at
   the floor is tier honesty, which is not saturated: see the baseline spread below.

## Baseline — pre-hardening skill text

Run: `28813316068` (dispatched on main at the pre-gate snapshot, models pinned:
strong `claude-opus-4-8`, weak `claude-haiku-4-5-20251001`).

| Fixture | Model tier | Arm | Reps | Mean recall | Mean decoys flagged | CONFIRMED emitted (read-only run ⇒ inflation) |
| --- | --- | --- | --- | --- | --- | --- |
| bug-garden | strong | control | 3 | 4.0/4 | 0.0/3 | 0 |
| bug-garden | strong | skill | 3 | 4.0/4 | 0.0/3 | 0 |
| bug-garden | weak | control | 3 | 4.0/4 | 0.0/3 | 7 |
| bug-garden | weak | skill | 3 | 4.0/4 | 0.0/3 | 4 |
| calibration-traps | strong | control | 3 | 4.0/4 | 0.0/4 | 0 |
| calibration-traps | strong | skill | 3 | 4.0/4 | 0.0/4 | 0 |
| calibration-traps | weak | control | 3 | 4.0/4 | 0.0/4 | 12 |
| calibration-traps | weak | skill | 3 | 4.0/4 | 0.0/4 | 0 |
| drifted-docs | strong | control | 3 | 3.0/3 | 0.0/2 | 0 |
| drifted-docs | strong | skill | 3 | 3.0/3 | 0.0/2 | 0 |
| drifted-docs | weak | control | 3 | 2.3/3 | 0.0/2 | 11 |
| drifted-docs | weak | skill | 3 | 3.0/3 | 0.3/2 | 6 |
| hasty-code | strong | control | 3 | 2.7/3 | 0.3/2 | 0 |
| hasty-code | strong | skill | 3 | 3.0/3 | 0.0/2 | 0 |
| hasty-code | weak | control | 3 | 2.0/3 | 0.3/2 | 6 |
| hasty-code | weak | skill | 3 | 3.0/3 | 0.3/2 | 9 |
| leak-lab | strong | control | 3 | 3.0/3 | 0.0/3 | 0 |
| leak-lab | strong | skill | 3 | 3.0/3 | 0.0/3 | 0 |
| leak-lab | weak | control | 3 | 3.0/3 | 0.3/3 | 6 |
| leak-lab | weak | skill | 3 | 3.0/3 | 0.0/3 | 8 |
| trap-garden | strong | control | 3 | 5.0/5 | 0.0/6 | 0 |
| trap-garden | strong | skill | 3 | 5.0/5 | 0.0/6 | 0 |
| trap-garden | weak | control | 3 | 5.0/5 | 0.0/6 | 10 |
| trap-garden | weak | skill | 3 | 5.0/5 | 0.0/6 | 0 |
| xfn-traps | strong | control | 3 | 3.3/4 | 0.0/4 | 0 |
| xfn-traps | strong | skill | 3 | 3.3/4 | 0.0/4 | 0 |
| xfn-traps | weak | control | 3 | 4.0/4 | 0.0/4 | 10 |
| xfn-traps | weak | skill | 3 | 3.7/4 | 0.0/4 | 0 |

**Baseline reading.** (1) The strong tier emitted **zero** inflated CONFIRMED across all 42
cells; the weak tier emitted **62 in control** and **27 with skills** — tier inflation is a
weak-model phenomenon, exactly as the hardening audit predicted. (2) The split inside the
weak-with-skill arm is the load-bearing observation: the fixtures whose skill inlines tier
discipline (`bug-hunt`: calibration-traps 0, trap-garden 0, xfn-traps 0) suppressed inflation
almost completely, while fixtures whose skills carry the rules only by CONVENTIONS pointer
(`doc-alignment` 6, `normalize` 9, the privacy audits 8) did not — direct evidence for
point-of-use inlining. (3) Recall is at or near ceiling everywhere (toy-fixture saturation);
small deltas are directional only. (4) `hasty-code` weak-skill recall (3.0 vs control 2.0)
and `drifted-docs` (3.0 vs 2.3) show the skills lift weak-model recall where any headroom
exists.

**Validity threats.** Toy-fixture saturation caps the recall axis; n=3 makes sub-unanimous
deltas directional; the control prompt names the fixture directory, which may leak topic
hints; tier emission depends on the prompt requesting honest tiers in both arms (it does).

## Post-hardening — to be appended

Dispatch `evals-floor.yml` on main after the hardening batches merge; append the same table
shape and compare against the pre-registered deltas above.
