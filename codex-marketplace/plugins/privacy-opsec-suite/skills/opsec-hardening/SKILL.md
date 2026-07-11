---
name: opsec-hardening
description: "Use when a LEAK_REGISTER.md exists and you want its leaks fixed safely, each pinned with a regression test. Requires a register as input."
---

# OPSEC HARDENING — Implement the Fixes Safely

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:opsec-hardening`.** First read the bundled `<plugin-root>/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** IMPLEMENT · **Consumes:** `LEAK_REGISTER.md`. · **Produces:** fixes (branches/PRs), `IMPLEMENTATION_LOG.md`, updated register + opsec docs.

## Phase 0 — Plan from the leak backlog  *(checkpoint)*
Read `LEAK_REGISTER.md`. **Re-validate first (`CONVENTIONS §11`):** run `node <plugin-root>/scripts/revalidate-register.mjs LEAK_REGISTER.md --root .` and triage its report, then confirm each surviving leak still reproduces (drop/`OBSOLETE-AT <sha>` anything fixed). Build a dependency/conflict graph; sequence by severity (deanonymization/secret leaks first).
> **CHECKPOINT:** present re-validation results, the order/batching, and your PR preference. For **NEEDS-DESIGN** items, present options and get a direction first.

## Phase 1 — Implement (via `CONVENTIONS §10`)
Common hardening — **several intentionally tighten behavior, which is the point; confirm those with the developer and pin them with tests:**
- enforce proxy/Tor routing and **fail-closed** on failure (no clearnet fallback)
- route DNS through the proxy / remove system-resolver paths; close WebRTC/IPv6 leaks
- enforce stream/connection isolation
- strip metadata (EXIF / document / build / source maps / headers)
- remove sensitive logging or route it through a redacting logger; default-deny telemetry/third-party calls
- remove/replace fingerprint vectors; homogenize headers and defaults
- tighten cookie/session lifecycle; ensure logout fully clears state
- default-deny egress

For every fix, add a **regression test that fails if the leak returns** (e.g. asserts no clearnet connect on proxy failure, no PII in a log line, EXIF stripped).

## Deliverables
Fixes (atomic PRs, tests green); updated `LEAK_REGISTER.md` (items done/deferred); `IMPLEMENTATION_LOG.md` (what changed, behavior changes + the decision behind them, verification); updated opsec docs.

## Done when
Leaks are fixed or deferred-with-reason; **fail-closed and isolation are verified on the actual implementation**; tests green; regression tests lock the leaks shut; a final integration pass shows no new egress/log/identifier introduced. The updated LEAK_REGISTER.md passes `node <plugin-root>/scripts/revalidate-register.mjs LEAK_REGISTER.md --root . --consumed <pre-run copy>` — no consumed item vanishes or closes without a pinned terminal form.
