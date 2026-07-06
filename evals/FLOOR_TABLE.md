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

## Post-hardening — after the three hardening batches

Run: `28815659268` (dispatched on main after the gate batch and the conventions
restructure/inlining merged; same models, same protocol).

| Fixture | Model tier | Arm | Reps | Mean recall | Mean decoys flagged | CONFIRMED emitted (read-only run ⇒ inflation) |
| --- | --- | --- | --- | --- | --- | --- |
| bug-garden | strong | control | 3 | 4.0/4 | 0.0/3 | 0 |
| bug-garden | strong | skill | 3 | 4.0/4 | 0.0/3 | 0 |
| bug-garden | weak | control | 3 | 4.0/4 | 0.0/3 | 10 |
| bug-garden | weak | skill | 3 | 3.7/4 | 0.0/3 | 0 |
| calibration-traps | strong | control | 3 | 4.0/4 | 0.0/4 | 0 |
| calibration-traps | strong | skill | 3 | 4.0/4 | 0.0/4 | 0 |
| calibration-traps | weak | control | 3 | 4.0/4 | 0.0/4 | 12 |
| calibration-traps | weak | skill | 3 | 4.0/4 | 0.0/4 | 0 |
| drifted-docs | strong | control | 3 | 3.0/3 | 0.0/2 | 0 |
| drifted-docs | strong | skill | 3 | 3.0/3 | 0.0/2 | 0 |
| drifted-docs | weak | control | 3 | 3.0/3 | 0.0/2 | 9 |
| drifted-docs | weak | skill | 3 | 3.0/3 | 0.0/2 | 4 |
| hasty-code | strong | control | 3 | 2.0/3 | 0.7/2 | 0 |
| hasty-code | strong | skill | 3 | 3.0/3 | 0.0/2 | 0 |
| hasty-code | weak | control | 3 | 2.3/3 | 0.0/2 | 6 |
| hasty-code | weak | skill | 3 | 3.0/3 | 0.0/2 | 8 |
| leak-lab | strong | control | 3 | 3.0/3 | 0.0/3 | 0 |
| leak-lab | strong | skill | 3 | 3.0/3 | 0.0/3 | 0 |
| leak-lab | weak | control | 3 | 2.7/3 | 0.3/3 | 7 |
| leak-lab | weak | skill | 3 | 3.0/3 | 0.0/3 | 9 |
| trap-garden | strong | control | 3 | 5.0/5 | 0.0/6 | 0 |
| trap-garden | strong | skill | 3 | 5.0/5 | 0.0/6 | 0 |
| trap-garden | weak | control | 3 | 5.0/5 | 0.0/6 | 10 |
| trap-garden | weak | skill | 3 | 5.0/5 | 0.0/6 | 5 |
| xfn-traps | strong | control | 3 | 3.3/4 | 0.0/4 | 0 |
| xfn-traps | strong | skill | 3 | 3.0/4 | 0.0/4 | 0 |
| xfn-traps | weak | control | 3 | 4.0/4 | 0.0/4 | 4 |
| xfn-traps | weak | skill | 3 | 3.3/4 | 0.0/4 | 0 |

## Verdict against the pre-registered deltas

**Primary metric (weak-with-skill inflation → 0 on all fixtures): NOT met.** Totals moved
62→58 (control) and 27→26 (with-skill) — flat within noise. Per fixture, with-skill:
bug-garden 4→0, calibration-traps 0→0, xfn-traps 0→0, drifted-docs 6→4, hasty-code 9→8,
leak-lab 8→9, trap-garden 0→5. **Secondary metric (recall/decoys regress ≤0.3/cell): met**
(all deltas within bounds or in the control arm; at n=3 these are directional).

**What the split actually shows.** The three consistently-zero fixtures all run `bug-hunt`,
whose tier rules are embedded IN the working phase ("prove it with a failing test/repro →
CONFIRMED; if you can't execute it, tier it PROBABLE … or SPECULATIVE" at the exact step
where findings are emitted). The batch's one-line "Tier honesty at point of use" additions
sit before Done-when — end-of-file position — and did not reliably suppress inflation
(drifted-docs 4, hasty-code 8, leak-lab 9 remain). trap-garden's 0→5 (its skill text is
bug-hunt, barely changed) bounds the run-to-run noise at roughly ±5 per cell-group.

**Measured lesson: placement beats presence.** A tier rule works at the step that emits the
finding, not as a trailing line. Next pre-registered iteration: move the tier-honesty line
of `doc-alignment`, `normalize`, and the three leak audits into their finding-emitting
phase step (mirroring bug-hunt's in-phase form), change nothing else, and re-run this
protocol. Per the measurement protocol, this table was not extended with additional reps
after seeing results, and the verdict stands against the deltas declared before the
baseline run.

## Iteration 2 — tier-honesty lines moved in-phase

Run: `28818263308` (main at the in-phase placement; matrix throttled to `max-parallel: 4`
after 84-job bursts rate-limited the credential exchange — two earlier attempts of this
run failed in bulk at the token exchange and were discarded whole, per protocol).

Weak-with-skill CONFIRMED inflation across the three snapshots (baseline → trailing-line →
in-phase): bug-garden 4→0→**0** · calibration-traps 0→0→**0** · xfn-traps 0→0→**0** ·
trap-garden 0→5→**0** · hasty-code 9→8→**3** · drifted-docs 6→4→**6** · leak-lab 8→9→**9**.
Totals: 27→26→**24** with-skill; 62→58→**58** control. Strong tier: still **zero** across
all 42 cells (126 read-only strong cells over three snapshots without one inflated tier).
Recall/decoys: within the pre-registered ±0.3 bound everywhere (leak-lab weak-skill 2.7
recall + 0.3 decoys is at the bound, directional only).

**Verdict: primary target (→0 everywhere) still not met; the split is now legible.**
In-phase placement re-zeroed trap-garden and cut `normalize` (hasty-code) to 3 — it works
where the phase emits findings itemized, one at a time, so the rule sits adjacent to each
emission. It did nothing measurable for `doc-alignment` (6) and the leak audits (9), whose
finding-emission is diffuse (drift lists, multi-surface sweeps) — and at the ±5 noise
bound those numbers are flat across all three snapshots. **Prose has hit its ceiling on
diffuse-emission skills.**

**Why this is acceptable, by design:** the residue is exactly what the mechanical layer
catches. A weak-model CONFIRMED with no resolvable proof does not survive consumption —
`revalidate-register.mjs --strict --profile <type>` rejects it ("attach a resolvable proof
or downgrade to PROBABLE") before `fix-verified`/`remediation`/`opsec-hardening` act on it,
and the read-only judgment evals flag it as inflation-by-construction. Prose reduces the
rate; the gate makes the survivors harmless. Further prose iterations against these three
fixtures are not planned — the layered defense is the design, not a workaround.
