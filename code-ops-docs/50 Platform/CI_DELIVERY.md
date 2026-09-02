---
type: reference
status: current
updated: 2026-09-01
---

# CI and Delivery

## Validation gate

The `validate` workflow runs for every pull request, pushes to `main`, and manual dispatch. It cancels an older run for the same Git ref. Evidence: `.github/workflows/validate.yml:1-20`.

The Ubuntu structural-lint job runs package lint, generated-output drift checks, dependency checks, vault conformance, and repository regression evals. It runs the long-horizon runtime eval. Evidence: `.github/workflows/validate.yml:23-154`.

The Windows job runs the long-horizon runtime eval too. This detects path, quoting, and line-ending failures that differ by host. Evidence: `.github/workflows/validate.yml:220-313`.

The documentation link gate rejects missing, escaping, case-unsafe, and ambiguous local targets. It rejects hub-internal directory links and unresolved local Markdown heading fragments. Evidence: `scripts/check-doc-links.mjs:76-89` and `evals/doc-links/run.mjs:11-28`.

The documentation citation gate validates both `path:line` references and explicit commit fields. Recognized commit IDs must be complete tokens, resolve unambiguously under the repository's Git object format, and name commits in `HEAD` history. A shallow checkout that cannot establish ancestry is an infrastructure failure, so both validation jobs fetch full history. Evidence: `scripts/check-doc-citations.mjs` and `.github/workflows/validate.yml`.

The record-collection eval exercises immutable evidence contracts on Ubuntu and Windows. Repositories with record collections require a complete checkout using `fetch-depth: 0` and `filter: ""`. A shallow or partial checkout is infrastructure failure, not evidence loss.

Both validation jobs run the context-audit eval, which pins the transcript parser and the `SessionEnd` receipt hook against a synthetic fixture on both hosts. Evidence: `evals/context-audit/run.mjs:1-13`.

Both validation jobs run the Atlas fixture eval and gate this repository's live Atlas with `atlas-check.mjs --gate`. Any stale live section blocks the job.

The v4 gate chain keeps responsibilities separate. The manifest gate owns domain and collection declarations. The records gate owns identities, authority batches, history, citation state, curation chains, and semantic projections. The link gate continues to own ordinary hub navigation.

`pending-admission` blocks when an immutable Git-index path lacks authority. Existing evidence failures take precedence. The vault standard advises adopters to run scheduled recovery on a unique branch in an isolated worktree. This repository does not ship that automation. Recovery automation must never merge its branch.

## Pull-request gates

Model-driven deep review and OpSec review run locally before a pull request. A local Codex
automation may run the same review and weekly judgment trend or floor-calibration work. The
local gate binds the base SHA, HEAD SHA, binary-diff digest, changed paths, reviewer identity,
strong-or-frontier tier, report digest, and hash-chained receipts. It rejects a dirty or
index-ambiguous worktree,
base movement, changed HEAD, changed diff, report drift, missing reviews, and non-PASS verdicts.
Evidence: `scripts/context-index-lib.mjs:67-79`, `scripts/local-review-gate.mjs:97-269`,
and `scripts/local-review-gate.mjs:357-450`.

`local-review-gate.mjs publish` can publish verified local receipts as commit statuses. Status
publication is optional. It does not make GitHub the review executor. Evidence:
`scripts/local-review-gate.mjs:274-344` and `scripts/local-review-gate.mjs:441-468`.

GitHub `validate` is the required hosted merge gate. It runs deterministic lint, rendering,
checks, and regression tests only. Branch protection should require its structural jobs. Any
consumer can still opt into the shipped GitHub review examples and manage their own credential,
permissions, and required-status policy.

## Delivery path

The canonical packages are rendered into host-specific distributions before delivery. CI checks drift rather than trusting a local hook. Evidence: `.github/workflows/validate.yml:39-45` and `AGENTS.md:108-117`.

Release changes must bump the canonical plugin version, the marketplace entry, and the plugin changelog. Evidence: `AGENTS.md:108-114`.

## Merge safety

Local review plans reject base movement, HEAD movement, binary-diff movement, report drift,
reviewer reuse, path aliases, dirty worktrees, and ambiguous Git index flags. Publication separately verifies both live
remote refs and the destination repository. Strict required statuses invalidate a merge
candidate after base movement. GitHub `validate` independently checks the submitted merge ref
with deterministic commands.

The project does not define an automatic production deployment. Its delivery artifact is a versioned, validated marketplace package.
