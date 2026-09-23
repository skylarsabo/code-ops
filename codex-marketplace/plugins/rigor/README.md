# Rigor for Codex

> Generated in the code-ops repository (https://github.com/skylarsabo/code-ops) by `scripts/build-codex-marketplace.mjs` from the canonical Claude source. Do not edit this directory directly.

Verification-first workflows for finding real bugs, fixing them at root cause, and making measured improvements. Prove-it-or-don't-report-it: every finding carries an evidence tier and a proof artifact, and fixes ship a failing-then-passing regression test fixed at root cause. v2 adds test-suite validation (flaky + mutation testing), characterization safety nets, root-cause sibling sweeps, regression bisection, and a regression guard.

## Use

Name a workflow in Codex as `rigor:<skill>`. Every generated skill sets `policy.allow_implicit_invocation: true`, matching the Claude-side model-invocable policy.

## Skills

- `bug-hunt` — Use when you want REAL bugs found and proven, not a list of guesses. Each candidate is proven with a failing test. The flagship.
- `deep-review` — Use for pre-merge review of a PR or diff. bar verified (default) blocks only on CONFIRMED defects; bar standard reviews every lens; unproven items are advisory.
- `fix-verified` — Use when CONFIRMED bugs exist and you want them fixed at root cause with proof. Requires CONFIRMED findings as input.
- `ground-truth` — Use first, for the factual baseline before any analysis. Runs the real toolchain and captures ground truth plus a coverage and blind-spot map.
- `improve-measured` — Use for measured, behavior-preserving improvements, not speculative refactors. For profiling-led hot-path optimization, use code-ops-suite:performance.
- `quality-scan` — Use when you want high-signal, defect-causing quality issues with evidence and tiers, not cosmetic nits.
- `regression-hunt` — Use when something used to work and you need to pinpoint the commit that broke it and find related regressions in recent changes.
- `safety-net` — Use before refactoring or fixing low-coverage code. Writes characterization tests that lock current observable behavior.
- `test-suite-audit` — Use when you need to know whether a green suite actually catches faults. Validates the tests other proofs rest on.

## Packaging notes

- The complete workflow text and conventions are rendered from `plugins/rigor/` in the code-ops repository.
- Claude-specific GitHub Action examples are intentionally not bundled here.
- Root-level `agents/*.md` files are collaboration-subagent briefing templates. Their machine-readable minimum tiers are in `agents/model-floors.json`; the lead selects a supported runtime model before dispatch.

For source history and release notes, see the generated `CHANGELOG.md` and the repository root.
