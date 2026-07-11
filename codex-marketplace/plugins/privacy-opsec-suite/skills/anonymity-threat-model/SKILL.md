---
name: anonymity-threat-model
description: "Use when you need the keystone anonymity threat model that the other privacy audits build on."
---

# ANONYMITY THREAT MODEL — Map How a User Could Be Deanonymized

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:anonymity-threat-model`.** First read the bundled `<plugin-root>/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** AUDIT / DOCUMENT · **Produces:** `ANONYMITY_THREAT_MODEL.md`; feeds concrete leaks into `LEAK_REGISTER.md`. A durable, reusable artifact.

## Phase 0 — Inventory assets, adversaries & goals  *(checkpoint)*
Enumerate the **assets that identify or link a user**: real IP/location, account or session identifiers, behavioral patterns, device characteristics, metadata, and anything correlatable across sessions/time. Lay out the **adversaries** (`CONVENTIONS §A`) and **trust boundaries**, and state the system's **anonymity goals/promises** (unlinkability, unobservability, deniability, minimization).
> **CHECKPOINT:** present the assets, adversaries, trust boundaries, and stated goals; confirm scope and which adversaries to emphasize.

## Phase 1 — Map deanonymization paths
For each adversary × asset, work out how the adversary could **observe, link, or deanonymize** — at the network, session, application, metadata, dependency, and operator/legal layers. Trace data and traffic flows; mark where anonymity *depends* on a control (proxy routing, isolation, minimization, fail-closed) and what happens if that control fails. Rate residual risk per path, and cross-check every stated promise against whether the system actually keeps it.

## Deliverables
`ANONYMITY_THREAT_MODEL.md` — assets, adversaries, trust boundaries, the catalogue of deanonymization paths with the control each relies on, and residual-risk notes. Route concrete, fixable issues into `LEAK_REGISTER.md` (schema `§6`). Summarize the worst paths.

## Done when
Every adversary × asset is considered (tracked); paths are documented with the controls they depend on; unkept promises are flagged; the model is reusable by the other skills. Present the worst deanonymization paths first.
