# Wire CI gates

Use deterministic GitHub validation as the required merge gate. Add a local judgment gate
before a pull request only when the operator asks for it or a brief names it. This
repository runs no model reviews on its hosted GitHub runners.

## The required gate: deterministic GitHub validation

Require the relevant jobs from `.github/workflows/validate.yml`. The hosted workflow runs
deterministic lint, renderer checks, documentation checks, and regression tests only. It uses no
model credential and posts no model-review verdict.

Three jobs cover the supported platforms, and their triggers differ:

- `structural-lint` on `ubuntu-latest` runs the full check list for every push to `main` and every pull request.
- `structural-lint-windows` on `windows-latest` mirrors that list under the same events, with the record eval gated.
- `host-evals-macos` on `macos-latest` runs only for the weekly `schedule` and for `workflow_dispatch`.

Require the two structural-lint jobs. Leave the macOS job unrequired, because it does not run on
a pull request.

### The narrowed Windows record gate

The record-collection eval dominates the Windows leg, at roughly 754 seconds of a 960-second job
against 73 seconds on Ubuntu. The `Detect record-collection inputs` step therefore decides whether
it runs. It sets `changed=true` when the range under test touched any of these paths:

- `scripts/records.mjs`
- `scripts/record-lib.mjs`
- `scripts/docs-manifest.mjs`
- `evals/record-collections`
- `code-ops-docs/98 System/Records`

The step also sets `changed=true` when the workflow's own record eval invocation lines changed, so
moving the eval cannot silently skip it. A `schedule` run always sets `changed=true`. The Ubuntu
leg runs the eval unconditionally on every change, so coverage never depends on the gate.

### The macOS host-eval job

The two devices in use are Windows and macOS. A macOS runner minute costs ten Linux minutes, so
the macOS leg runs on the weekly schedule and on manual dispatch only. It runs structural lint plus
the host-facing evals: skim, digest, the digest hook, the symbol index, the symbol-index MCP
server, the ladder card, the context audit, the over-build scanner, the deferral harvest, and the
atlas check. To exercise a host-behavior change before merge, dispatch the workflow by hand from
the Actions tab.

## The optional gate: local judgment review

Model review is opt-in and rare. Run it when a change touches a high-risk surface (security,
egress, data migrations, public contracts, gate scripts), or when the operator asks. Otherwise the
deterministic chain plus a human read of the diff is the review.

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
candidate. Any new commit or base movement voids a published status. Status publication never
substitutes for local review execution or human approval.

## Local recurring judgment work

Schedule trend mode weekly with local automation. Pass `--execution available` when workers
can run commands, and use `unavailable` only when the host mechanically withholds execution.
Keep the full plan lead-only because it binds answer-key paths. Hand workers only their units.
Run floor mode locally before a pull request when policy requires it. Both modes write
digest-bound score receipts and measure judgment quality, not hosted merge status.

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
- [Infrastructure](../50 Platform/INFRASTRUCTURE.md)

*Verified-at: b0ffede*
