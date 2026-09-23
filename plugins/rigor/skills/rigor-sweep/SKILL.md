---
description: "Use when you want the whole rigor suite run end-to-end as a checkpointed pipeline. Start on the assess-only track. Intra-plugin orchestrator."
---

# Rigor sweep: the whole suite, end to end

**Invoked as `/rigor:rigor-sweep`.** Read §A, §B, §C, §G, §H, §1, §3, §4, §10, and §11 of
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows. Leave the rest of that file unread.

This skill orchestrates the other skills in sequence as one developer-in-the-loop pipeline.
It does not replace them. It carries the registers and a growing proof set forward, keeps a
master plan and a coverage map, and checks in at every phase boundary.

## Phase 0: scope the run  *(checkpoint)*

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs --artifact-dir <run folder>` first. A
FAIL stops the run before any fan-out, and an advisory is noted in the register. After
preflight passes, run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/repo-map.mjs --out <run folder>/REPO_MAP.md` and hand
its path to every operative brief (`§1`). On failure, note the advisory and proceed.

Dispatch the tracer subagent to detect the stack and its size. Its summary and `REPO_MAP.md`
feed Phase 1. Confirm the track and the scope. The `assess-only` track produces facts and
proven findings and changes no code. The `full` track also fixes, closes, and improves. A
custom subset is also allowed. Open a master todo list, a running `EXECUTIVE_SUMMARY.md`,
and a coverage map. Surface any CONFIRMED critical finding immediately.

Read a large file through its outline first:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs context skim <file>` prints the imports, symbols,
and line counts, so a brief can then read one range instead of the whole file.

## Runtime continuity when available

For a multi-phase resumable run with `code-ops-suite` installed, locate its scripts directory
as `<runtime scripts>` and compile a version 4 run contract. Declare the frontier lead,
lower-tier parallel work operatives, and independent validation for every work unit. Record observed host capabilities,
the exact context snapshot, verified unit bundles, and bounded runtime policy. Run
`node <runtime scripts>/run-contract.mjs check --root . --contract <contract>`, then initialize
the receipt chain once with `node <runtime scripts>/run-runtime.mjs init --root . --contract <contract>`.

At phase boundaries, reconcile the dispatch ledger and run
`node <runtime scripts>/run-runtime.mjs checkpoint --root . --contract <contract> --ledger <ledger>`.
Include acceptance, handoff, bundle, and artifact paths with their reference flags when present.
Partial acceptance is valid; blocking criteria require PASS only at finalization. On a new
session, read `run-runtime.mjs status` with root and contract first, then append resume before
continuing. Scope, context, or runtime drift requires the next contract revision, refreshed
affected bundles, and replan with the checkpoint reference flags.

Without the installed runtime or a version 4 contract, retain artifact checkpoints and handoff
verification. State that runtime verification is unavailable; never infer host capabilities.

## Phase 1: ground truth

Run **ground-truth**. The deterministic toolchain becomes the factual baseline and the
coverage and blind-spot map.

## Phase 2: trust the tests

Run **test-suite-audit**, which checks flakiness, assertion strength, and mutation kill
rate, so you know where green is real before you rely on it.

## Phase 3: find, read-only, with proofs

Run **bug-hunt**, deep and per subsystem, with its root cause and sibling sweep, and run
**quality-scan**. Both prove and disconfirm into `FINDINGS_REGISTER.md`. Use
**regression-hunt** to bisect any confirmed regression.

Before you fold a dispatched tracer's or verifier's output into the register, gate it on
shape. A tracer owes an evidence-cited trace or invariant map. A verifier owes a verdict
plus its proof receipt. Anything null, empty, or short of that shape counts as a failed
dispatch (`§1`). Mark it in `DISPATCH_LEDGER.md` (`§10`), then redispatch or defer it. Never
synthesize around it.

> **CHECKPOINT:** review the CONFIRMED-led register and decide what to fix.

## Phase 4: safety net

Run **safety-net** on the blind spots and on anything queued for change, so the next phase's
fixes and refactors are provably behavior-preserving.

## Phase 5: fix, which writes code and requires approval

Run **fix-verified** on the CONFIRMED bugs. Each one gets a failing-then-passing regression
test, a root-cause fix, a sibling sweep, the regression guard, and an enforcement.

> **CHECKPOINT:** confirm each batch.

## Phase 6: close inconsistencies

When code-ops-suite is installed, run its `normalize concept <name>` mode per concept.
Approve a canonical form per concept, migrate every site, and add the enforcement.

## Phase 7: improve, optional and as scoped

Run **improve-measured**. Only a change with a before-and-after metric ships.

## Done when

Every selected phase is complete and the test suite's trustworthiness is established.
CONFIRMED bugs are fixed at root cause, with regression proofs and their siblings handled.
Inconsistencies are closed and enforced, and improvements carry measured deltas. The
regression guard is green. The master `EXECUTIVE_SUMMARY.md` separates CONFIRMED from
PROBABLE and SPECULATIVE and states the coverage. Nothing code-changing happened without
your approval.
