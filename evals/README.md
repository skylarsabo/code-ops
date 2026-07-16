# Evals

The suite's pitch is **signal over noise** — fewer findings, but real, and registers that stay true. That claim has to be falsifiable. This directory holds the evals that keep it honest.

Two kinds, by what can be checked deterministically:

## 1. Automated regression evals (run in CI)
Pure-Node assertions, no model in the loop. They guard mechanical behaviors the suite depends on.

All twelve are wired into `.github/workflows/validate.yml`.

- **`register-staleness/`** — the highest-signal test: it pins the one behavior the field actually lost (a register re-listing items already fixed in code). It seeds a register with a mix of fresh / moved / already-fixed / no-reference items against a fixture repo and asserts `scripts/revalidate-register.mjs` classifies each correctly and fails closed on stale entries. It also exercises the **verbatim-anchor gate**: seeded anchored items assert a `DRIFTED` classification when an anchor no longer sits on its cited line, plus the unparseable-anchor advisory for an undelimited `Anchor:` value. Run: `node evals/register-staleness/run.mjs` (exit 0 = pass).
- **`ai-tells/`** — asserts `scripts/scan-ai-tells.mjs` flags a dirty PR body across every category (TRAILER, TOOL, EMOJI, EMDASH, PHRASE, BOILERPLATE) and fails closed, while staying silent on a clean body that contains decoys. Run: `node evals/ai-tells/run.mjs`.
- **`codex-marketplace/`** — asserts the generated native Codex packages retain all source skills, explicit manual-invocation policy, the code-ops MCP declaration, and Codex-shaped traceless-hook behavior. Run: `node evals/codex-marketplace/run.mjs`.
- **`lib-docs/run.mjs`** — builds a throwaway `node_modules` fixture and asserts `scripts/lib-docs.mjs` resolves the installed version, returns the topic-matched README section + type exports, rejects a traversal-shaped name, and makes **no** network call under `noFetch` (a stubbed fetch is asserted uncalled). Run: `node evals/lib-docs/run.mjs`.
- **`lib-docs/mcp-smoke.mjs`** — drives `scripts/lib-docs-mcp.mjs` over stdio JSON-RPC (initialize → tools/list → tools/call) against a fixture and asserts the protocol and tool responses. Run: `node evals/lib-docs/mcp-smoke.mjs`.
- **`research-manifest/`** — pins the researcher plugin's egress-disclosure gate: a recorded request validates clean, an artifact citing an **unrecorded** web source fails closed, and a local-only artifact (no web citations) passes. Run: `node evals/research-manifest/run.mjs`.
- **`script-guards/`** — the regression guard for the 2026-06-23 bundled-script audit fixes (`SCR-001..005`), exercising the real `lib-docs` / `check-no-deps` / `revalidate-register` / `research-manifest` scripts so a fixed defect can't silently regress. Run: `node evals/script-guards/run.mjs`.
- **`proof-receipts/`** — pins `run-proof.mjs` (record tees + appends replayable receipts and passes exit codes through; verify replays fail-closed and refuses traversal/metacharacter commands) and `check-proof-integrity.mjs` (tampered or deleted pinned proofs fail closed; re-pins only via a loud `PROOF-AMENDED`). Run: `node evals/proof-receipts/run.mjs`.
- **`autofix-scope/`** — pins `check-autofix-scope.mjs`: always-gated paths, oversize diffs, and export-touching lines are denied; the no-flags default denies everything; config extension honored; option-smuggling `--git` refs rejected. Run: `node evals/autofix-scope/run.mjs`.
- **`redaction-scan/`** — pins both scanners: every fail-closed secret shape and every injection-tell category flags on the dirty fixture while the decoy-laden clean fixture stays silent (emoji ZWJ and integrity/`Verified-at` hashes exempt). Run: `node evals/redaction-scan/run.mjs`.
- **`preflight/`** — pins `scripts/preflight.mjs`: blank/missing `--need`/`--artifact-dir` values and an unknown flag fail closed, a genuinely missing `--need` tool fails with an explicit "not resolvable" message, a normal run inside a git work tree passes with `preflight OK`, an `--artifact-dir` colliding with an existing file fails with "not writable", and (win32 only) a `.cmd` shim on PATH still resolves via the `where.exe` fallback. Run: `node evals/preflight/run.mjs`.
- **`repo-map/`** — pins `scripts/repo-map.mjs`: blank/missing flag values, an unknown flag, and a `--root` outside any git work tree all fail closed, a normal run extracts definitions through a BOM-prefixed file, marks a binary file, and reports accurate footer counts, `--max-file-kb 0` is legal and skips every non-empty file by size, and per-file definition truncation is announced at exactly 40 definitions. Run: `node evals/repo-map/run.mjs`.

A structural step, `node scripts/check-no-deps.mjs`, guards the zero-dependency invariant (no third-party imports), and a **fixture-drift guard** runs `score.mjs --check` over every `ANSWER_KEY.json` (see below).

## 2. Judgment evals (model-in-the-loop — run manually or in a scheduled job)
These measure skill *quality* and can't be a pure assertion — they need a skill run, then scoring against an answer key. Build them as fixtures + `ANSWER_KEY.md` and score **both** axes:

- **Recall** — did the skill find the planted real issues?
- **Precision / false-positive rate** — did it stay quiet on the planted **decoys** (intentional non-issues: already-handled paths, dead code, intentional patterns)? FP rate is the suite's whole differentiator, so decoys are mandatory.
- **Baseline** — run each fixture **with** and **without** the skill (3+ reps each; record variance). An improvement that needs the token cost has to beat the no-skill control.

**Measurement protocol — pre-register before running.** Every model-in-the-loop *comparison or calibration* — a with/without-skill fixture comparison or a real-scale calibration, i.e. any run that tests a hypothesis — fills this in **before** the first scored run, and every calibration report — including a sanitized calibration note — opens with the filled block. (The scheduled weekly runner below tracks a trend and tests no hypothesis; it is out of scope.) Pre-registered asymmetry (declared before any run following the three 2026-07-06 snapshots): the strong arm runs n=1 per cell as a sanity control — 126 consecutive strong read-only cells measured constant-zero tier inflation, so its variance budget moves to the weak arm, which keeps n=3.

1. **Hypothesis** — the one sentence the run can falsify.
2. **Arms, matched** — same model, same rep count, same panel/shot count per arm; vary *only* the mechanism under test, or pre-declare any asymmetry as a known confound.
3. **n per arm + stopping rule** — fixed in advance; never extended after seeing results in search of a flipped delta.
4. **Metric + minimum practically-significant delta** — pre-declare what delta would justify the mechanism's token cost (the "beat the no-skill control" criterion, made quantitative per run).
5. **Instrument check** — will this fixture discriminate, or is it known-saturated (regression-guard-only)?

Real-scale calibrations run against a **private mirror repo** (large enough that the toy fixtures' saturation doesn't mask differences); that channel is one-way — only a sanitized calibration note (counts, bug/decoy classes, no internals) crosses back into this repo.

The **model floor** is measured, never assumed: `.github/workflows/evals-floor.yml` (dispatch-only) runs the pre-registered 2x2 — {strong, weak} model x {with-skill, no-skill control} — over every fixture with n=3 reps per cell, recording raw recall/FP/tier counts; snapshot the summaries into `evals/FLOOR_TABLE.md` before and after a hardening change. The weekly trend job pins its model for comparability.

Reports state the observed delta vs. run-to-run noise and practical significance **separately** (at n=3, a non-unanimous delta is *directional, not definitive*) and end with a validity-threats list (confounded arms, saturation, peeking, answer-key leakage into skill context).

**Scoring is automated** even though the skill run isn't. `score.mjs` compares a skill's findings (a `*_REGISTER.md`, or a JSON array of `{file,line}`) against a fixture's `ANSWER_KEY.json` and reports recall, decoys-flagged (false positives), and unkeyed flags with a PASS/FAIL verdict:
```
node evals/score.mjs evals/bug-garden/ANSWER_KEY.json <findings.md|findings.json>
node evals/score.mjs evals/bug-garden/ANSWER_KEY.json --check   # verify the key still matches the fixture
```
Candidates are matched to keyed items by **path suffix + basename** (not basename alone, so a wrong-directory citation earns no credit) within `lineTolerance`. Decoy false-positives are counted **independently** of recall, and an ambiguous flag equidistant between a planted bug and a decoy is scored as the decoy (fail-safe for precision). A `FAIL` verdict exits non-zero by default; pass `--no-exit` to inspect without gating.

**Built fixtures:**
- **`bug-garden/`** — 4 planted bugs + 3 decoys for `rigor:bug-hunt` / `quality-scan` / `code-ops-suite:codebase-audit`.
- **`leak-lab/`** — 3 planted leaks + 3 decoys for the privacy audits.
- **`drifted-docs/`** — 3 planted doc/code drifts + 2 decoys for `code-ops-suite:doc-alignment`.
- **`hasty-code/`** — 3 planted hasty-code issues + 2 decoys for `code-ops-suite:normalize`.
- **`trap-garden/`** — 5 subtle bugs + 6 tempting decoys (precision-under-temptation) for `rigor:bug-hunt`.
- **`calibration-traps/`** — 4 bugs + 4 decoys encoding the bug/decoy classes from a real-scale calibration; the decoys are the regression guard for the disconfirmation rules (intent-annotation, locate-the-handler).
- **`xfn-traps/`** — 4 bugs + 4 decoys as look-alike pairs where each decoy is safe **only** because of a guard in its **sole caller** (no in-file tell). The one fixture that isolates **independent refutation** (`§I` / `§7`) from line-local self-review — clearing a decoy requires tracing cross-function to the caller.

A deterministic **fixture-drift guard** in `validate.yml` runs `score.mjs --check` over every `ANSWER_KEY.json`, so an answer key can never silently drift from its fixture.

**Scheduled runner.** `.github/workflows/evals.yml` runs these judgment evals on a weekly cron (and on `workflow_dispatch`): for each fixture it drives the relevant skill — read from this checkout's `SKILL.md`, so it works even though the plugins are not installed on the runner — over the fixture repo with `claude-code-action`, then scores the result with `score.mjs` and records recall / false-positives in the run summary. It needs a Claude credential and skips cleanly without one. It is deliberately **not** a per-PR gate — model-in-the-loop recall/FP varies run to run, so it tracks the trend rather than blocking a merge.

**To add one** (e.g. `drifted-docs` for `doc-alignment`, `hasty-code` for `normalize`): drop in a `repo/`, write `ANSWER_KEY.json` (`planted` + `decoys`, each with a `line` and a short `anchor` substring on that line) and an `ANSWER_KEY.md`, then `node evals/score.mjs <key> --check` to confirm the key matches. Keep planted and decoy lines apart enough to be distinct, and keep `ANSWER_KEY.*` out of any context handed to the skill.
