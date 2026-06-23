# drifted-docs eval

Measures doc-reconciliation **recall** and **false-positive rate** of `code-ops-suite:doc-alignment` against a fixture whose `repo/README.md` has drifted from `repo/src/server.js` — plus decoys (doc statements that look like drift but are accurate or intentionally aspirational). See `ANSWER_KEY.md` for what's planted.

## Run it
1. **With the skill** — point `/code-ops-suite:doc-alignment` at `evals/drifted-docs/repo` and capture its drift findings:
   - Save its output as a `DRIFT_REPORT.md` (or any Markdown with `file:line` refs) or a JSON array of `{ "file": "...", "line": N }`.
2. **Score it** (deterministic):
   ```
   node evals/score.mjs evals/drifted-docs/ANSWER_KEY.json <findings.md|findings.json>
   ```
3. **Baseline** — repeat with a plain model and *no* skill; the skill has to beat the control.
4. **Reps & variance** — run 3+ times each; record the spread.

## Notes
- Findings are scored at the **doc** location (the README line carrying the false claim).
- `node evals/score.mjs evals/drifted-docs/ANSWER_KEY.json --check` verifies the key still matches the fixture (run after editing `repo/`).
- This is **not** a CI gate (it needs a model run); the scheduled job in `.github/workflows/evals.yml` runs it.
