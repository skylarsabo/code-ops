---
name: metadata-leak-audit
description: "Use when you need to find personal data or identifiers leaking in logs, telemetry, errors, response headers, or embedded file metadata. Owns at-rest and in-band metadata, not timing or size side channels, which traffic-analysis-resistance owns."
---

# Metadata leak audit: minimize what leaks

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:metadata-leak-audit`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** AUDIT.
- **Produces:** findings in `LEAK_REGISTER.md`, plus a summary.

## Phase 0. Inventory the metadata sources  *(checkpoint)*

Find everywhere metadata is produced, stored, served, or logged: logging, telemetry and
analytics, error and crash reporting, generated and served files, response headers, caches
and the CDN, and backups.

> **CHECKPOINT:** present the inventory, then confirm the scope.

## Phase 1. Hunt and minimize

Dispatch the explorer subagent to hunt across those sources:

- **Logs, telemetry, and errors.** Look for personal data, IP addresses, identifiers,
  tokens, or precise timestamps in logs, analytics, and crash or error reports, and for
  verbose stack traces shipped off the box.
- **Embedded file metadata.** Look for EXIF data in images, author names and timestamps in
  documents, build metadata, source maps, debug symbols, file paths, and usernames baked
  into a served or generated artifact.
- **Headers.** Check `Server`, `X-Powered-By`, `Date` drift, `ETag`, `Set-Cookie`, and
  framework banners.
- **Side channels.** Look for response size and timing differences that reveal content or
  user state, and for cache or CDN leakage of per-user data.
- **Retention.** Look for logs and backups kept longer than needed, a missing deletion path,
  and anonymized data that re-identifies.

The goal throughout is to strip or minimize. What is never emitted cannot leak and cannot be
compelled.

Keep tiers honest at the point of use. A leak you did not reproduce or directly observe is
PROBABLE at most, never CONFIRMED (`§6`). When you are unsure between two tiers, pick the
lower one.

## Deliverables

Findings on the `§6` schema, with leak-class `metadata` or `observability`, written into
`LEAK_REGISTER.md`. A summary carrying concrete minimization and stripping recommendations,
highest impact first.

## Done when

Every metadata source is assessed, the minimization recommendations are concrete and
actionable, and the retention gaps are flagged.
