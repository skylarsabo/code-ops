# route-judgment

The opt-in judgment-orchestration measure from `DESIGN_TIER_ROUTING.md`. It measures whether a lead routes each unit to the right rung and effort, and picks the premium rung when the work warrants it.

Hand the lead the three files under `repo/` and nothing else: `TASK.md`, `UNITS.md`, and `ROUTE_MENU.md`. Never hand it this directory, `ANSWER_KEY.json`, or `run.mjs`. The lead writes a register of `ROUTE_MENU.md:<line>` citations, one per unit.

```
node evals/score.mjs evals/route-judgment/ANSWER_KEY.json <register.md>
node evals/score.mjs evals/route-judgment/ANSWER_KEY.json --check
node evals/route-judgment/run.mjs
```

Scoring reuses the `score.mjs` grammar. A planted item is the correct menu line for a unit, a decoy is the premium line on an overuse trap, and `lineTolerance` is 0 so adjacent menu lines never blur. Pass needs recall of 75% and no decoy flagged.

After a key change, run `node evals/route-judgment/run.mjs --write-menu`, then the checks. The run asserts each key entry against `routeUnit()`, so a rubric change that moves a unit fails here first.

Pre-register before a live run: the hypothesis, the model and host under test, n per cell, and the stopping rule, as in the measurement protocol in `evals/README.md`. The `ambiguity` and `reversible` values in the key are the author's reading of the prose, so a disagreement with a lead is a finding about the material as often as about the lead.
