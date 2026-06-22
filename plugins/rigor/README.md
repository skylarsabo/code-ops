# rigor

Verification-first workflows for **finding real bugs, closing inconsistencies, and making measured improvements** — packaged as a Claude Code plugin. Each workflow is a namespaced skill (`/rigor:<name>`).

Built on one rule: **prove it or don't report it; measure it or don't claim it; close it so it can't come back.** This is the deliberate answer to why fire-hose audits disappoint — they *assert* findings, *sample* instead of cover, and *inflate* confidence. Rigor trades some breadth and speed for signal and proof.

## What makes it higher-quality

- **Evidence tiers + triangulation** — `CONFIRMED` (reproduced) / `PROBABLE` (≥2 independent static evidence lines) / `SPECULATIVE` (a lead). Only CONFIRMED drives fixes; tier inflation is the cardinal sin.
- **Mandatory disconfirmation pass** — before reporting, the agent tries to *kill* each finding (reachable? handled elsewhere? intentional? already tested?). The primary defense against false positives.
- **Ground truth first** — the real toolchain (build/typecheck, lint, tests + coverage, static analysis) is run and treated as fact; model findings reconcile against it.
- **Proof artifacts, not assertions** — CONFIRMED bugs ship a runnable repro; fixes ship a regression test that **fails before and passes after**; improvements show a **before/after measurement**.
- **Closure with enforcement** — inconsistencies get one canonical form, every site migrated, and a lint rule / test so the divergence **can't silently return**.

### New in v2 — trust the foundation, fix the class

- **Test-suite validation** (`test-suite-audit`) — detects flaky/nondeterministic tests, weak assertions, and (via **mutation testing**) where "passing" tests catch no faults. *High coverage + low kill rate = the danger zone.* Proofs are only as strong as the suite under them (`CONVENTIONS §F`).
- **Characterization safety nets** (`safety-net`) — locks current observable behavior on blind spots and to-be-changed code *before* anything is touched, so refactors/fixes are provably behavior-preserving.
- **Root cause over symptom** (`§G`) — every confirmed bug is traced to its root cause and the codebase **swept for siblings** (other instances of the same cause); fix the class, not the instance.
- **Regression bisection** (`regression-hunt`) — VCS-bisects a confirmed bug to the commit that introduced it and hunts regressions across recent changes.
- **Regression guard** (`§H`) — a growing proof set re-runs after every change; a fix that breaks any prior proof is rejected, and proofs are never weakened to pass.

## Skills

Invoke with `/rigor:<name>` (all manual-invoke).

- `ground-truth` — run the toolchain; capture the factual baseline + coverage/blind-spot map. **Run first.**
- `test-suite-audit` — validate the tests the proofs rest on (flaky, assertion strength, mutation kill-rate); harden the gaps.
- `safety-net` — characterization tests that pin current behavior on blind spots / to-be-changed code.
- `bug-hunt` — derive invariants, trace flow, **prove** each candidate, then root-cause + sibling sweep. The flagship.
- `regression-hunt` — bisect a bug to its origin commit; hunt regressions in recent changes.
- `quality-scan` — high-signal, defect-causing quality issues with evidence, tier, and impact. No cosmetics.
- `consistency-closure` — pick a canonical form, migrate every site, add an enforcement.
- `improve-measured` — improvements with a baseline → result → delta; behavior-preserving; no speculative refactors.
- `fix-verified` — fix CONFIRMED bugs at root cause; failing→passing regression test, regression guard, sibling sweep, enforcement.
- `deep-review` — review a PR/diff at the verification bar; block only on CONFIRMED defects/regressions.
- `rigor-sweep` — orchestrator: ground-truth → test-suite-audit → bug-hunt + quality-scan → safety-net → (approval) fix-verified → consistency-closure → measured improvements.

## The methodology
`CONVENTIONS.md` (bundled at the plugin root) is the heart of this plugin: the core principle (§0), evidence tiers + triangulation (§A), disconfirmation (§B), ground-truth-first (§C), reachability (§D), test-suite trust (§F), root-cause-over-symptom (§G), the regression guard (§H), the defect-oriented lenses (§7), the fix–prove–guard loop (§8), and consistency-closure (§9). Every skill reads it first.

## Subagents
- `tracer` — read-only; traces a control/data path end-to-end or derives invariants. Never edits/executes.
- `verifier` — writes and runs a minimal repro/test/benchmark to **confirm or kill** a candidate (and runs mutation/flaky checks). Never edits the source under evaluation. This agent is why `CONFIRMED` means something.

## Running it
- **Whole pipeline:** `/rigor:rigor-sweep` (start with `assess-only` to get proven findings before changing anything).
- **Just hunt bugs:** `/rigor:ground-truth` → `/rigor:bug-hunt` on your riskiest subsystem.
- **On every PR:** wire `deep-review` into CI with `anthropics/claude-code-action@v1` — see `examples/github-deep-review.yml`.

## How to get the most out of it
- Run `ground-truth` then `test-suite-audit` first — the rest is only as trustworthy as the tests under it, and you want to know where "green" is real.
- Go **deep, not wide**: point `bug-hunt` at one subsystem at a time.
- Run `safety-net` before any refactor/fix in low-coverage areas so "behavior-preserving" is provable.
- Treat `assess-only` output as triage you vet, then let `fix-verified` act only on CONFIRMED items you've blessed.
- It complements deterministic tools (SAST, fuzzers, dependency scanners) — the honest win is signal-to-noise and proof, not magic completeness.

## Notes
- Works on any stack; skills self-detect tooling and match the repo's conventions.
- Skills never emit secrets/PII; analysis redacts.
- Part of the **code-ops** marketplace alongside `code-ops-suite` (breadth) and `privacy-opsec-suite` (anonymity). Reach for `rigor` when you want **proven** bugs and enforced quality, not a long list.
