---
description: "Use when you need to find PII/identifiers leaking in logs, telemetry, errors, response headers, or embedded file metadata. Owns at-rest/in-band metadata — NOT timing/size side channels (see traffic-analysis-resistance)."
disable-model-invocation: true
---

# METADATA LEAK AUDIT — Minimize What Leaks

**Invoked as `/privacy-opsec-suite:metadata-leak-audit`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** AUDIT · **Produces:** findings → `LEAK_REGISTER.md`; summary.

## Phase 0 — Inventory metadata sources  *(checkpoint)*
Find everywhere metadata is produced, stored, served, or logged: logging, telemetry/analytics, error/crash reporting, generated/served files, response headers, caches/CDN, backups.
> **CHECKPOINT:** present the inventory; confirm scope.

## Phase 1 — Hunt and minimize
- **Logs/telemetry/errors:** PII, IPs, identifiers, tokens, or precise timestamps in logs, analytics, or crash/error reports; verbose stack traces shipped off-box.
- **Embedded file metadata:** EXIF in images, author/timestamps in documents, build metadata, source maps, debug symbols, file paths, and usernames baked into served or generated artifacts.
- **Headers:** `Server`, `X-Powered-By`, `Date` drift, `ETag`, `Set-Cookie`, framework banners.
- **Side channels:** response size and timing differences that reveal content or user state; cache/CDN leakage of per-user data.
- **Retention:** logs/backups kept longer than needed; no deletion path; "anonymized" data that re-identifies.

Goal throughout: **strip or minimize** — what isn't emitted can't leak or be compelled.

Tier honesty at point of use: a leak you did not reproduce or directly observe is PROBABLE at most — never CONFIRMED (`§6`); when unsure between tiers, pick the lower.
## Deliverables
Findings (schema `§6`, leak-class `metadata`/`observability`) → `LEAK_REGISTER.md`; a summary with concrete minimization/stripping recommendations, highest-impact first.

## Done when
Every metadata source is assessed; minimization recommendations are concrete and actionable; retention gaps flagged.
