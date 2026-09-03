# 08 · CI and automation

This chapter decides what runs where. Hosted GitHub Actions run deterministic checks and
are the required merge gate. Model review runs locally, only when the operator asks for
it. Read it before wiring a gate or wondering why a job did not run on your pull request.

## The short version

- Require the GitHub `validate` workflow for deterministic lint, rendering, checks, and regression evals.
- Run the model-driven deep review and OpSec review locally, and only when a high-risk surface or the operator calls for them.
- Treat a published commit status as transport for a verified local receipt, never as review execution.
- Expect the Windows leg to skip the record-collection eval unless the change touched its inputs.
- Expect the macOS host-eval job on the weekly schedule and on manual dispatch only.
- Keep the consumer GitHub review examples opt-in. Their credentials and branch-protection policy belong to the adopter.

## Hosted validation: what merges a change

`validate.yml` is this repository's hosted merge gate. It uses `contents: read` and runs
only deterministic Node lint, renderer checks, gates, and regression evals. It never runs
the model-driven review, the OpSec review, the weekly judgment trend, or floor
calibration. Evidence: `.github/workflows/validate.yml:1-26` and `:28-241`.

Three triggers fire it. A push to `main` and a pull request run the full Ubuntu
`structural-lint` job and the `structural-lint-windows` job. A weekly cron at
`0 6 * * 1` runs everything, including the two jobs that a pull request skips. Manual
`workflow_dispatch` does the same. The push trigger is restricted to `main` on purpose,
so a same-repo pull-request branch does not pay for two identical structural-lint runs.
Evidence: `.github/workflows/validate.yml:3-17`.

Require the relevant structural validation jobs in branch protection. A hosted green
check proves only its deterministic commands. Local review receipts remain separate
evidence.

### The narrowed Windows record-collection gate

The Windows leg mirrors the Ubuntu checks so a path, quoting, or line-ending regression
is caught before merge. One eval on that leg is path-gated. The durable
record-collection eval costs about 754 seconds of a 960-second Windows job, against about
73 seconds on Ubuntu, so it runs on Windows only when the range under test touched
`scripts/records.mjs`, `scripts/record-lib.mjs`, `scripts/docs-manifest.mjs`,
`evals/record-collections`, `code-ops-docs/98 System/Records`, or the eval's own
invocation lines in the workflow. Ubuntu still runs it on every change. The weekly
schedule and a manual dispatch run it on Windows unconditionally, so a platform-side
regression cannot hide behind the gate. Evidence:
`.github/workflows/validate.yml:397-430`.

The documentation manifest is deliberately outside the trigger list. It re-syncs on
nearly every change, and a manifest-only edit cannot alter record behavior that the
Ubuntu copy of the same eval would miss.

### The macOS host-eval job

The two devices in use are Windows and macOS, and a macOS runner minute costs ten Linux
minutes. So `host-evals-macos` runs on the weekly schedule and on manual dispatch only,
never per pull request. It runs `lint-plugins.mjs` and the host-facing evals: skim,
digest, the digest hook, context-query, the context-query MCP server, the ladder card,
the context audit, the over-build scanner, the deferral harvest, and atlas-check.
Evidence: `.github/workflows/validate.yml:244-267`.

The job earns its cost. The first macOS host-eval run found that `scan-overbuild.mjs`
matched nothing there, because `git grep -E` on macOS runs the system regular-expression
engine, which has no `\s`, `\w`, or `\b`. The fix rewrote those patterns in POSIX
classes.

## Local judgment gate: opt-in and rare

Model review gates do not run on every change. The deterministic gate chain and the
lead's own read of the final diff run every time. `code-ops-suite:local-review-gate`
runs when the operator says so at a checkpoint, or when a brief names it, for a change
touching a high-risk surface: security, egress, data migrations, public contracts, or
the gate scripts themselves.

`local-review-gate.mjs` prepares a review only from a clean feature branch. It binds the
base SHA, the HEAD SHA, a binary-diff digest, and the changed paths into an ignored plan.
A changed base, HEAD, diff, worktree, or ambiguous Git index flag invalidates the plan.
Evidence: `scripts/context-index-lib.mjs:67-79`, `scripts/local-review-gate.mjs:97-185`,
and `scripts/local-review-gate.mjs:357-383`.

Record one receipt for `local-deep-review` and one for `local-opsec-gate`. Each receipt
names a strong-or-frontier reviewer, high-or-higher effort, a verdict, a report digest,
finding counts, and the prior receipt digest. A PASS requires zero blocking findings.
`check` replays the exact chain and rejects a missing, duplicate, drifted, or failing
receipt. The gate also requires distinct reviewer identities, and it refuses a symbolic
link or a physical-file alias among the authority files. Evidence:
`scripts/local-review-gate.mjs:194-269` and `scripts/local-review-gate.mjs:384-450`.

Run the reviews at the applicable `rigor:deep-review` and
`privacy-opsec-suite:opsec-pr-gate` bars. The local reviewer performs the model judgment.
The gate validates its durable evidence. It never auto-merges and never replaces a human
acceptance decision.

Use `publish` only when commit statuses help the team's GitHub workflow. It verifies the
live remote base and feature refs, derives the status repository from that remote, and
rejects a conflicting override before posting. Configure required statuses in strict mode
so base movement invalidates the merge candidate. Any new commit or base movement voids a
published receipt. Publication is optional.

## Consumer GitHub examples

The plugin examples for breadth review, deep review, and OpSec review remain supported as
opt-in consumer integrations. An adopter may use `/install-github-app` with its own
credential, permissions, and required-status policy. Those workflows are not this
repository's canonical review path. See
`plugins/code-ops-suite/examples/github-pr-review.yml`,
`plugins/rigor/examples/github-deep-review.yml`, and
`plugins/privacy-opsec-suite/examples/github-opsec-gate.yml`.

## Recurring local automation

Run `judgment-evals.mjs plan --mode trend --execution available` weekly through local
Codex automation. Use `unavailable` only when the host mechanically withholds execution.
Keep the full plan lead-only and hand workers only units, which omit answer-key paths.
Clear any `assume-unchanged` or `skip-worktree` flag before planning. Run `--mode floor`
locally when policy requires calibration. That mode refuses identical strong and weak
model identifiers. `--mode register` compiles one unit per declared tier arm against the
same skill and answer key. All three modes are local measurements, never hosted merge
checks.

`researcher:ecosystem-watch`, `code-ops-suite:dependency-upgrade`, and
`code-ops-suite:security-privacy-audit` can also run on a local cadence. Their ordinary
safety, egress, and approval rules remain in force.

## Related

- [Wire CI gates](../../70 Guides/wire-ci-gates.md)
- [CI portability](../../70 Guides/ci-portability.md)
- [The evals directory](../../../evals/README.md)
- [CI_DELIVERY.md](../../50 Platform/CI_DELIVERY.md)
