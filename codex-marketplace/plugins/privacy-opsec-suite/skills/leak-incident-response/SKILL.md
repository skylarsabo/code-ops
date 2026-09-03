---
name: leak-incident-response
description: "Use when an anonymity or privacy leak is suspected and you need to triage, contain, scope the blast radius, and plan remediation without making it worse."
---

# Leak incident response: contain a suspected leak

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:leak-incident-response`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** REVIEW. It analyzes and proposes one containment change, and takes no
  destructive action.
- **Produces:** an incident report in `OPSEC_RUNBOOK.md` and an entry in `LEAK_REGISTER.md`,
  plus a proposed containment change. Apply that change only with confirmation.
- **When to use it:** a possible anonymity or privacy leak, or a correlation vector, is
  suspected.

## Phase 0. Establish what is suspected  *(checkpoint)*

Capture the suspected leak, the affected area, and the timeline, without making the leak
worse. Do not add logging of personal data in order to investigate. Work from redacted
evidence.

> **CHECKPOINT:** present what is suspected and the investigation plan, then confirm the
> scope. Surface anything clearly critical immediately.

## Phase 1. Triage, contain, scope, then plan

- **Triage.** Dispatch the explorer subagent to confirm, with redacted `file:line` evidence,
  whether the leak is real. Rule out the false positives.
- **Containment.** Name the smallest immediate change that stops the leak, such as failing
  closed, disabling the leaking path, or blocking the egress. Propose it for the developer
  to apply.
- **Blast radius.** State what was exposed, who could be deanonymized or linked, over what
  time window, and which adversary could observe it.
- **Root cause.** Name the underlying defect, such as a fallback that bypassed the proxy, an
  unredacted log, a metadata field, or a correlation vector.
- **Remediation plan.** Give the durable fix plus a regression test that locks the leak
  shut.
- **Communication.** State what to disclose, factually, and without over-collecting in order
  to investigate.

## Deliverables

An incident report in `OPSEC_RUNBOOK.md` covering the timeline, what leaked, the blast
radius, the root cause, the fix, and the regression test. A tracked entry in
`LEAK_REGISTER.md`. The proposed containment change.

## Done when

The leak is confirmed and scoped, containment is proposed, the root cause is identified, and
a remediation with a regression test is defined. The report is written. Apply the
containment or the fix only through the hardening loop, with the developer's go-ahead.
