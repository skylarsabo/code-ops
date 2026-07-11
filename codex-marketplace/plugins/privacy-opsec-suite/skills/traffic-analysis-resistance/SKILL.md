---
name: traffic-analysis-resistance
description: "Use when you need to reduce observable timing/size/volume side channels and add padding/batching defaults. Owns traffic-shape correlation — NOT header/TLS fingerprints (see fingerprint-resistance)."
---

# TRAFFIC-ANALYSIS RESISTANCE — Reduce Observable Signatures

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:traffic-analysis-resistance`.** First read the bundled `<plugin-root>/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** AUDIT · **Produces:** findings → `LEAK_REGISTER.md`; summary. Set expectations honestly — full protection against a global passive adversary is generally out of scope; this reduces, not eliminates, correlatability.

## Phase 0 — Characterize observable traffic  *(checkpoint)*
Describe what an on-path or endpoint observer can see: request/response sizes, timing, volume, and cadence.
> **CHECKPOINT:** present the observable-traffic profile; confirm scope and the threat (on-path observer vs. endpoint).

## Phase 1 — Find correlatable signatures
- **Size signatures:** distinctive request/response sizes that reveal which action/content; payload-size oracles; compression side channels (CRIME/BREACH-style).
- **Timing:** patterns that correlate input↔output, or that let an observer link a user's clearnet entry to anonymized activity (end-to-end timing correlation).
- **Volume/cadence:** request rate or burst patterns that act as a signature.
- **Mitigations:** options for padding, batching, constant-rate behavior, or cover traffic; defaults that reduce distinguishability; response-time normalization for sensitive operations.

## Deliverables
Findings (schema `§6`, leak-class `observability`/`correlation`) → `LEAK_REGISTER.md`; a summary of the correlatable signatures, proposed mitigations, and an honest statement of residual risk against a global passive adversary.

## Done when
Observable signatures are characterized; mitigations are proposed; limits are stated honestly.
