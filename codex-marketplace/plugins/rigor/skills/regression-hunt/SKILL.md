---
name: regression-hunt
description: "Use when something used to work and you need to pinpoint the commit that broke it and find related regressions in recent changes."
---

# Regression hunt: when it broke, and what else did

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `rigor:regression-hunt`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows.

- **Mode:** AUDIT. It reads version-control history and executes repros.
- **Produces:** `REGRESSION_REPORT.md`, and findings into `FINDINGS_REGISTER.md`.
- **Pairing:** run it with `bug-hunt` to bisect a confirmed bug, or run it after a release.

## Phase 0: scope  *(checkpoint)*

Define the target. Either name a known behavior change to bisect to its origin, or name a
window such as the regressions introduced in the last N commits or since a given release.
Confirm the time range and what correct looked like before.

## Phase 1: locate and confirm

- **Bisect a known bug.** Have a `verifier` write a test that detects it, then execute the
  version-control bisect to the commit that introduced it. Report the commit, the change,
  and why it caused the regression.
- **Sweep recent changes.** Derive what recent commits altered. Have the `verifier` run the
  accumulated proof set and the characterization tests across them. Look for behavior
  regressions and for performance regressions. Check the changed areas against the lenses
  (`§7`).
- **Related areas.** Dispatch a `tracer` to identify other code the offending change
  touched, or that shares a root cause with it, which may carry the same regression (`§G`).

## Deliverables

`REGRESSION_REPORT.md` carries the offending commits, the repro, the blast radius, and the
related areas to check. CONFIRMED findings go into `FINDINGS_REGISTER.md`, where the bisect
and the repro are the proof. If recent changes are clean, say so and give the evidence.

## Done when

The regression's origin is pinpointed with a repro, or recent changes are cleared. Related
areas are flagged, and every finding carries its bisect or repro proof.
