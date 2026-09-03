# rigor

Verification-first workflows for finding real bugs, closing inconsistencies, and making
measured improvements. This repository authors the package for Claude Code and renders it
into a native Codex package. Invoke `/rigor:<name>` in Claude Code, or name `rigor:<name>`
in Codex.

One rule governs the plugin: prove it or do not report it, measure it or do not claim it,
close it so it cannot come back. Broad audits disappoint because they assert findings,
sample instead of cover, and inflate confidence. Rigor trades some breadth and some speed
for signal and proof.

New to the suite? Read the handbook at `code-ops-docs/40 Engineering/Handbook/` from the
repository root.

## What raises the quality

- **Evidence tiers and triangulation.** `CONFIRMED` means reproduced. `PROBABLE` needs two
  independent static evidence lines. `SPECULATIVE` is one lead. Only a CONFIRMED finding
  drives a fix, and tier inflation is the cardinal sin.
- **A mandatory disconfirmation pass.** Before it reports a finding, the agent tries to
  kill it. Is the code reachable? Is the case handled elsewhere? Is the behavior
  intentional? Is it already tested? The pass is the main defense against false positives.
- **Ground truth first.** The real toolchain runs before any analysis: build or typecheck,
  lint, tests with coverage, and static analysis. Its output is fact, and model findings
  reconcile against it.
- **Proof artifacts instead of assertions.** A CONFIRMED bug ships a runnable repro. A fix
  ships a regression test that fails before and passes after. An improvement shows a
  before-and-after measurement.
- **Closure with enforcement.** An inconsistency gets one canonical form, every site
  migrated, and a lint rule or test, so the divergence cannot return unnoticed.

### Version 2 additions

- **Test-suite validation** through `test-suite-audit`. It detects flaky tests, weak
  assertions, and, through mutation testing, the places where a passing test catches no
  fault. High coverage with a low kill rate is the dangerous combination. A proof is only
  as strong as the suite under it (`CONVENTIONS §F`).
- **Characterization safety nets** through `safety-net`. It locks current observable
  behavior on blind spots and on code queued for change, before anything is touched, so a
  refactor or a fix is provably behavior-preserving.
- **Root cause over symptom** (`§G`). Every confirmed bug is traced to its root cause, and
  the codebase is swept for siblings, meaning other instances of the same cause. Fix the
  class, not the instance.
- **Regression bisection** through `regression-hunt`. It bisects a confirmed bug through
  version-control history to the commit that introduced it, then hunts regressions across
  recent changes.
- **A regression guard** (`§H`). A growing proof set re-runs after every change. A fix that
  breaks any prior proof is rejected, and a proof is never weakened to make it pass.

## Skills

Invoke a skill with `/rigor:<name>` in Claude Code, or name `rigor:<name>` in Codex. The
model can also route to one through the standard-operating-mode routing card.

- `ground-truth`. Run the toolchain and capture the factual baseline plus a coverage and
  blind-spot map. Run it first.
- `test-suite-audit`. Validate the tests the proofs rest on for flakiness, assertion
  strength, and mutation kill rate, then harden the gaps.
- `safety-net`. Write characterization tests that pin current behavior on blind spots and
  on code queued for change.
- `bug-hunt`. Derive invariants, trace flow, prove each candidate, then find the root cause
  and sweep for siblings. The flagship skill.
- `regression-hunt`. Bisect a bug to its origin commit and hunt regressions in recent
  changes.
- `quality-scan`. Report high-signal, defect-causing quality issues with evidence, a tier,
  and an impact. No cosmetics.
- `consistency-closure`. Pick a canonical form, migrate every site, and add an enforcement.
- `improve-measured`. Ship improvements that carry a baseline, a result, and a delta.
  Behavior-preserving, with no speculative refactors.
- `fix-verified`. Fix CONFIRMED bugs at root cause with a failing-then-passing regression
  test, the regression guard, a sibling sweep, and an enforcement.
- `deep-review`. Review a pull request or diff at the verification bar, blocking only on a
  CONFIRMED defect or regression.
- `rigor-sweep`. The orchestrator. It runs ground-truth, then test-suite-audit, then
  bug-hunt with quality-scan, then safety-net, then, on approval, fix-verified,
  consistency-closure, and measured improvements.

## The methodology

`CONVENTIONS.md`, bundled at the plugin root, carries the operating model every skill
reads first:

- the core principle (`§0`)
- evidence tiers and triangulation (`§A`)
- the disconfirmation pass (`§B`)
- ground truth first (`§C`)
- reachability (`§D`)
- test-suite trust (`§F`)
- root cause over symptom (`§G`)
- the regression guard (`§H`)
- the defect-oriented lenses (`§7`)
- the fix-prove-guard loop (`§8`)
- consistency closure (`§9`)

## Subagents

- `tracer`. Read-only. It traces a control or data path end to end, or derives invariants.
  It never edits and never executes.
- `verifier`. It writes and runs a minimal repro, test, or benchmark to confirm or kill a
  candidate. It never edits the source under evaluation. This subagent is what makes
  `CONFIRMED` mean something.

## Running it

- **The whole pipeline:** `/rigor:rigor-sweep`. Start on the `assess-only` track to get
  proven findings before anything changes.
- **Bugs only:** `/rigor:ground-truth`, then `/rigor:bug-hunt` on the riskiest subsystem.
- **On every pull request:** wire `deep-review` into CI with the Claude Code action pinned
  to a reviewed commit. See `examples/github-deep-review.yml`.

## Context economy

Every operative brief in this plugin reads files, and a large file read whole is the
single largest avoidable cost in a run. Two bundled scripts cut it:

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs context skim <file>` prints a file's outline,
  meaning its imports, symbols, and line counts, so a brief can then read one range instead
  of the whole file.
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs <domain> <verb>` is the one entrypoint over
  every bundled script. `register revalidate`, `run preflight`, `context map`, and
  `check proofs` reach the scripts this plugin's skills already name by path. Both spellings
  work.

The suite ships further context mechanisms, on by default, in `code-ops-suite`: a
`PreToolUse` output digest, a `SubagentStart` ladder card, and a symbol index refreshed by a
`PostToolUse` hook. Each is turned off with `off`, `0`, or `false` in the `env` block of a
`.claude/settings.json`. `code-ops-docs/50 Platform/INFRASTRUCTURE.md` owns those switches,
and `code-ops-docs/55 Operations/MEASUREMENTS.md` owns what they measure.

## Notes

- The skills work on any stack. They detect the tooling themselves and match the
  repository's own conventions.
- Skills never emit secrets or personal data. Analysis redacts them.
- The plugin is part of the code-ops marketplace, beside `code-ops-suite` for breadth and
  `privacy-opsec-suite` for anonymity. Reach for `rigor` when you want proven bugs and
  enforced quality instead of a long list.
