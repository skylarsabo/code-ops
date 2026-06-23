# Evals

The suite's pitch is **signal over noise** — fewer findings, but real, and registers that stay true. That claim has to be falsifiable. This directory holds the evals that keep it honest.

Two kinds, by what can be checked deterministically:

## 1. Automated regression evals (run in CI)
Pure-Node assertions, no model in the loop. They guard mechanical behaviors the suite depends on.

All four are wired into `.github/workflows/validate.yml`.

- **`register-staleness/`** — the highest-signal test: it pins the one behavior the field actually lost (a register re-listing items already fixed in code). It seeds a register with a mix of fresh / moved / already-fixed / no-reference items against a fixture repo and asserts `scripts/revalidate-register.mjs` classifies each correctly and fails closed on stale entries. Run: `node evals/register-staleness/run.mjs` (exit 0 = pass).
- **`ai-tells/`** — asserts `scripts/scan-ai-tells.mjs` flags a dirty PR body across every category (TRAILER, TOOL, EMOJI, EMDASH, PHRASE, BOILERPLATE) and fails closed, while staying silent on a clean body that contains decoys. Run: `node evals/ai-tells/run.mjs`.
- **`lib-docs/run.mjs`** — builds a throwaway `node_modules` fixture and asserts `scripts/lib-docs.mjs` resolves the installed version, returns the topic-matched README section + type exports, rejects a traversal-shaped name, and makes **no** network call under `noFetch` (a stubbed fetch is asserted uncalled). Run: `node evals/lib-docs/run.mjs`.
- **`lib-docs/mcp-smoke.mjs`** — drives `scripts/lib-docs-mcp.mjs` over stdio JSON-RPC (initialize → tools/list → tools/call) against a fixture and asserts the protocol and tool responses. Run: `node evals/lib-docs/mcp-smoke.mjs`.

A fifth structural step, `node scripts/check-no-deps.mjs`, guards the zero-dependency invariant (no third-party imports).

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
Candidates are matched to keyed items by **path suffix + basename** (not basename alone, so a wrong-directory citation earns no credit) within `lineTolerance`. Decoy false-positives are counted **independently** of recall, and an ambiguous flag equidistant between a planted bug and a decoy is scored as the decoy (fail-safe for precision). A `FAIL` verdict exits non-zero by default; pass `--no-exit` to inspect without gating.

**Built fixtures:**
- **`bug-garden/`** — 4 planted bugs + 3 decoys for `rigor:bug-hunt` / `quality-scan` / `code-ops-suite:codebase-audit`.
- **`leak-lab/`** — 3 planted leaks + 3 decoys for the privacy audits.

**To add one** (e.g. `drifted-docs` for `doc-alignment`, `hasty-code` for `normalize`): drop in a `repo/`, write `ANSWER_KEY.json` (`planted` + `decoys`, each with a `line` and a short `anchor` substring on that line) and an `ANSWER_KEY.md`, then `node evals/score.mjs <key> --check` to confirm the key matches. Keep planted and decoy lines apart enough to be distinct, and keep `ANSWER_KEY.*` out of any context handed to the skill.
