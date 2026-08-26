---
type: reference
status: current
updated: 2026-08-25
---

# Engineering Standards

## Source of truth

Edit canonical source under `plugins/` and `scripts/`. Treat host projections as generated output. Run both renderers after a plugin change. Evidence: `scripts/build-opencode-dist.mjs:475-489` and `AGENTS.md:108-114`.

`CLAUDE.md` and `AGENTS.md` are one contract for hosts that read different filenames. Keep them byte-identical. Evidence: `AGENTS.md:72-77`.

## Required local gate

Before declaring a change complete, run the required local gate listed in `AGENTS.md`. That gate includes structural lint, dependency policy, and both generated-output drift checks. Evidence: `AGENTS.md:95-104`.

The structural lint validates package shape, documentation references, and generated contracts. The dependency guard rejects third-party module specifiers. Evidence: `scripts/lint-plugins.mjs:4-5`, `scripts/lint-plugins.mjs:796-813`, and `scripts/check-no-deps.mjs:24-28`.

Run the regression eval that owns any modified behavior. Fixtures that have an answer key require `node evals/score.mjs <ANSWER_KEY.json> --check`. Evidence: `AGENTS.md:95-104`.

## Change rules

- Keep changes small, readable, and behavior-preserving unless a confirmed defect requires a change.
- Do not weaken a gate, narrow a proof, or bypass a validation check to obtain green output.
- Keep vendored runtime scripts byte-identical to their canonical source through the vendor manifest.
- Add documentation and regression proof in the same change as a behavior change.

## Performance and simplicity

Treat latency, context size, and repeated process or file work as quality constraints. Profile before optimizing. Keep a change only when a repeatable benchmark shows a material improvement and the owning regression eval preserves behavior.

Use `node scripts/benchmark-command.mjs --runs 7 --warmup 1 -- <executable> [args ...]` for cross-platform wall-time evidence. Pass the executable interpreter explicitly for shell aliases or Windows command shims. Record the revision, runtime fingerprint, input state, cold or warm cache state, protocol, and median. Compare like with like; do not turn host-sensitive wall time into a universal CI threshold.

Extract shared work when it removes measured duplication or closes behavioral drift. Keep public flow legible and reject abstractions that only move complexity. Performance work never weakens a quality gate, removes an eval case, or broadens agent context to save orchestration time.

The vendor manifest declares the runtime script set. Evidence: `scripts/vendored-manifest.mjs:13-33`.

## Agent orchestration

The lead owns scope, acceptance, and final verification. A worker report is evidence, not acceptance. Use independent review for high-impact findings. Evidence: `AGENTS.md:1-33`.

Use `RUN_CONTRACT.json` before a substantial multi-agent run. Bound the dispatch count, parallelism, retries, unit scope, and context budget. Evidence: `scripts/run-contract.mjs:10-24` and `scripts/run-contract.mjs:102-140`.

## Writing

All repository artifacts follow the house writing standard. It requires short active sentences, one term per concept, and cited evidence for factual claims. Evidence: `code-ops-docs/40 Engineering/Techniques/writing-standard.md:1-105`.

## Documentation and records

`<repo>-docs/` is the only authored documentation authority. Manifest v2 may govern immutable evidence at permanent historical paths. Adoption preserves those bytes and paths forever; supersession moves authority through curation and a canonical hub document.

Use Git-index paths for record identity. Classify every tracked collection file exactly once. Scope v2 exact paths may override broad globs; ambiguous owners still fail. Adopt only from clean complete history, and adopt before moving ordinary authored files. Never edit a generated baseline by hand.

Run `plan-adoption` before irreversible legacy adoption. Review every historically revised immutable candidate. Commit no generated baseline unless `adopt` accepts a current digest-bound receipt.

Run `records check` for each registered collection. Use `verify-history --strict` before adoption and before diagnosing evidence loss. Use synthetic fixtures only in this repository.
