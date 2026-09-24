---
type: reference
status: current
updated: 2026-09-23
---

# Engineering Standards

## Source of truth

Edit canonical source under `plugins/` and `scripts/`. Treat host projections as generated output. Run both renderers after a plugin change. Evidence: `scripts/build-opencode-dist.mjs:476-489` and `AGENTS.md:97-104`.

`AGENTS.md` holds the only copy of the repository contract, and `CLAUDE.md` is the single import line `@AGENTS.md`. Edit `AGENTS.md` only; lint fails closed on any other `CLAUDE.md` content. Evidence: `AGENTS.md:43-51`.

## Required local gate

Before declaring a change complete, run the required local gate listed in `AGENTS.md`. That gate includes structural lint, dependency policy, and both generated-output drift checks. Evidence: `AGENTS.md:86-89`.

The structural lint validates package shape, changelog entries, documentation references, and generated contracts. The dependency guard rejects third-party module specifiers. Evidence: `scripts/lint-plugins.mjs:4-5`, `scripts/lint-plugins.mjs:10-28`, and `scripts/check-no-deps.mjs:24-28`.

Scripts share one exit-code contract: 0 means pass, 1 means a check failed, and 2 means a usage error. `die` in `scripts/cli-lib.mjs` exits 1 by default, and `usage` exits 2 by default. `parseOrDie` sends a bad flag through `usage`, so a caller error never exits 1. A script that needs another code documents that code in its own header. Evidence: `scripts/cli-lib.mjs:115-118`, `scripts/cli-lib.mjs:125-128`, and `scripts/cli-lib.mjs:138-143`.

Run the regression eval that owns any modified behavior. Fixtures that have an answer key require `node evals/score.mjs <ANSWER_KEY.json> --check`. Evidence: `AGENTS.md:88-89`.

A verifier or mechanical operative runs the gate chain and returns the verdict plus the failing excerpt. The lead re-runs a gate itself only to settle a disputed outcome. Evidence: `AGENTS.md:91-93`.

## Change rules

- Keep changes small, readable, and behavior-preserving unless a confirmed defect requires a change.
- Do not weaken a gate, narrow a proof, or bypass a validation check to obtain green output.
- Keep vendored runtime scripts byte-identical to their canonical source through the vendor manifest.
- Add documentation and regression proof in the same change as a behavior change.

## Performance and simplicity

Treat latency, context size, and repeated process or file work as quality constraints. Profile before optimizing. Keep a change only when a repeatable benchmark shows a material improvement and the owning regression eval preserves behavior.

Use `node scripts/benchmark-command.mjs --runs 7 --warmup 1 -- <executable> [args ...]` for cross-platform wall-time evidence. Pass the executable interpreter explicitly for shell aliases or Windows command shims. Record the revision, runtime fingerprint, input state, cold or warm cache state, protocol, and median. Compare like with like. Never turn host-sensitive wall time into a universal CI threshold.

Extract shared work when it removes measured duplication or closes behavioral drift. Keep public flow legible and reject abstractions that only move complexity. Performance work never weakens a quality gate, removes an eval case, or broadens agent context to save orchestration time.

The vendor manifest declares the runtime script set. Evidence: `scripts/vendored-manifest.mjs:13-33`.

The [code standard](Techniques/code-standard.md) owns the general rule: efficient by design, optimized only by measurement.

## Size discipline

The objective is ordered. Correctness and the safety floor come first, then module boundaries, then measured performance on hot paths, then readability, then size. Fewer lines decides only between candidates that tie on the first four. Evidence: `plugins/code-ops-suite/CONVENTIONS.md:148`.

Climb the ladder before writing code. Ask whether the code needs to exist, whether it exists here already, whether the standard library or an installed dependency does it, and whether it fits inside the owning module. Extract only on evidence: a second caller, a unit that needs its own test, or a file past the repository's own size norm. Mark a deliberate simplification with a `deferred(<ceiling>, <upgrade path>)` comment.

`node scripts/scan-overbuild.mjs --git <range>` is the mechanical floor under the ladder. It reports eight deterministic tells on a diff and exits non-zero only on an unrecorded dependency. `node scripts/harvest-deferrals.mjs` collects the `deferred(...)` markers into `DEFERRALS_REGISTER.md`, and `--check` reports drift. Both are reachable as `node scripts/co.mjs scan overbuild` and `node scripts/co.mjs scan deferrals`. Evidence: `scripts/scan-overbuild.mjs:1-40` and `scripts/harvest-deferrals.mjs:1-30`.

The [code standard](Techniques/code-standard.md) indexes these size rules with the rest of the code rules and their backstops.

## Context economy

Four context mechanisms ship with the suite and run where the host exposes their event
contracts. The digest and index have ports on all four hosts. Claude and Codex also support the
ladder card and session receipt. Installed Grok 1.0.13 supports the receipt but carries the
ladder through instruction files. OpenCode has no ladder or transcript-receipt callback.
Evidence: `plugins/code-ops-suite/hooks/hooks.json` and
`code-ops-docs/50 Platform/INFRASTRUCTURE.md`.

Read a file's outline with `node scripts/skim.mjs <file>` before reading its body, then read a range. Reach every domain through the `node scripts/co.mjs <domain> <verb>` entrypoint when a skill names one.

Each switch is `CODE_OPS_DIGEST`, `CODE_OPS_INDEX`, `CODE_OPS_LADDER_CARD`, or
`CODE_OPS_RECEIPTS`, and each holds `off`, `0`, or `false` in the canonical environment.
Rendered hosts use their documented process environment. [Infrastructure](../50 Platform/INFRASTRUCTURE.md)
owns the switches and their defaults. [Measurements](../55 Operations/MEASUREMENTS.md) owns
the host-qualified arms and decision rules.

## Agent orchestration

The lead owns scope, acceptance, and final verification. A worker report is evidence, not acceptance. Use independent review for high-impact findings. Evidence: `AGENTS.md:35-41`.

Route every judgment-bearing dispatch at the strong tier, whatever tier the lead runs at. Drop a tier only for mechanical, low-ambiguity work, and never below an agent's lint-enforced floor. Effort routes by ambiguity, never low on review and never at the highest setting on a breadth sweep. Evidence: `AGENTS.md:35-41`. The routing table is [Subagent trade-offs](Techniques/subagent-trade-offs.md).

Use `RUN_CONTRACT.json` before a substantial multi-agent run. Bound the dispatch count, parallelism, retries, unit scope, and context budget. Evidence: `scripts/run-contract.mjs:10-24` and `scripts/run-contract.mjs:102-140`.

## Writing

All repository artifacts follow the house writing standard. It requires short active sentences, one term per concept, and cited evidence for factual claims. Evidence: `code-ops-docs/40 Engineering/Techniques/writing-standard.md:1-105`.

## Documentation and records

`<repo>-docs/` is the only authored documentation authority. Manifest v2 may govern immutable evidence at permanent historical paths. Adoption preserves those bytes and paths forever. Supersession moves authority through curation and a canonical hub document.

Use Git-index paths and stage-0 blob bytes for record identity and content authority. Classify every tracked collection file exactly once. Scope v2 exact tracked paths outrank glob selectors. Ambiguous owners still fail.

Collections remain open, but each admission is irreversible. Use reviewed incremental admission for committed immutable paths. Use native append for new staged authority with no reachable history. Never move admitted evidence for archival.

Keep the authority-batch chain separate from the curation ledger. Every immutable object needs exact-once batch coverage. Never edit generated authority by hand.

Run `plan-adoption` before genesis adoption. Use `plan-adoption --incremental` for committed late arrivals. Review every historically revised immutable candidate. Commit no generated authority unless `adopt` accepts a current digest-bound receipt.

Run `records check` for each registered collection. Use `verify-history --strict` before adoption and before diagnosing evidence loss. Use synthetic fixtures only in this repository.
