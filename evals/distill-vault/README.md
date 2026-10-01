# distill-vault eval

Measures vault mode of `code-ops-suite:distill` (phases 1 to 8 and the maintain pass) in two ways.

1. **Deterministic gate.** `node evals/distill-vault/run.mjs` copies `repo/` to a temp folder and drives the `state` verbs of `scripts/distill-check.mjs` through a full run. It pins out-of-order refusal, the no-loss refusal at the end of the relocate phase, the sample and full-review rule, the same-worker rule, the findability count, the phase 8 baseline and its refusals, the inventory copies the baseline cites in the hub, the gate with the run folder absent, and the maintain pass budget stop. Mutant copies of the script each break one rule, and the case that pins the rule must fail on its mutant.
2. **Model run.** Point the skill at `evals/distill-vault/repo/vault` in assess mode. Capture its findings as Markdown with `file:line` refs, or as a JSON array of `{ "file": "...", "line": N }`, and score them:
   ```
   node evals/score.mjs evals/distill-vault/ANSWER_KEY.json <findings.md|findings.json>
   ```
   Compare against a plain model with no skill.

`repo/vault` is the hub and `repo/inventory/docs.json` is the phase 1 inventory of the legacy `repo/docs` tree. The key plants 7 defects and 6 decoys. It uses a line tolerance of 0. Keep `ANSWER_KEY.json` out of any context handed to the skill under eval.

`node evals/score.mjs evals/distill-vault/ANSWER_KEY.json --check` verifies the key against the fixture. Run it after editing `repo/`. Several `run.mjs` cases count notes and paths in the fixture, so a new file there changes them.
