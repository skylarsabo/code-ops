---
name: local-review-gate
description: "Use when deep review, OpSec review, or judgment evals should run locally before a PR, with exact-SHA receipts and optional GitHub status publication."
---

# Local Review Gate — Review Before the PR Exists

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:local-review-gate`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin — operating model (`§1`), evidence and refutation (`§7`), artifact safety (`§9`), quality lenses (`§10`), and run ledgers (`§12`) govern this skill.

**Mode:** REVIEW. **Consumes:** one clean, committed feature branch and its target base. **Produces:** two ignored review reports, a SHA-bound plan, a hash-chained receipt set, and optional GitHub commit statuses. **Requires** `rigor:deep-review` and `privacy-opsec-suite:opsec-pr-gate` for the PR track. The judgment-eval track instead consumes `evals/judgment-matrix.json` and dispatches the plan's read-only units.

## Track A — pre-PR gate

### Phase 0 — deterministic floor

Run the repository's deterministic preflight, lint, build, and focused tests first. Commit every intended source and documentation change. A dirty worktree, empty diff, detached/default branch, unresolved base, or base that is not an ancestor stops the gate.

Create an ignored run folder keyed by the current short HEAD. Then prepare the immutable review boundary:

```bash
node <plugin-root>/scripts/local-review-gate.mjs prepare \
  --root <repo> --base <target-ref> \
  --out <ignored-run-folder>/plan.json \
  --receipts <ignored-run-folder>/receipts.jsonl
```

The plan binds the branch, current base SHA, HEAD SHA, binary full-index diff digest, changed-path set, and required gate names. Any later commit or base movement requires a new plan and new reports.

### Phase 1 — local judgment

Dispatch two independent strong-tier, high-effort reviewers against the exact plan. Give them distinct reviewer IDs; the receipt replay rejects one identity claiming both gates.

1. `rigor:deep-review` traces changed behavior, attempts reproduction, and blocks only on `CONFIRMED` defects or regressions after refutation.
2. `privacy-opsec-suite:opsec-pr-gate` checks only new leak, egress, identifier, fingerprint, correlation, or weakened-default risk.

Each reviewer writes one dense Markdown report in the ignored run folder. The report names the reviewed base and HEAD, verdict, confirmed count, blocking count, evidence, disconfirmation, skipped areas, and reviewer role/model. Empty output, unavailable reviewer, malformed evidence, timeout, or an unresolved blocking finding is `FAIL`.

The lead reads both reports and independently accepts their counts. Record each result; a `PASS` with a nonzero blocking count is refused:

```bash
node <plugin-root>/scripts/local-review-gate.mjs record \
  --root <repo> --plan <plan> --gate <gate> --verdict <PASS|FAIL> \
  --report <report> --reviewer <role@model> --tier strong --effort high \
  --blocking <n> --confirmed <n>
```

Fixes create a new commit and invalidate the whole review. Preserve the old receipts as failed historical evidence, prepare a new HEAD-keyed folder, and rerun both gates.

### Phase 2 — prove and publish

Run `local-review-gate.mjs check` before any push. It re-resolves the base and HEAD, re-hashes the diff and reports, replays the receipt chain, and requires exact `PASS` coverage for both gates. Review plans, receipt chains, and reports must be distinct regular files with no symbolic-link components or physical aliases.

Run the traceless publication gate. Push the feature branch without opening a PR, then publish the already-verified contexts:

```bash
node <plugin-root>/scripts/local-review-gate.mjs publish \
  --root <repo> --plan <plan> --repo <owner/name>
```

The publisher reads the remote directly without mutating tracking refs. It requires the live base ref to equal the planned base SHA and the live feature ref to equal the reviewed HEAD. It derives the GitHub repository from that same remote and rejects a mismatched `--repo` override before posting `local-deep-review` and `local-opsec-gate`. Protect the target branch with strict required-status checks so later base movement invalidates the merge candidate. Open the PR only after publication; hosted CI remains responsible for deterministic checks. Never auto-merge.

## Track B — local judgment evals

Compile a provider-neutral plan from the one tracked fixture matrix:

```bash
node <plugin-root>/scripts/judgment-evals.mjs plan \
  --root <repo> --mode <trend|floor> --execution <available|unavailable> \
  --out <ignored-run-folder>/plan.json \
  --strong-model <stable-model-id> [--weak-model <stable-model-id>]
```

Keep the full plan lead-only because its matrix binding contains answer-key paths. Dispatch only each plan unit, which intentionally omits the answer key. Every worker stays read-only on the target. Skill-arm units read their listed skill documents and plugin conventions; control units receive neither. Each writes only its declared `findingsPath` as a JSON array of `{file,line,note,tier}`. Set `--execution available` when workers can run commands or repros and `unavailable` only when the host mechanically withholds execution; the score receipt preserves that capability boundary. Model IDs and execution policy stay fixed within a series. The floor planner refuses identical normalized strong and weak model IDs.

After every unit returns, run `judgment-evals.mjs score`, then `judgment-evals.mjs check-receipt`. They refuse HEAD, fixture, key, skill, candidate, or score drift; replay the deterministic scorer; and verify one digest-bound local result receipt. Trend and floor results inform the calibration store but never become PR merge checks.

## Done when

For Track A, deterministic local checks pass, both strong/high local reviews cover the exact committed diff, the receipt chain verifies, the exact remote SHA carries both local success contexts, and only then is the PR opened. For Track B, every planned unit produced a valid read-only result and the score receipt binds all model, fixture, skill, candidate, and scorer evidence. Nothing auto-merges.
