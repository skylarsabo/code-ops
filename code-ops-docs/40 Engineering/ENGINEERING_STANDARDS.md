---
type: reference
status: current
updated: 2026-08-24
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

The vendor manifest declares the runtime script set. Evidence: `scripts/vendored-manifest.mjs:13-33`.

## Agent orchestration

The lead owns scope, acceptance, and final verification. A worker report is evidence, not acceptance. Use independent review for high-impact findings. Evidence: `AGENTS.md:1-33`.

Use `RUN_CONTRACT.json` before a substantial multi-agent run. Bound the dispatch count, parallelism, retries, unit scope, and context budget. Evidence: `scripts/run-contract.mjs:10-24` and `scripts/run-contract.mjs:102-140`.

## Writing

All repository artifacts follow the house writing standard. It requires short active sentences, one term per concept, and cited evidence for factual claims. Evidence: `code-ops-docs/40 Engineering/Techniques/writing-standard.md:1-105`.

## Documentation and records

`<repo>-docs/` is the only authored documentation authority. Manifest v2 may govern immutable evidence at permanent historical paths. Adoption preserves those bytes and paths forever; supersession moves authority through curation and a canonical hub document.

Use Git-index paths for record identity. Classify every tracked collection file exactly once. Adopt only from clean complete history, and adopt before moving ordinary authored files. Never edit a generated baseline by hand.

Run `records check` for each registered collection. Use `verify-history --strict` before adoption and before diagnosing evidence loss. Use synthetic fixtures only in this repository.
