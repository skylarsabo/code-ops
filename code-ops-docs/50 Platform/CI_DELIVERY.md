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

The documentation link gate rejects missing, escaping, case-unsafe, and ambiguous local targets. It rejects hub-internal directory links and unresolved local Markdown heading fragments. Evidence: `scripts/check-doc-links.mjs:76-89` and `evals/doc-links/run.mjs:11-28`.

The documentation citation gate validates both `path:line` references and explicit commit fields. Recognized commit IDs must be complete tokens, resolve unambiguously under the repository's Git object format, and name commits in `HEAD` history. A shallow checkout that cannot establish ancestry is an infrastructure failure, so both validation jobs fetch full history. Evidence: `scripts/check-doc-citations.mjs` and `.github/workflows/validate.yml`.

The record-collection eval exercises immutable evidence contracts on Ubuntu and Windows. Repositories with record collections require a complete checkout using `fetch-depth: 0` and `filter: ""`. A shallow or partial checkout is infrastructure failure, not evidence loss.

The v4 gate chain keeps responsibilities separate. The manifest gate owns domain and collection declarations. The records gate owns identities, baselines, history, citation state, curation chains, and semantic projections. The link gate continues to own ordinary hub navigation.

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
