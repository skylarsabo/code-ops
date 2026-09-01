# Wire CI Gates

Use a local judgment gate before a pull request and deterministic GitHub validation after it.
This repository does not run model reviews on its hosted GitHub runners.

## Local pre-PR review

Create ignored review storage, commit the feature branch, and prepare a plan against its base:

```sh
node scripts/local-review-gate.mjs prepare --root . --base origin/main --out <ignored-plan> --receipts <ignored-receipts>
```

The plan binds the base SHA, HEAD SHA, binary diff, and changed paths. Do not modify the branch
after preparation. Run `rigor:deep-review` and `privacy-opsec-suite:opsec-pr-gate` locally.
Write their reports to ignored paths. Record each review with a strong-or-frontier reviewer,
high-or-higher effort, verdict, and finding counts:

```sh
node scripts/local-review-gate.mjs record --root . --plan <ignored-plan> --gate local-deep-review --verdict PASS --report <ignored-deep-report> --reviewer deep-reviewer@model --tier strong --effort high --blocking 0 --confirmed 0
node scripts/local-review-gate.mjs record --root . --plan <ignored-plan> --gate local-opsec-gate --verdict PASS --report <ignored-opsec-report> --reviewer opsec-reviewer@model --tier strong --effort high --blocking 0 --confirmed 0
node scripts/local-review-gate.mjs check --root . --plan <ignored-plan>
```

The check requires exact review coverage and replays report digests and the receipt hash chain.
It rejects stale base or HEAD state, a changed binary diff, a dirty worktree, missing reports,
weak reviewer tiers, or a failing verdict. Evidence: `scripts/local-review-gate.mjs:97-269`
and `scripts/local-review-gate.mjs:357-450`.

Push the reviewed branch without opening a pull request. Verify both live branch tips, then
optionally publish verified receipts as commit statuses:

```sh
node scripts/local-review-gate.mjs verify-remote --root . --plan <ignored-plan>
node scripts/local-review-gate.mjs publish --root . --plan <ignored-plan>
```

Publication derives the repository from the verified Git remote and rejects a mismatched
`--repo`. Configure required statuses in strict mode so a later base update requires a new merge
candidate. Status publication never substitutes for local review execution or human approval.

## Local recurring judgment work

Schedule trend mode weekly with local Codex automation. Pass `--execution available` when workers
can run commands, and use `unavailable` only when the host mechanically withholds execution.
Keep the full plan lead-only because it binds answer-key paths; hand workers only their units.
Run floor mode locally before a pull request when policy requires it. Both modes write
digest-bound score receipts and measure judgment quality, not hosted merge status.

## GitHub gate

Require the relevant jobs from `.github/workflows/validate.yml`. The hosted workflow runs
deterministic lint, renderer checks, checks, and regression tests only. It uses no model
credential and does not post model-review verdicts.

## Consumer GitHub review workflows

The shipped GitHub review examples remain available to adopting repositories. Use
`/install-github-app` to generate current action plumbing, then adapt the relevant example:

- `plugins/code-ops-suite/examples/github-pr-review.yml`
- `plugins/rigor/examples/github-deep-review.yml`
- `plugins/privacy-opsec-suite/examples/github-opsec-gate.yml`

An adopter owns its credential, permissions, workflow event choice, and branch-protection
status policy. The examples do not alter this repository's local-review policy.

## Related

- [08 · CI and automation](../40 Engineering/Handbook/08-ci-and-automation.md)
- [CI portability](ci-portability.md)
