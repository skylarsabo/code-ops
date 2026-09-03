---
description: "Use when you want the whole privacy-opsec-suite run end-to-end as a guided, checkpointed pipeline. Intra-plugin orchestrator."
---

# Full sweep: the whole privacy and opsec suite, end to end

**Invoked as `/privacy-opsec-suite:full-sweep`.** First read the bundled
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`, and section A above all, which carries the central
anonymity and OpSec model every phase enforces.

This skill orchestrates the other skills in sequence as one developer-in-the-loop pipeline.
It runs them in order, carries `LEAK_REGISTER.md` forward, keeps a master plan, and checks
in with you at every phase boundary. The stance is defensive: protect the system's own users
and find and fix the leaks in your own code.

## Phase 0: scope the run  *(checkpoint)*

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs --artifact-dir <run folder>` first. A
FAIL stops the run before any fan-out, and an advisory is noted in the register. After
preflight passes, run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/repo-map.mjs --out <run folder>/REPO_MAP.md`. On
failure, note the advisory and proceed.

Dispatch the explorer subagent to detect the stack and the size of the repository, and hand
its summary plus `REPO_MAP.md` to the next phase. Then confirm with me:

- **Track.** `audit-only` reads and documents and changes no code. `full` runs the audits,
  then hardening, then documentation and gate. A custom subset is also allowed.
- **Scope**, the adversaries to emphasize (`CONVENTIONS §A`), the pull request preference,
  and whether the code-changing phases are pre-approved or gated each time.

Open a master todo list and a running `EXECUTIVE_SUMMARY.md` across the phases. Surface any
suspected deanonymization or leak to me immediately, in any phase.

Read a large file through its outline first:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs context skim <file>` prints the imports, symbols,
and line counts, so a brief can then read one range instead of the whole file.

## Phase 1: model

Run **anonymity-threat-model** to map the adversaries, the assets that identify or link a
user, and the deanonymization paths. Everything downstream references it.

> **CHECKPOINT:** the worst paths, then a go or no-go decision.

## Phase 2: audit, read-only

Run the audits, parallelizing the independent ones: **anon-session-audit**,
**tor-egress-audit**, **metadata-leak-audit**, **fingerprint-resistance**,
**traffic-analysis-resistance**, and **supply-chain-trust**. Merge everything into
`LEAK_REGISTER.md` on the `§6` schema.

> **CHECKPOINT:** the ranked leaks, led by any clearnet, DNS, or identifier exposure. Decide
> what to fix.

## Phase 3: harden, which writes code and requires approval

Run **opsec-hardening** against `LEAK_REGISTER.md`. Enforce proxy routing and fail-closed
behavior, close the DNS, WebRTC, and IPv6 leaks, enforce stream isolation, strip metadata,
and redact or remove sensitive logging. Pin each fix with a regression test that fails if
the leak returns.

> **CHECKPOINT:** confirm each batch (`CONVENTIONS §4`), and confirm any intentional
> behavior-tightening with me.

## Phase 4: documentation and gate

Run **privacy-doc-alignment** to reconcile the privacy promises, the threat model, and the
opsec runbooks against the code, surfacing any unkept promise loudly, and to establish the
single source of truth. Then wire **opsec-pr-gate** into review, so a future change that
adds egress, logging, identifiers, fingerprint surface, or weakened defaults is blocked
before merge.

## The incident path, kept separate

If a leak is suspected rather than sought, start with **leak-incident-response**, which
triages, contains, scopes, and plans. Feed its output into the same `LEAK_REGISTER.md`.

## Done when

Every selected phase is complete, and leaks are fixed or deferred with a reason. Fail-closed
behavior and isolation are verified on the actual implementation. Regression tests lock the
leaks shut, and the documentation and threat model are reconciled. The master
`EXECUTIVE_SUMMARY.md` ties the findings, the fixes, and the residual risk together, and
nothing code-changing happened without your approval. Present the summary and list anything
still awaiting a decision.
