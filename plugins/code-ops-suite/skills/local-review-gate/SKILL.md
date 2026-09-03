---
description: "Use when deep review, OpSec review, or judgment evals should run locally before a PR, with exact-SHA receipts and optional GitHub status publication."
---

# Local review gate: review before the PR exists

**Invoked as `/code-ops-suite:local-review-gate`.** First read the
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin. Five sections govern this skill:
the operating model (`§1`), evidence and refutation (`§7`), artifact safety (`§9`), the quality
lenses (`§10`), and the run ledgers (`§12`).

**Mode:** REVIEW. **Consumes:** one clean, committed feature branch and its target base.
**Produces:** two ignored review reports, a SHA-bound plan, a hash-chained receipt set, and
optional GitHub commit statuses. **Requires** `rigor:deep-review` and
`privacy-opsec-suite:opsec-pr-gate` for the PR track. The judgment-eval track instead consumes
`evals/judgment-matrix.json` and dispatches the plan's read-only units.

**Opt-in only.** This skill spends two strong-tier reviewer runs per head, and a fix costs both
again. It never runs by default from another skill, and never on the lead's own judgment. It runs
when the operator asks for it, when a brief names it, or when `ship` recorded a yes at its Phase
0 checkpoint for a high-risk surface. The first act of Track A is a checkpoint that restates the
base, the head, the changed-path count, and which gates will run. Both gates run by default, and
the operator may name one. The checkpoint waits for a yes.

## Track A, Phase 0: the deterministic floor

Run the repository's deterministic preflight, lint, build, and focused tests first. Commit every
intended source and documentation change. The gate stops on any of these: a dirty worktree, an
ambiguous `assume-unchanged` or `skip-worktree` index flag, an empty diff, a detached or default
branch, an unresolved base, or a base that is not an ancestor.

Create an ignored run folder keyed by the current short HEAD. Then prepare the immutable review
boundary:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/local-review-gate.mjs prepare \
  --root <repo> --base <target-ref> \
  --out <ignored-run-folder>/plan.json \
  --receipts <ignored-run-folder>/receipts.jsonl
```

The plan binds the branch, the current base SHA, the HEAD SHA, the binary full-index diff digest,
the changed-path set, and the required gate names. Any later commit or base movement requires a
new plan and new reports.

## Track A, Phase 1: the local judgment

Dispatch two independent strong-tier, high-effort reviewers against the exact plan. Give them
distinct reviewer IDs, because the receipt replay rejects one identity claiming both gates.

1. `rigor:deep-review` traces the changed behavior, attempts reproduction, and blocks only on `CONFIRMED` defects or regressions after refutation.
2. `privacy-opsec-suite:opsec-pr-gate` checks only new leak, egress, identifier, fingerprint, correlation, or weakened-default risk.

Each reviewer writes one dense Markdown report in the ignored run folder. The report names the
reviewed base and HEAD, the verdict, the confirmed count, the blocking count, the evidence, the
disconfirmation, the skipped areas, and the reviewer's role and model. Empty output, an
unavailable reviewer, malformed evidence, a timeout, or an unresolved blocking finding is `FAIL`.

The lead reads both reports and independently accepts their counts. Record each result. A `PASS`
with a nonzero blocking count is refused:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/local-review-gate.mjs record \
  --root <repo> --plan <plan> --gate <gate> --verdict <PASS|FAIL> \
  --report <report> --reviewer <role@model> --tier strong --effort high \
  --blocking <n> --confirmed <n>
```

Fixes create a new commit and invalidate the whole review. Preserve the old receipts as failed
historical evidence, prepare a new HEAD-keyed folder, and rerun both gates.

## Track A, Phase 2: the proof and the publication

Run `local-review-gate.mjs check` before any push. It re-resolves the base and HEAD, re-hashes
the diff and the reports, replays the receipt chain, and requires exact `PASS` coverage for both
gates. Review plans, receipt chains, and reports must be distinct regular files with no symbolic
link components and no physical aliases.

Run the traceless publication gate. Push the feature branch without opening a PR, then publish
the already-verified contexts:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/local-review-gate.mjs publish \
  --root <repo> --plan <plan> --repo <owner/name>
```

The publisher reads the remote directly without mutating tracking refs. It requires the live base
ref to equal the planned base SHA, and the live feature ref to equal the reviewed HEAD. It
derives the GitHub repository from that same remote, and rejects a mismatched `--repo` override
before posting `local-deep-review` and `local-opsec-gate`. Protect the target branch with strict
required-status checks, so later base movement invalidates the merge candidate. Open the PR only
after publication. Hosted CI remains responsible for the deterministic checks. Never auto-merge.

## Track B: the local judgment evals

Compile a provider-neutral plan from the one tracked fixture matrix:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/judgment-evals.mjs plan \
  --root <repo> --mode <trend|floor> --execution <available|unavailable> \
  --out <ignored-run-folder>/plan.json \
  --strong-model <stable-model-id> [--weak-model <stable-model-id>]
```

Keep the full plan lead-only, because its matrix binding contains answer-key paths. Dispatch only
each plan unit, which intentionally omits the answer key. Every worker stays read-only on the
target. Skill-arm units read their listed skill documents and plugin conventions, and control
units receive neither. Each unit writes only its declared `findingsPath`, as a JSON array of
`{file,line,note,tier}`.

Planning and replay reject ambiguous Git index flags before workers read fixture paths. Plans,
findings, and score receipts must use ignored paths, without linked components and without
portable aliases to tracked Git paths. The scorer rejects a portable or physical output alias
before writing. Set `--execution available` when workers can run commands or repros, and
`unavailable` only when the host mechanically withholds execution. The score receipt preserves
that capability boundary. Model IDs and execution policy stay fixed within a series. The floor
planner refuses identical normalized strong and weak model IDs.

After every unit returns, run `judgment-evals.mjs score`, then `judgment-evals.mjs check-receipt`.
They refuse HEAD, fixture, key, skill, candidate, or score drift. They replay the deterministic
scorer, and verify one digest-bound local result receipt. Trend and floor results inform the
calibration store, and never become PR merge checks.

## Done when

For Track A:
- The deterministic local checks pass.
- Both strong-tier, high-effort local reviews cover the exact committed diff.
- The receipt chain verifies, and the exact remote SHA carries both local success contexts.
- Only then is the PR opened.

For Track B:
- Every planned unit produced a valid read-only result.
- The score receipt binds all model, fixture, skill, candidate, and scorer evidence.

In both tracks, nothing auto-merges.
