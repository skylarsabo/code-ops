# hasty-code eval

Measures normalization **recall** and **false-positive rate** of `code-ops-suite:normalize` against a fixture with planted hasty-code (dead code, unreachable code, a generated-style comment) plus decoys (constructs that look hasty but are intentional). See `ANSWER_KEY.md` for what's planted.

## Run it
1. **With the skill** — point `/code-ops-suite:normalize` (or `/rigor:quality-scan`) at `evals/hasty-code/repo` and capture what it identifies for removal/cleanup:
   - Save its output as a Markdown report with `file:line` refs or a JSON array of `{ "file": "...", "line": N }`.
2. **Score it** (deterministic):
   ```
   node evals/score.mjs evals/hasty-code/ANSWER_KEY.json <findings.md|findings.json>
   ```
3. **Baseline** — repeat with a plain model and *no* skill; the skill has to beat the control.
4. **Reps & variance** — run 3+ times each; record the spread.

## Notes
- normalize is behavior-preserving: it should remove dead/unreachable code and generated tells, and leave intentional idioms alone.
- `node evals/score.mjs evals/hasty-code/ANSWER_KEY.json --check` verifies the key still matches the fixture (run after editing `repo/`).
- This is **not** a CI gate (it needs a model run); the scheduled job in `.github/workflows/evals.yml` runs it.
