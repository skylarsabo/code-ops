---
description: "Use when you need the keystone anonymity threat model that the other privacy audits build on."
---

# Anonymity threat model: how a user could be deanonymized

**Invoked as `/privacy-opsec-suite:anonymity-threat-model`.** First read the bundled
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** AUDIT and DOCUMENT.
- **Produces:** `ANONYMITY_THREAT_MODEL.md`, and it feeds concrete leaks into
  `LEAK_REGISTER.md`. The model is a durable, reusable artifact.

## Phase 0. Inventory assets, adversaries, and goals  *(checkpoint)*

Enumerate the assets that identify or link a user: the real IP address and location, account
and session identifiers, behavioral patterns, device characteristics, metadata, and anything
correlatable across sessions or over time. Lay out the adversaries (`CONVENTIONS §A`) and
the trust boundaries. State the system's anonymity goals and promises, meaning
unlinkability, unobservability, deniability, and minimization.

> **CHECKPOINT:** present the assets, adversaries, trust boundaries, and stated goals.
> Confirm the scope and which adversaries to emphasize.

## Phase 1. Map the deanonymization paths

For each pairing of an adversary with an asset, dispatch the explorer subagent to trace the
data and traffic flows and work out how the adversary could observe, link, or deanonymize.
Cover the network, session, application, metadata, dependency, and operator or legal layers.
Mark where anonymity depends on a control, such as proxy routing, isolation, minimization,
or fail-closed behavior, and state what happens when that control fails. Rate the residual
risk per path. Cross-check every stated promise against whether the system actually keeps
it.

## Deliverables

`ANONYMITY_THREAT_MODEL.md` carries the assets, the adversaries, the trust boundaries, the
catalogue of deanonymization paths with the control each one relies on, and the
residual-risk notes. Route concrete, fixable issues into `LEAK_REGISTER.md` on the `§6`
schema. Summarize the worst paths.

## Done when

Every pairing of an adversary with an asset is considered and tracked. Paths are documented
with the controls they depend on, and unkept promises are flagged. The model is reusable by
the other skills. Present the worst deanonymization paths first.
