# CI portability

The portable hosted gate is deterministic validation. Model-driven review is a local
workflow that carries durable receipts between hosts.

## Hosted deterministic validation

Run the command chain from `.github/workflows/validate.yml` on GitHub Actions, GitLab CI,
CircleCI, or another host with the repository's Node version and full Git history. The workflow
is the source of truth. It runs lint, generated-output checks, dependency checks, documentation
checks, and regression tests. It does not require a model credential.

```sh
node scripts/lint-plugins.mjs
node scripts/build-codex-marketplace.mjs --check
node scripts/build-opencode-dist.mjs --check
node scripts/check-no-deps.mjs
```

The same four commands run through the script entrypoint as `co build lint`, `co build codex
--check`, `co build opencode --check`, and `co check deps`. Both spellings resolve to the same
files, so a host may use whichever reads better in its configuration.

Require the host's deterministic validation job in its branch-protection equivalent.

## Platform legs and their triggers

Three jobs cover the platforms this repository supports. Their triggers differ, so an adopting
host must copy the trigger as well as the step list:

- `structural-lint` runs on `ubuntu-latest` for every push to `main` and every pull request.
- `structural-lint-windows` runs on `windows-latest` under the same events, with one gated step.
- `host-evals-macos` runs on `macos-latest` for the weekly `schedule` and for `workflow_dispatch` only.

The Windows leg gates one step. Its `Detect record-collection inputs` step compares the range
under test against `scripts/records.mjs`, `scripts/record-lib.mjs`, `scripts/docs-manifest.mjs`,
`evals/record-collections`, and `code-ops-docs/98 System/Records`. The record-collection eval runs
on Windows only when one of those inputs changed, or when the workflow's own record eval
invocation lines changed. The scheduled run and a manual dispatch run it unconditionally. The
Ubuntu leg runs it on every change, so the gate narrows cost without narrowing coverage.

The macOS leg costs ten Linux minutes per minute, so it stays off the pull-request path. It runs
structural lint plus the host-facing evals for skim, digest, the digest hook, the symbol index and
its MCP server, the ladder card, the context audit, the over-build scanner, the deferral harvest,
and the atlas check. Trigger it by hand from the Actions tab when a change touches host behavior.

## Portable local judgment evidence

Model review is opt-in and rare. Run deep review and OpSec review on a local host before opening a
pull request when a change touches a high-risk surface, or when the operator asks. The
local gate binds base SHA, HEAD SHA, binary diff, report digests, strong-or-frontier reviewer
receipts, and a hash chain. Its ignored plan and receipts travel as local operational evidence,
not as hosted CI state. Evidence: `scripts/local-review-gate.mjs:97-269` and
`scripts/local-review-gate.mjs:357-450`.

Use `local-review-gate.mjs publish` only when commit statuses help an adopting team's workflow.
The publisher verifies both live branch tips and binds the destination to that Git remote. The
published statuses represent a verified local result. They do not execute model review. Strict
required-status mode prevents a base update from reusing an older merge candidate.

Run weekly trend and policy-required floor calibration locally through host automation. Record
whether execution was available, keep answer-key-bearing plans out of worker context, and
dispatch only safe units. Their digest-bound results remain outside hosted merge validation.

## Opt-in hosted model examples

Consumer repositories can opt into the shipped GitHub review examples. They must supply the
host action, credential, least-privilege permissions, event choice, and status policy. Those
examples remain supported but are not a portable or canonical requirement for this repository.

## Related

- [08 · CI and automation](../40 Engineering/Handbook/08-ci-and-automation.md)
- [Wire CI gates](wire-ci-gates.md)
- [Infrastructure](../50 Platform/INFRASTRUCTURE.md)

*Verified-at: b0ffede*
