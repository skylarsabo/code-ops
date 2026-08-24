# CI workflows

Charter: the five workflows under `.github/workflows/` — what gates vs measures, the gate-edit semantics, and the invariants a workflow change must not break; leaves out the gate scripts the workflows invoke (see gate-scripts) and the eval fixtures they run (see evals-and-calibration).

## The shape: two axes, credential-dependence and determinism

`validate.yml` is the only true fail-closed gate — deterministic, no secrets, contents:read only, and the only workflow on push+PR (push restricted to main deliberately, to avoid double runs per PR head). `deep-review.yml` and `opsec-gate.yml` are fail-closed *when credentialed* and skip clean otherwise: a missing credential means "can't review here", not "PR is bad". `evals.yml` (weekly) and `evals-floor.yml` (dispatch-only) are measurements, never gates — model-in-the-loop recall varies run to run, so they track trend; the floor workflow is deliberately contents:read so it *cannot* commit its own results (FLOOR_TABLE.md is snapshotted by hand).

## Gate-edit semantics (the most important judgment)

PR-gate workflows only take effect once merged to main: a PR editing `deep-review.yml` or `opsec-gate.yml` is not reviewed by its own edit — verify gate changes on a follow-up PR touching no workflow file. `check-gate-workflow-edit.mjs` surfaces this as a loud advisory that always exits 0 (an unreviewed gate edit is a human-process risk, not a mechanical defect). `validate.yml` is deliberately absent from that advisory list — its PR-head version *does* run against the PR, so it reviews its own edit — and an eval pins that exclusion. Workflow paths are always-gated in the autofix scope checker: they can never ride the auto-safe lane.

A green AI-gate check can mean four different things: reviewed, skipped-no-credential, skipped-generated-data-only-diff, or passed-on-retry. Only step logs distinguish them — a green check is not evidence of review.

## Invariants a workflow edit must not break

- **The retry guard is what keeps the AI gates fail-closed**: both review attempts run with `continue-on-error: true`, and a separate guard step fails the job when both fail. Removing the guard while keeping continue-on-error silently converts the gate to fail-open — the canonical "never weaken a gate" violation.
- **The retry prompt is a byte-duplicate of the primary prompt** in both gate files; nothing gates their parity. Edit both or the retry reviews to a different bar.
- **Model pins are two different deliberate decisions**: the gates pin the current strong model so quality doesn't track the action default; the measurement workflows pin an *older* model on purpose for week-over-week comparability. Never "modernize" the evals pin to match the gates.
- `max-parallel: 4` on the floor matrix is an empirically derived throttle (84 concurrent jobs broke the credential exchange), and its strong-arm `exclude` asymmetry is pre-registered (measured constant-zero inflation) — re-symmetrizing quadruples cost for no signal.
- Action SHA pins are a supply-chain control repeated across all five files; bumping one file creates silent skew. `fetch-depth: 0` is load-bearing wherever base-diffs run; the Windows job omits it because it runs none.
- Both measurement workflows restore fixture pristineness (`git checkout -- <target>`) before scoring, and the ANSWER_KEY reaches only the post-hoc scorer, never the model prompt. `score.mjs --no-exec` in the floor workflow is the tier-inflation detector, not a perf flag.

## Couplings and gotchas

- The ~20 `node evals/<name>/run.mjs` lines in validate.yml are lint-load-bearing literals (lint does a whole-file `includes`), so an eval wired only into the Windows job would satisfy lint while never running on the ubuntu leg — watch placement, not just presence.
- The two AI gates share a generated-data skip regex naming the render-output paths; if the renderer's outputs move, both regexes move. opsec-gate deliberately does *not* exempt docs (docs are a leak surface); deep-review does.
- The Windows structural-lint leg is a deliberate subset (~11 of ~28 checks, targeting path/shell/line-ending regressions) — notably the answer-key drift loop is ubuntu-only POSIX shell. Don't assume Windows CI covers what ubuntu covers.
- The fixture matrices in evals.yml and evals-floor.yml are hand-duplicated with no parity gate between them or against the answer-key set — adding a judgment fixture is a two-workflow edit.
- `claude plugin validate` in validate.yml is decorative (`|| true`); structural lint is the gate. Two validate.yml steps run against the REAL calibration store, so deleting an eval can fail CI via the graph's edge check, not just the lint literal.
- `id-token: write` exists solely for the claude-code-action OAuth path on the credentialed workflows; validate.yml correctly has neither it nor pull-requests:write.
