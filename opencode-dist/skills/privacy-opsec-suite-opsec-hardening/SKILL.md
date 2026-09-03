---
name: privacy-opsec-suite-opsec-hardening
description: "Use when a LEAK_REGISTER.md exists and you want its leaks fixed safely, each pinned with a regression test. Requires a register as input."
---

# OpSec hardening: implement the fixes safely

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/privacy-opsec-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/privacy-opsec-suite-opsec-hardening`, or by the model through the `skill` tool as `privacy-opsec-suite-opsec-hardening`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** IMPLEMENT.
- **Consumes:** `LEAK_REGISTER.md`.
- **Produces:** fixes as branches or pull requests, `IMPLEMENTATION_LOG.md`, the updated
  register, and updated opsec documentation.

## Phase 0. Plan from the leak backlog  *(checkpoint)*

Read `LEAK_REGISTER.md`, then re-validate it first (`CONVENTIONS §11`). Run
`node <plugin-root>/scripts/revalidate-register.mjs LEAK_REGISTER.md --root .` and
triage its report. Then dispatch the explorer subagent to confirm that each surviving leak
still reproduces, and drop or stamp `OBSOLETE-AT <sha>` on anything already fixed. Build a
dependency and conflict graph, then sequence by severity, putting deanonymization and secret
leaks first.

> **CHECKPOINT:** present the re-validation results, the order and batching, and your pull
> request preference. For a NEEDS-DESIGN item, present the options and get a direction
> first.

## Phase 1. Implement, through `CONVENTIONS §10`

Several of the common hardening changes intentionally tighten behavior, which is the point.
Confirm each one with the developer and pin it with a test:

- Enforce proxy or Tor routing, and fail closed on failure, with no clearnet fallback.
- Route DNS through the proxy, remove the system-resolver paths, and close the WebRTC and
  IPv6 leaks.
- Enforce stream and connection isolation.
- Strip metadata from EXIF data, documents, build output, source maps, and headers.
- Remove sensitive logging, or route it through a redacting logger, and default-deny
  telemetry and third-party calls.
- Remove or replace the fingerprint vectors, and homogenize the headers and defaults.
- Tighten the cookie and session lifecycle, and make logging out fully clear the state.
- Default-deny egress.

For every fix, add a regression test that fails if the leak returns. It might assert that no
clearnet connection opens when the proxy fails, that no personal data appears in a log line,
or that EXIF data is stripped.

## Deliverables

Fixes as atomic pull requests with the tests green. An updated `LEAK_REGISTER.md` marking
each item done or deferred. `IMPLEMENTATION_LOG.md` recording what changed, the behavior
changes and the decision behind each one, and the verification. Updated opsec documentation.

## Done when

Leaks are fixed or deferred with a reason. Fail-closed behavior and isolation are verified
on the actual implementation, the tests are green, and the regression tests lock the leaks
shut. A final integration pass shows no new egress path, log line, or identifier introduced.
The updated `LEAK_REGISTER.md` passes
`node <plugin-root>/scripts/revalidate-register.mjs LEAK_REGISTER.md --root . --consumed <pre-run copy>`,
so no consumed item vanishes or closes without a pinned terminal form.
