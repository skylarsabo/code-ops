# calibration-traps eval

Regression-guard fixture encoding the bug/decoy **classes** from the 2026-06-23 real-scale calibration. The 4 decoys are the false-positive classes the run produced (accepted-deferred trade-off, unreachable fallback, handled-by-the-sole-caller, status-neutral reordering); they exercise the disconfirmation rules (intent-annotation, locate-the-handler). The 4 bugs are real classes the run confirmed. See `ANSWER_KEY.md`.

## Run it
1. Point a finding skill (`/rigor:bug-hunt`, `/rigor:quality-scan`, `/code-ops-suite:codebase-audit`) at `evals/calibration-traps/repo` and save findings as a `*_REGISTER.md` or a JSON array of `{ "file": "...", "line": N }`.
2. Score it: `node evals/score.mjs evals/calibration-traps/ANSWER_KEY.json <findings.md|findings.json>`.
3. Baseline + reps as usual.

## Notes
- `node evals/score.mjs evals/calibration-traps/ANSWER_KEY.json --check` verifies the key still matches the fixture (run after editing `repo/`); this is wired into `validate.yml` as a deterministic fixture-drift guard.
- These classes saturate for a strong model at toy scale — their value is as **regression guards** and as seeds for a realistic-scale eval, not as a skill-vs-baseline discriminator. The real proof is a re-calibration at scale.
