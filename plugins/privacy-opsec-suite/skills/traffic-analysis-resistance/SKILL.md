---
description: "Use when you need to reduce observable timing, size, and volume side channels and add padding or batching defaults. Owns traffic-shape correlation, not header or TLS fingerprints, which fingerprint-resistance owns."
---

# Traffic-analysis resistance: reduce observable signatures

**Invoked as `/privacy-opsec-suite:traffic-analysis-resistance`.** First read the bundled
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** AUDIT.
- **Produces:** findings in `LEAK_REGISTER.md`, plus a summary.
- **Expectations:** state them honestly. Full protection against a global passive adversary
  is generally out of scope. This skill reduces correlatability, it does not eliminate it.

## Phase 0. Characterize the observable traffic  *(checkpoint)*

Dispatch the explorer subagent to describe what an on-path or endpoint observer can see:
request and response sizes, timing, volume, and cadence.

> **CHECKPOINT:** present the observable-traffic profile. Confirm the scope and the threat,
> meaning an on-path observer or an endpoint.

## Phase 1. Find the correlatable signatures

- **Size signatures.** Distinctive request or response sizes that reveal which action or
  which content is in play, payload-size oracles, and compression side channels of the
  CRIME and BREACH kind.
- **Timing.** Patterns that correlate an input with an output, or that let an observer link
  a user's clearnet entry to anonymized activity through end-to-end timing correlation.
- **Volume and cadence.** A request rate or a burst pattern that acts as a signature.
- **Mitigations.** Options for padding, batching, constant-rate behavior, or cover traffic,
  defaults that reduce distinguishability, and response-time normalization for a sensitive
  operation.

## Deliverables

Findings on the `§6` schema, with leak-class `observability` or `correlation`, written into
`LEAK_REGISTER.md`. A summary of the correlatable signatures, the proposed mitigations, and
an honest statement of the residual risk against a global passive adversary.

## Done when

The observable signatures are characterized, the mitigations are proposed, and the limits
are stated honestly.
