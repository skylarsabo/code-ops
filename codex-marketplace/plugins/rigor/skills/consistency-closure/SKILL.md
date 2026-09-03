---
name: consistency-closure
description: "Use when the same concept is implemented divergently and you want it closed for good, in one canonical form, mechanically enforced. For whole-repo style normalization, see code-ops-suite:normalize."
---

# Consistency closure: close it so it stays closed

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `rigor:consistency-closure`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows.

- **Mode:** IMPLEMENT. Every closure change is confirmed with the developer.
- **Produces:** `CONSISTENCY_REGISTER.md`, the migration diffs, the new enforcement, and a
  summary.
- **Protocol:** the closure protocol in `§9`.

## Phase 0: scope  *(checkpoint)*

Pick the concept space, for example error handling, data access, validation, the naming of
one idea, or the shape of an API response.

## Phase 1: inventory the variants

Dispatch a `tracer` to find divergent implementations of one concept: several ways of doing
one thing, drifted duplication, inconsistent return, error, or null conventions, contract
drift across call sites, and inconsistent naming for a single idea. Group the variants by
concept and show each one with its `file:line`.

## Phase 2: choose the canonical form  *(checkpoint, and a real decision)*

For each group, propose one canonical form with its rationale, weighing correctness, safety,
ergonomics, and prevalence.

> **CHECKPOINT:** the developer approves the canonical choice per group before any migration.

## Phase 3: close and enforce

Migrate every other site to the canonical form. Each migration is behavior-preserving,
conflict-aware, tested, and committed. Then add a mechanical enforcement, which may be a
lint rule, a codemod or CI check, a shared type, or a test, so the divergence cannot recur
unnoticed. Have a `verifier` confirm that nothing else regressed, under the regression guard
(`§H`).

## Deliverables

`CONSISTENCY_REGISTER.md` mapping each concept to its canonical form, the sites migrated,
and the enforcement added. The diffs. The enforcement configuration or rule. A summary of
what is now canonical and guarded.

## Done when

Each inconsistency group has a canonical form, every site is migrated, a working enforcement
is in place, and the tests are green. Closed means that recurrence is mechanically
prevented. The finished `CONSISTENCY_REGISTER.md` passes
`node <plugin-root>/scripts/revalidate-register.mjs CONSISTENCY_REGISTER.md --root .`
with exit 0. Before the run is done, re-locate any non-FRESH citation against the real tree
or drop it (`§E`).
