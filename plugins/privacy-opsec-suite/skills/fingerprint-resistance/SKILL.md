---
description: "Use when you need to reduce the fingerprinting/uniqueness surface (header/TLS/JA3/behavioral) that could re-link anonymous users. Owns identity-fingerprint distinctiveness — NOT traffic timing/size (see traffic-analysis-resistance)."
disable-model-invocation: true
---

# FINGERPRINT RESISTANCE — Make Users Indistinguishable

**Invoked as `/privacy-opsec-suite:fingerprint-resistance`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** AUDIT · **Produces:** findings → `LEAK_REGISTER.md`; summary.

## Phase 0 — Identify the distinguishing surface  *(checkpoint)*
Determine what could distinguish or re-link one anonymous session from another, on both the client and server sides.
> **CHECKPOINT:** present the candidate fingerprint surface; confirm scope.

## Phase 1 — Enumerate and homogenize
- **Network/transport:** header set, ordering, and uniqueness; TLS/JA3 fingerprint; SNI; protocol quirks.
- **Client (if a web/app client):** canvas/WebGL/audio fingerprints, fonts, screen/devicePixelRatio, timezone, language, plugins, and other browser-surface signals; per-user feature flags or config that leak.
- **Behavioral:** timing, interaction cadence, request ordering, and other patterns that correlate sessions.
- **Re-association:** anything that re-links a returning anonymous user (see also the session audit).
- **Server:** does the server return distinguishing responses per client that aid correlation?

Recommend **homogenization** — make every user look like everyone else, with uniform defaults — rather than per-user uniqueness.

## Deliverables
Findings (schema `§6`, leak-class `identification`/`correlation`) → `LEAK_REGISTER.md`; a summary of the fingerprint/correlation surface and homogenization recommendations.

## Done when
The fingerprint/correlation surface is enumerated; homogenization recommendations are concrete; the riskiest distinguishers are highlighted.
