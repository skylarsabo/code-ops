---
type: reference
status: current
updated: 2026-08-24
---

# CI and Delivery

## Validation gate

The `validate` workflow runs for every pull request, pushes to `main`, and manual dispatch. It cancels an older run for the same Git ref. Evidence: `.github/workflows/validate.yml:1-20`.

The Ubuntu structural-lint job runs package lint, generated-output drift checks, dependency checks, vault conformance, and the repository regression evals. Evidence: `.github/workflows/validate.yml:23-150`.

The Windows job mirrors structural checks that can differ by path handling, quoting, or line endings. Evidence: `.github/workflows/validate.yml:151-255`.

## Pull-request gates

`Deep Review (rigor)` runs on opened, synchronized, and reopened pull requests. It scopes review to changed files, asks Claude for a verification-first review, and fails closed if two review attempts fail. Evidence: `.github/workflows/deep-review.yml:11-27`, `.github/workflows/deep-review.yml:55-133`, and `.github/workflows/deep-review.yml:135-137`.

`OpSec PR Gate` is a distinct pull-request gate for privacy and operational-security review. It has the same event scope and requires a configured Claude credential. Evidence: `.github/workflows/opsec-gate.yml:10-28`.

The branch protection policy requires `structural-lint`, `deep-review`, and `opsec-gate` before merge. This policy is configured outside the repository, so it requires live GitHub verification before a release decision.

## Delivery path

The canonical packages are rendered into host-specific distributions before delivery. CI checks drift rather than trusting a local hook. Evidence: `.github/workflows/validate.yml:39-45` and `AGENTS.md:108-117`.

Release changes must bump the canonical plugin version, the marketplace entry, and the plugin changelog. Evidence: `AGENTS.md:108-114`.

## Merge safety

Never rely on a pull request to validate its own change to a PR-gate workflow. Validate a gate-workflow edit in a follow-up pull request that does not change that workflow. Evidence: `AGENTS.md:37-39`.

The project does not define an automatic production deployment. Its delivery artifact is a versioned, validated marketplace package.
