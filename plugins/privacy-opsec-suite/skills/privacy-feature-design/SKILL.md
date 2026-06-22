---
description: "Use when you want high-value privacy/trust features found and specified, each gated against the anonymity model. Discovery/spec only."
disable-model-invocation: true
---

# PRIVACY FEATURE DESIGN — High-Value, Trust-Building Features

**Invoked as `/privacy-opsec-suite:privacy-feature-design`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** DISCOVERY · **Produces:** `PRIVACY_FEATURE_OPPORTUNITIES.md` (ranked), mini-specs, roadmap, summary. Discovery and specification only — no implementation.

## Phase 0 — Understand the product & its anonymity model  *(checkpoint)*
Map the current feature set, the anonymity/opsec model, latent capabilities, and intent signals (TODOs, stubs, disabled flags).
> **CHECKPOINT:** confirm direction, target users, in/out-of-scope, and appetite.

## Phase 1 — Find features that deepen trust & control
Grounded in the code, look for privacy/trust capabilities (these strengthen the moat): data export/portability, local-first / self-host, end-to-end or zero-knowledge options, ephemeral/anonymous modes, metadata-minimization toggles, user-controlled audit logs, "what we know about you" transparency, granular anonymity controls, a Tor-only mode, panic/wipe. **Gate every idea against the anonymity model (`§A`):** it must *strengthen* or be *neutral*; anything that would erode anonymity is flagged for a developer decision, never silently proposed. Define each idea's **smallest valuable slice**.

## Phase 2 — Prioritize → spec  *(checkpoint)*
Rank (impact × reach ÷ effort, weighted by confidence); tag quick wins / big bets.
> **CHECKPOINT:** present ranked opportunities; the developer picks which get specs. Then write a mini-spec per chosen feature including its **anonymity impact and threat-model fit**.

## Deliverables
`PRIVACY_FEATURE_OPPORTUNITIES.md` (ranked register), chosen mini-specs, a roadmap, and an `EXECUTIVE_SUMMARY.md`.

## Done when
Opportunities are grounded, gated against the model, and ranked; both checkpoints done; mini-specs exist for the chosen set; no code changed.
