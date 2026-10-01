# distill-program eval

Measures program-mode `code-ops-suite:distill` against a fixture whose `repo/programs/ledger-demo/PROGRAM.md` has drifted from the program ledger grammar: too many open items, an item with no `Blocks:`, a closed item still listed open, decisions without a DEC id or a disposition, and a superseded decision restated in full. It also plants decoys, which are well-formed lines the skill must leave alone. See `ANSWER_KEY.md` for what is planted.

## Run it
1. **With the skill**: point `/code-ops-suite:distill` at `evals/distill-program/repo/programs/ledger-demo` in assess mode and capture its ledger findings as Markdown with `file:line` refs, or as a JSON array of `{ "file": "...", "line": N }`.
2. **Score it** (deterministic):
   ```
   node evals/score.mjs evals/distill-program/ANSWER_KEY.json <findings.md|findings.json>
   ```
3. **Baseline**: repeat with a plain model and no skill. The skill has to beat the control.

## Notes
- Findings are scored at the ledger line that carries the defect. The key uses a line tolerance of 0.
- `node evals/score.mjs evals/distill-program/ANSWER_KEY.json --check` verifies the key still matches the fixture. Run it after editing `repo/`.
- This is not a CI gate for the skill. CI runs only the fixture-drift check.
