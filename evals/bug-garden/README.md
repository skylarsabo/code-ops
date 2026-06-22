# bug-garden eval

Measures bug-finding **recall** and **false-positive rate** of a finding-skill against a fixture with planted bugs + decoys. See `ANSWER_KEY.md` for what's planted.

## Run it
1. **With the skill** — point a finding skill at the fixture repo and capture its findings:
   - `/rigor:bug-hunt` (or `/rigor:quality-scan`, or `/code-ops-suite:codebase-audit`) scoped to `evals/bug-garden/repo`.
   - Save its output as either a `FINDINGS_REGISTER.md` or a JSON array of `{ "file": "...", "line": N }`.
2. **Score it** (deterministic):
   ```
   node evals/score.mjs evals/bug-garden/ANSWER_KEY.json <findings.md|findings.json>
   ```
   Reports recall, decoys flagged (false positives), and unkeyed flags, with a PASS/FAIL verdict.
3. **Baseline** — repeat with a plain model and *no* skill, score the same way. The skill has to beat the no-skill control to justify its token cost.
4. **Reps & variance** — run 3+ times each (with-skill and baseline); record the spread. A skill whose recall/FP swings wildly across reps isn't reliable yet.

## Notes
- Matching is by basename + line within `lineTolerance` (default 3), so a finding a few lines off still counts.
- `node evals/score.mjs evals/bug-garden/ANSWER_KEY.json --check` verifies the key still matches the fixture (run after editing `repo/`).
- This is **not** a CI gate (it needs a model run). The automated gate is `evals/register-staleness/`.
