# CI Portability

The portable hosted gate is deterministic validation. Model-driven review is a local Codex
workflow that carries durable receipts between hosts.

## Hosted validation

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

Require the host's deterministic validation job in its branch-protection equivalent.

## Portable local judgment evidence

Run deep review and OpSec review on the local Codex host before opening a pull request. The
local gate binds base SHA, HEAD SHA, binary diff, report digests, strong-or-frontier reviewer
receipts, and a hash chain. Its ignored plan and receipts travel as local operational evidence,
not as hosted CI state. Evidence: `scripts/local-review-gate.mjs:97-269` and
`scripts/local-review-gate.mjs:357-450`.

Use `local-review-gate.mjs publish` only when commit statuses help an adopting team's workflow.
The publisher verifies both live branch tips and binds the destination to that Git remote. The
published statuses represent a verified local result; they do not execute model review. Strict
required-status mode prevents a base update from reusing an older merge candidate.

Run weekly trend and policy-required floor calibration locally through Codex automation. Record
whether execution was available, keep answer-key-bearing plans out of worker context, and
dispatch only safe units. Their digest-bound results remain outside hosted merge validation.

## Opt-in hosted model examples

Consumer repositories can opt into the shipped GitHub review examples. They must supply the
host action, credential, least-privilege permissions, event choice, and status policy. Those
examples remain supported but are not a portable or canonical requirement for this repository.

## Related

- [08 · CI and automation](../40 Engineering/Handbook/08-ci-and-automation.md)
- [Wire CI gates](wire-ci-gates.md)
