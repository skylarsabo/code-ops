---
description: "Use when you need an operational runbook for a codebase, written for the senior engineer who has to operate it or be on call for it."
---

# OPS-DOCS: The Operator's Runbook

**Invoked as `/code-ops-suite:ops-docs`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`,
and especially the **documentation quality standard (`§13`)** and the secret-redaction safety
rail (`§4`). For this DOCUMENT-mode skill the binding sections are §2 (tools and in-house docs
lookup), §3 (interaction), §4 (safety rails), §12 (SSOT and registers), and §13 (doc standard).
Read those five. The fan-out and fix machinery (§1, §5 to §8, §11) does not apply here.
**Mode:** DOCUMENT. **Produces:** `RUNBOOK.md`, or a set of ops docs, in the repo's docs
location.

## Phase 0: the operational surface  *(checkpoint)*

Dispatch an `explorer` operative to find how the system is built, deployed, configured, and
observed: Dockerfiles and compose files, CI and CD workflows, infrastructure, deploy scripts,
config and environment, health checks, and dashboards and alerts. Confirm the scope and the docs
location.

## Phase 1: deploy and rollback

Document the real deploy path, cited from the CI or the scripts, how to roll back, and the
preconditions and gotchas. Add a Mermaid flow of the pipeline where it helps.

## Phase 2: the configuration reference

Document the environment and config the system actually reads, cited, what each entry does, the
safe defaults, and the **secrets**. Name each secret and never give its value, writing
`<REDACTED>` instead.

## Phase 3: the incident runbooks

For each likely failure mode, document the symptom, the diagnosis, and the fix, with the exact
commands and queries. Ground each one in a real failure path in the code where possible.

## Phase 4: health and observability

Document what healthy looks like, the signals to watch, where the logs and metrics and dashboards
are, and the first checks to run on an alert.

## The assembly, per `§13`

Lead with an executive summary naming how the system deploys, where it runs, and the top three
things that break with their first response. Then give the sections. Cite `file:line`. Redact the
secrets. Mark inferred steps `UNVERIFIED`. Stamp the SHA.

## Done when

- A senior engineer who has never operated this system could deploy it, roll it back, find and change its config, and work the top incidents from this doc.
- Every step is grounded in the real scripts and config, cited.
- No secret values appear.
