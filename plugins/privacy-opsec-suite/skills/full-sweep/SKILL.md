---
description: "Use when you want the whole privacy-opsec-suite run end-to-end (threat model to audits to harden to docs/gate) as a guided, checkpointed pipeline. Intra-plugin orchestrator."
disable-model-invocation: true
---

# FULL SWEEP — Run the Whole Privacy/OpSec Suite End-to-End

**Invoked as `/privacy-opsec-suite:full-sweep`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — especially §A, the central **anonymity & OpSec model** every phase enforces. This skill **orchestrates the other skills in sequence** as one developer-in-the-loop pipeline: it runs them in order, carries `LEAK_REGISTER.md` forward, keeps a master plan, and checks in with you at every phase boundary. Stance is defensive — protect the system's own users and find/fix leaks in your own code.

## Phase 0 — Scope the run  *(checkpoint)*
Detect the stack and the size of the repo, then confirm with me:
- **Track:** `audit-only` (read + document, no code changes) · `full` (audit → harden → docs/gate) · or a custom subset.
- Scope, the adversaries to emphasize (`CONVENTIONS §A`), PR preference, and whether code-changing phases are pre-approved or gated each time.
Open a master todo and a running `EXECUTIVE_SUMMARY.md` across phases. **Surface any suspected deanonymization/leak to me immediately, in any phase.**

## Phase 1 — Model
Run **anonymity-threat-model** to map adversaries, the assets that identify/link a user, and the deanonymization paths. Everything downstream references it. → *Checkpoint:* the worst paths, go/no-go.

## Phase 2 — Audit (read-only)
Run the audits, parallelizing the independent ones: **anon-session-audit**, **tor-egress-audit**, **metadata-leak-audit**, **fingerprint-resistance**, **traffic-analysis-resistance**, **supply-chain-trust**. Merge everything into `LEAK_REGISTER.md` (schema `§6`). → *Checkpoint:* ranked leaks led by any clearnet/DNS/identifier exposure; decide what to fix.

## Phase 3 — Harden (writes code — requires approval)
Run **opsec-hardening** against `LEAK_REGISTER.md`: enforce proxy routing and **fail-closed**, close DNS/WebRTC/IPv6 leaks, enforce stream isolation, strip metadata, redact/remove sensitive logging — each fix pinned with a **regression test that fails if the leak returns**. → *Checkpoint per batch* (`CONVENTIONS §4`); intentional behavior-tightening confirmed with you.

## Phase 4 — Docs & gate
Run **privacy-doc-alignment** to reconcile the privacy promises, threat model, and opsec runbooks against the code — surfacing any **unkept promise** loudly — and establish the SSOT. Then wire **opsec-pr-gate** into review so future changes that add egress, logging, identifiers, fingerprint surface, or weakened defaults are blocked before merge.

## Incident path (separate)
If a leak is *suspected* rather than sought, start with **leak-incident-response** (triage → contain → scope → plan) and feed its output into the same `LEAK_REGISTER.md`.

## Done when
Every selected phase is complete, leaks are fixed or deferred-with-reason, **fail-closed and isolation are verified on the actual implementation**, regression tests lock the leaks shut, and the docs/threat-model are reconciled; the master `EXECUTIVE_SUMMARY.md` ties findings, fixes, and residual risk together; and nothing code-changing happened without your approval. Present the summary and list anything still awaiting a decision.
