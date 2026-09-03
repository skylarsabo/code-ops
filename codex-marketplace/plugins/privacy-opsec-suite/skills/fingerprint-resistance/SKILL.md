---
name: fingerprint-resistance
description: "Use when you need to reduce the fingerprinting and uniqueness surface that could re-link anonymous users. Owns identity-fingerprint distinctiveness, not traffic timing or size, which traffic-analysis-resistance owns."
---

# Fingerprint resistance: make users indistinguishable

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:fingerprint-resistance`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** AUDIT.
- **Produces:** findings in `LEAK_REGISTER.md`, plus a summary.

## Phase 0. Identify the distinguishing surface  *(checkpoint)*

Determine what could distinguish one anonymous session from another, or re-link them, on
both the client and the server side.

> **CHECKPOINT:** present the candidate fingerprint surface, then confirm the scope.

## Phase 1. Enumerate and homogenize

Dispatch the explorer subagent to enumerate the surface across these layers:

- **Network and transport.** The header set, its ordering, and its uniqueness, the TLS or
  JA3 fingerprint, SNI, and protocol quirks.
- **Client, when a web or application client exists.** Canvas, WebGL, and audio
  fingerprints, fonts, screen size and `devicePixelRatio`, time zone, language, plugins, and
  other browser-surface signals, plus any per-user feature flag or configuration that leaks.
- **Behavioral.** Timing, interaction cadence, request ordering, and other patterns that
  correlate sessions.
- **Re-association.** Anything that re-links a returning anonymous user. See also the
  session audit.
- **Server.** Does the server return a distinguishing response per client that aids
  correlation?

Recommend homogenization, meaning uniform defaults that make every user look like everyone
else, rather than per-user uniqueness.

## Deliverables

Findings on the `§6` schema, with leak-class `identification` or `correlation`, written into
`LEAK_REGISTER.md`. A summary of the fingerprint and correlation surface, with the
homogenization recommendations.

## Done when

The fingerprint and correlation surface is enumerated, the homogenization recommendations
are concrete, and the riskiest distinguishers are highlighted.
