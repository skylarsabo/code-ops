---
name: leak-incident-response
description: "Use when an anonymity/privacy leak is suspected and you need to triage, contain, scope blast radius, and plan remediation without making it worse."
---

# LEAK INCIDENT RESPONSE — Contain a Suspected Leak

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:leak-incident-response`.** First read the bundled `<plugin-root>/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** REVIEW (analysis + a proposed containment change; no destructive action) · **Produces:** an incident report → `OPSEC_RUNBOOK.md` + `LEAK_REGISTER.md`; a proposed containment change (apply only with confirmation). Use when a possible anonymity/privacy leak or correlation vector is suspected.

## Phase 0 — Establish what's suspected  *(checkpoint)*
Capture the suspected leak, the affected area, and the timeline — **without making it worse** (do not add PII logging to investigate). Work from redacted evidence.
> **CHECKPOINT:** present what's suspected and the investigation plan; confirm scope. Surface anything clearly critical immediately.

## Phase 1 — Triage → contain → scope → plan
- **Triage:** is it a real leak? Confirm with redacted, `file:line` evidence; rule out false positives.
- **Contain:** the smallest immediate change that stops it (fail-closed, disable the leaking path, block the egress) — proposed for the developer to apply.
- **Blast radius:** what was exposed, **who could be deanonymized or linked**, over what time window, and observable by which adversary.
- **Root cause:** the underlying defect (a fallback that bypassed the proxy, an unredacted log, a metadata field, a correlation vector).
- **Remediation plan:** the durable fix plus a **regression test that locks the leak shut**.
- **Communication:** what to disclose, stated factually, **without over-collecting** to investigate.

## Deliverables
An incident report (timeline, what leaked, blast radius, root cause, fix, regression test) into `OPSEC_RUNBOOK.md` and a tracked entry in `LEAK_REGISTER.md`; the proposed containment change.

## Done when
The leak is confirmed and scoped, containment is proposed, root cause is identified, and a remediation + regression test are defined; the report is written. Apply containment/fix only via the hardening loop with the developer's go-ahead.
