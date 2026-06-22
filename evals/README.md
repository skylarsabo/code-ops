# Evals

The suite's pitch is **signal over noise** — fewer findings, but real, and registers that stay true. That claim has to be falsifiable. This directory holds the evals that keep it honest.

Two kinds, by what can be checked deterministically:

## 1. Automated regression evals (run in CI)
Pure-Node assertions, no model in the loop. They guard mechanical behaviors the suite depends on.

- **`register-staleness/`** — the single highest-signal test: it pins the one behavior the field actually lost (a register re-listing items already fixed in code). It seeds a register with a mix of fresh / moved / already-fixed items against a fixture repo and asserts `scripts/revalidate-register.mjs` classifies each correctly and fails closed on stale entries. Run: `node evals/register-staleness/run.mjs` (exit 0 = pass). Wired into `.github/workflows/validate.yml`.

## 2. Judgment evals (model-in-the-loop — run manually or in a scheduled job)
These measure skill *quality* and can't be a pure assertion — they need a skill run, then scoring against an answer key. Build them as fixtures + `ANSWER_KEY.md` and score **both** axes:

- **Recall** — did the skill find the planted real issues?
- **Precision / false-positive rate** — did it stay quiet on the planted **decoys** (intentional non-issues: already-handled paths, dead code, intentional patterns)? FP rate is the suite's whole differentiator, so decoys are mandatory.
- **Baseline** — run each fixture **with** and **without** the skill (3+ reps each; record variance). An improvement that needs the token cost has to beat the no-skill control.

**Scoring is automated** even though the skill run isn't. `score.mjs` compares a skill's findings (a `*_REGISTER.md`, or a JSON array of `{file,line}`) against a fixture's `ANSWER_KEY.json` and reports recall, decoys-flagged (false positives), and unkeyed flags with a PASS/FAIL verdict:
```
node evals/score.mjs evals/bug-garden/ANSWER_KEY.json <findings.md|findings.json>
node evals/score.mjs evals/bug-garden/ANSWER_KEY.json --check   # verify the key still matches the fixture
```
Each candidate finding is assigned to its single nearest keyed item within `lineTolerance`, so one finding can't satisfy two items.

**Built fixtures:**
- **`bug-garden/`** — 4 planted bugs + 3 decoys for `rigor:bug-hunt` / `quality-scan` / `code-ops-suite:codebase-audit`.
- **`leak-lab/`** — 3 planted leaks + 3 decoys for the privacy audits.

**To add one** (e.g. `drifted-docs` for `doc-alignment`, `hasty-code` for `normalize`): drop in a `repo/`, write `ANSWER_KEY.json` (`planted` + `decoys`, each with a `line` and a short `anchor` substring on that line) and an `ANSWER_KEY.md`, then `node evals/score.mjs <key> --check` to confirm the key matches. Keep planted and decoy lines apart enough to be distinct, and keep `ANSWER_KEY.*` out of any context handed to the skill.
