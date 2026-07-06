---
description: "Use when you need an operational runbook for a codebase — deploy/rollback, configuration, incident runbooks, and health/observability — written for the senior engineer who has to operate or be on-call for it."
disable-model-invocation: true
---

# OPS-DOCS — The Operator's Runbook

**Invoked as `/code-ops-suite:ops-docs`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — especially the **documentation quality standard (`§13`)** and the secret-redaction safety rail (`§4`). For this DOCUMENT-mode skill the binding sections are §3 (interaction), §4 (safety rails), §12 (SSOT/registers), and §13 (doc standard) — read those four; the fan-out/fix machinery (§1, §5–§8, §11) does not apply here.
**Mode:** DOCUMENT. **Produces:** `RUNBOOK.md` (and/or ops docs) in the repo's docs location.

## Phase 0 — Detect the operational surface  *(checkpoint)*
Find how the system is built, deployed, configured, and observed: Dockerfiles/compose, CI/CD workflows, infra, deploy scripts, config/env, health checks, dashboards/alerts. Confirm scope + docs location.

## Phase 1 — Deploy & rollback
The real deploy path (cited from the CI/scripts), how to roll back, and the preconditions/gotchas. A Mermaid flow of the pipeline where it helps.

## Phase 2 — Configuration reference
The env/config the system actually reads (cited), what each does, safe defaults, and the **secrets** — named, never valued (`<REDACTED>`).

## Phase 3 — Incident runbooks
For the likely failure modes: **symptom → diagnosis → fix**, with the exact commands/queries. Ground each in a real failure path in the code where possible.

## Phase 4 — Health & observability
What "healthy" looks like, the signals to watch, where the logs/metrics/dashboards are, and the first checks on an alert.

## Assemble (per `§13`)
Exec summary (how it deploys, where it runs, the top 3 things that break + first response), then the sections. Cite `file:line`; redact secrets; mark inferred steps `UNVERIFIED`; stamp the SHA.

## Done when
A senior engineer who has never operated this system could deploy it, roll it back, find and change config, and work the top incidents from this doc; every step is grounded in the real scripts/config (cited); no secret values appear.
