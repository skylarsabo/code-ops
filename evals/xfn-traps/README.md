# xfn-traps eval

A **cross-function precision** fixture: 4 real bugs + 4 decoys, arranged as 4 look-alike pairs. Each decoy is safe *only* because a guard lives in its **sole caller** (a caller-side clamp, an always-`'json'` caller, a null guard, a pct clamp); its paired bug looks locally identical but its caller lacks the guard. There is **no in-file `// DECOY` tell** — the disconfirming evidence is in another function, so clearing a decoy requires tracing to the caller.

This is the fixture that stresses **independent refutation** (`rigor:CONVENTIONS §I` / `code-ops-suite:CONVENTIONS §7`): the false-positive class where the guard the finder reasoned past sits cross-function. The saturated `trap-garden` / `calibration-traps` fixtures carry in-file by-design comments, so they cannot discriminate self-disconfirmation from independent refutation; this one can.

## Run it
1. Point a finding skill (`/rigor:bug-hunt`, `/rigor:quality-scan`, `/code-ops-suite:codebase-audit`) at `evals/xfn-traps/repo` and save findings as a `*_REGISTER.md` or a JSON array of `{ "file": "...", "line": N }`.
2. Score it: `node evals/score.mjs evals/xfn-traps/ANSWER_KEY.json <findings.md|findings.json>`.
3. Baseline + reps as usual (3+ each; record variance).

## Notes
- `node evals/score.mjs evals/xfn-traps/ANSWER_KEY.json --check` verifies the key still matches the fixture; wired into `validate.yml` as a fixture-drift guard (it globs every `ANSWER_KEY.json`).
- In the 2026-07-05 calibration that seeded this fixture, a strong **finder** already avoided all four decoys (it traced the callers itself), so the end-to-end false-positive rate was 0 without the extra stage. The independent-refutation panel's value showed when a finding *was* raised: it killed all four decoys (citing the cross-function guard) and spared all four real bugs, where single-shot self-review dropped one borderline real bug. Directional at this n; the value is as a regression guard and a seed for a realistic-scale eval.
