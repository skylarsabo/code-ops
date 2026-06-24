# trap-garden eval

A precision-under-temptation fixture: 5 subtle real bugs alongside 6 decoys engineered to bait a reviewer (md5 cache key, a "ReDoS-looking" but bounded regex, the `== null` idiom, an intentional inclusive loop, a `void` fire-and-forget, `parseInt` with a radix). See `ANSWER_KEY.md`.

## Run it
1. Point a finding skill (`/rigor:bug-hunt`, `/rigor:quality-scan`, `/code-ops-suite:codebase-audit`) at `evals/trap-garden/repo` and save findings as a `*_REGISTER.md` or a JSON array of `{ "file": "...", "line": N }`.
2. Score it: `node evals/score.mjs evals/trap-garden/ANSWER_KEY.json <findings.md|findings.json>`.
3. Baseline + reps as usual.

## Notes
- `node evals/score.mjs evals/trap-garden/ANSWER_KEY.json --check` verifies the key still matches the fixture; wired into `validate.yml` as a fixture-drift guard.
- A strong model handles these at toy scale (the decoys carry intent the model reasons about), so the fixture is a **regression guard** more than a skill-vs-baseline discriminator.
