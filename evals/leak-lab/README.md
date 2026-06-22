# leak-lab eval

Measures anonymity-leak **recall** and **false-positive rate** of the privacy audits against a fixture with planted leaks + decoys. See `ANSWER_KEY.md`.

## Run it
1. Point a privacy audit at the fixture and capture findings (a `LEAK_REGISTER.md` or a JSON array of `{ "file": "...", "line": N }`):
   - `/privacy-opsec-suite:tor-egress-audit`, `:metadata-leak-audit`, `:anon-session-audit`, or `:full-sweep` scoped to `evals/leak-lab/repo`.
2. Score it:
   ```
   node evals/score.mjs evals/leak-lab/ANSWER_KEY.json <findings.md|findings.json>
   ```
3. Baseline (no skill) + 3+ reps with variance, same as `bug-garden`.

`node evals/score.mjs evals/leak-lab/ANSWER_KEY.json --check` verifies the key still matches the fixture. Not a CI gate (needs a model run).
