---
type: reference
status: current
updated: 2026-09-03
---

# CI and Delivery

## Validation gate

The `validate` workflow runs for every pull request, pushes to `main`, a weekly schedule, and manual dispatch. It cancels an older run for the same Git ref. Evidence: `.github/workflows/validate.yml:1-27`.

The workflow has three jobs:

- `structural-lint` on `ubuntu-latest` runs package lint, generated-output drift checks, dependency checks, vault conformance, and the repository regression evals, including the long-horizon runtime eval. Evidence: `.github/workflows/validate.yml:29-245`.
- `host-evals-macos` on `macos-latest` runs structural lint and ten host-facing evals: skim, digest, the digest hook, context query, the query MCP server, the ladder card, context audit, the over-build garden, deferral harvest, and atlas check. A macOS minute costs ten Linux minutes, so the job runs on the weekly schedule and on manual dispatch only, never on a pull request. Evidence: `.github/workflows/validate.yml:244-267`.
- `structural-lint-windows` on `windows-latest` mirrors the Ubuntu checks so a path, quoting, or line-ending failure surfaces before merge rather than for a Windows contributor. It runs the long-horizon runtime eval too. Evidence: `.github/workflows/validate.yml:269-439`.

The documentation link gate rejects missing, escaping, case-unsafe, and ambiguous local targets. It rejects hub-internal directory links and unresolved local Markdown heading fragments. Evidence: `scripts/check-doc-links.mjs:76-89` and `evals/doc-links/run.mjs:11-28`.

The documentation citation gate validates both `path:line` references and explicit commit fields. Recognized commit IDs must be complete tokens, resolve unambiguously under the repository's Git object format, and name commits in `HEAD` history. A shallow checkout that cannot establish ancestry is an infrastructure failure, so both validation jobs fetch full history. Evidence: `scripts/check-doc-citations.mjs` and `.github/workflows/validate.yml`.

All three jobs run the context-audit eval, which pins the transcript parser and the `SessionEnd` receipt hook against a synthetic fixture on every host. Evidence: `.github/workflows/validate.yml:185`, `.github/workflows/validate.yml:264`, and `.github/workflows/validate.yml:312`.

The Ubuntu and Windows jobs run the Atlas fixture eval and gate this repository's live Atlas with `atlas-check.mjs check --gate`. Any stale live section blocks the job. Evidence: `.github/workflows/validate.yml:212-215` and `.github/workflows/validate.yml:433-436`.

## Windows record-collection gate

The record-collection eval exercises immutable evidence contracts. It runs on Ubuntu for every change. On Windows it dominates the leg, at about 754 seconds of a 960-second job against 73 seconds on Ubuntu, so a path gate decides whether it runs. Evidence: `.github/workflows/validate.yml:397-430`.

The Windows leg runs the eval when the range under test touched one of these inputs:

- `scripts/records.mjs`, `scripts/record-lib.mjs`, or `scripts/docs-manifest.mjs`
- `evals/record-collections`
- the generated record authority under `code-ops-docs/98 System/Records`
- the workflow lines that invoke the record eval

The documentation manifest is deliberately absent from that list, because it re-syncs on nearly every change and a manifest-only edit cannot alter record behavior. The weekly scheduled run runs the eval on Windows unconditionally. A manual dispatch does not, so an on-demand proof run for the macOS host evals costs no Windows record run. The gate removes about twelve minutes from an unrelated change's Windows leg.

Repositories with record collections require a complete checkout using `fetch-depth: 0` and `filter: ""`. A shallow or partial checkout is infrastructure failure, not evidence loss.

## Gate-chain boundaries

The v4 gate chain keeps responsibilities separate. The manifest gate owns domain and collection declarations. The records gate owns identities, authority batches, history, citation state, curation chains, and semantic projections. The link gate continues to own ordinary hub navigation.

`pending-admission` blocks when an immutable Git-index path lacks authority. Existing evidence failures take precedence. The vault standard advises adopters to run scheduled recovery on a unique branch in an isolated worktree. This repository does not ship that automation. Recovery automation must never merge its branch.

## Pull-request gates

Model-driven deep review and OpSec review run locally before a pull request, and only when the
operator opts in, for a high-risk surface or a delegated review. The deterministic chain and the
lead's own diff read cover every other change. A local automation may run the same review and
weekly judgment trend or floor-calibration work. The
local gate binds the base SHA, HEAD SHA, binary-diff digest, changed paths, reviewer identity,
strong-or-frontier tier, report digest, and hash-chained receipts. It rejects a dirty or
index-ambiguous worktree,
base movement, changed HEAD, changed diff, report drift, missing reviews, and non-PASS verdicts.
Evidence: `scripts/context-index-lib.mjs:67-79`, `scripts/local-review-gate.mjs:97-269`,
and `scripts/local-review-gate.mjs:357-450`.

`local-review-gate.mjs publish` can publish verified local receipts as commit statuses. Status
publication is optional. Branch protection on `main` must require only the deterministic
checks, because a required model-review status would block every change the operator chose not
to review. Publication does not make GitHub the review executor. Evidence:
`scripts/local-review-gate.mjs:274-344` and `scripts/local-review-gate.mjs:441-468`.

GitHub `validate` is the required hosted merge gate. It runs deterministic lint, rendering,
checks, and regression tests only. Branch protection should require its structural jobs. Any
consumer can still opt into the shipped GitHub review examples and manage their own credential,
permissions, and required-status policy.

## Delivery path

The canonical packages are rendered into host-specific distributions before delivery. CI checks drift rather than trusting a local hook. Evidence: `.github/workflows/validate.yml:39-45` and `AGENTS.md:94-101`.

A release change must bump the canonical plugin version, the marketplace entry, and the plugin changelog. Evidence: `AGENTS.md:94-96`.

## Merge safety

Local review plans reject base movement, HEAD movement, binary-diff movement, report drift,
reviewer reuse, path aliases, dirty worktrees, and ambiguous Git index flags. Publication separately verifies both live
remote refs and the destination repository. Strict required statuses invalidate a merge
candidate after base movement. GitHub `validate` independently checks the submitted merge ref
with deterministic commands.

The project does not define an automatic production deployment. Its delivery artifact is a versioned, validated marketplace package.
