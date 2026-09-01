# 08 · CI and automation

## The short version

- Run model-driven deep review and OpSec review locally before opening a pull request.
- Use local Codex automation for the weekly judgment trend and policy-required floor calibration.
- Require GitHub `validate` for deterministic lint, rendering, checks, and regression tests.
- Treat optional published commit statuses as transport for verified local receipts, not review execution.
- Keep consumer GitHub review examples opt-in. Their credentials and branch-protection policy belong to the adopter.

## Local judgment gate

`local-review-gate.mjs` prepares a review only from a clean feature branch. It binds the base
SHA, HEAD SHA, binary-diff digest, and changed paths into an ignored plan. A changed base, HEAD,
diff, worktree, or ambiguous Git index flag invalidates the plan. Evidence:
`scripts/context-index-lib.mjs:67-79`, `scripts/local-review-gate.mjs:97-185`, and
`scripts/local-review-gate.mjs:357-383`.

Record one receipt for `local-deep-review` and one for `local-opsec-gate`. Each receipt names a
strong-or-frontier reviewer, high-or-higher effort, verdict, report digest, finding counts, and
prior receipt digest. A PASS requires zero blocking findings. `check` replays the exact chain and
rejects missing, duplicate, drifted, or failing receipts. The gate also requires distinct reviewer
identities and refuses symbolic-link or physical-file aliases among authority files. Evidence:
`scripts/local-review-gate.mjs:194-269` and `scripts/local-review-gate.mjs:384-450`.

Run the reviews with the applicable `rigor:deep-review` and `privacy-opsec-suite:opsec-pr-gate`
bars. The local reviewer performs the model judgment. The gate validates its durable evidence.
It does not auto-merge or replace a human acceptance decision.

Use `publish` only when commit statuses help the team's GitHub workflow. It verifies the live
remote base and feature refs, derives the status repository from that remote, and rejects a
conflicting override before posting. Configure required statuses in strict mode so base movement
invalidates the merge candidate. Publication is optional.

## GitHub validation

`validate.yml` is this repository's hosted merge gate. It uses `contents: read` and runs only
deterministic Node lint, renderer checks, checks, and regression tests. It does not execute the
model-driven review, OpSec review, weekly trend, or floor calibration. Evidence:
`.github/workflows/validate.yml:1-20` and `:31-199`.

Require the relevant structural validation jobs in branch protection. A hosted green check proves
only its deterministic commands. The local review receipts remain separate evidence.

## Consumer GitHub examples

The plugin examples for breadth review, deep review, and OpSec review remain supported as
opt-in consumer integrations. An adopter may use `/install-github-app`, its own credential,
permissions, and required-status policy. Those workflows are not this repository's canonical
review path. See `plugins/code-ops-suite/examples/github-pr-review.yml`,
`plugins/rigor/examples/github-deep-review.yml`, and
`plugins/privacy-opsec-suite/examples/github-opsec-gate.yml`.

## Recurring local automation

Run `judgment-evals.mjs plan --mode trend --execution available` weekly through local Codex
automation. Use `unavailable` only when the host mechanically withholds execution. Keep the full
plan lead-only and hand workers only units, which omit answer-key paths. Clear any
`assume-unchanged` or `skip-worktree` flags before planning. Run `--mode floor`
locally when policy requires calibration; it refuses identical strong and weak model IDs. Both
modes are local measurements, not hosted merge checks.

`researcher:ecosystem-watch`, `code-ops-suite:dependency-upgrade`, and
`code-ops-suite:security-privacy-audit` can also run on a local cadence. Their ordinary safety,
egress, and approval rules remain in force.

## Related

- [Wire CI gates](../../70 Guides/wire-ci-gates.md)
- [CI portability](../../70 Guides/ci-portability.md)
- [The evals directory](../../../evals/README.md)
