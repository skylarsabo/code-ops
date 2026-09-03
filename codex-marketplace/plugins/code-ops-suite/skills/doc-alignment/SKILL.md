---
name: doc-alignment
description: "Use when docs have drifted from code and you want them reconciled into a clean single source of truth."
---

# Documentation alignment: reconcile drift, establish one source of truth

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:doc-alignment`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section.
**Mode:** DOCUMENT · **Produces:** reconciled docs edited in place, `DRIFT_REPORT.md`,
`SSOT_MAP.md`, and `OPEN_QUESTIONS.md`.

Find **all** documentation drift, reconcile the authored hub against **code reality**, and leave
one authority future operators can trust. **Code is ground truth, and docs serve the next
operator.** Registered immutable records supply evidence through IDs and generated indexes, and
never become a second authored authority. This skill edits documentation only. When a doc reveals
a likely *code* bug, log it as a finding and leave the code alone.

## Phase 0: the inventory, code reality, and SSOT intent  *(checkpoint)*

Dispatch an `explorer` operative to inventory all docs, including READMEs, reference docs, ADRs,
runbooks, guides, doc-comments, and any SSOT folder, recording each one's purpose. Have it map
**code reality** far enough to verify the claims. Map the **intended SSOT**: for each topic,
which doc is supposed to be authoritative. Flag topics with **no owner** and topics with
**multiple competing authorities**. When version-control history is available, use it to **date
the drift**, finding where code moved without docs following.

> **CHECKPOINT:** present the inventory, the topic-to-authoritative-doc map with no-owner and duplicate-authority flagged, and the biggest hot-spots. Confirm which folders are authoritative against aspirational, and anything off-limits.

## Phase 1: the drift detection and reconciliation

Verify **every doc claim against code**. Classify each mismatch as stale, wrong, contradictory,
orphaned, missing, duplicate-SSOT, broken-ref, outdated-diagram, dead-procedure, or
drifted-comment, with a severity. Critical means the doc misleads on security, privacy, setup, or
data. Then:
- **Auto-fix unambiguous factual drift,** verified against code: stale or wrong facts, broken refs, dead procedures with a verifiable correct version, diagrams that should match the verified map, and drifted comments.
- **Ask on stale against aspirational.** When a documented feature is absent from code, use history to tell *removed*, which routes to removal or relocation, from *never-built*, which is likely aspirational. **When it is unclear, ask.** Never silently delete a possible plan, and never correct reality to match a roadmap. That call is the central judgment of this skill.
- **Ask on structural changes.** Merging duplicate SSOTs, deleting or relocating docs, and reorganizing all get proposed with a recommendation, and applied after approval.
- **Flag open questions rather than inventing answers.**

Keep tier honesty at the point of use. A drift you did not execute a check for is PROBABLE at
most, never CONFIRMED (`§7`). When unsure between two tiers, pick the lower.

## Phase 2: the single source of truth

Leave one authoritative source per topic, with non-authoritative mentions deferring to it or
linking to it. Leave working cross-links, and a concise **index** pointing to each authority.
Run a **future-operator usability** check by asking whether someone new could rely on this cold.
Fill verified gaps with short docs, and flag the rest.

## Deliverables

Run artifacts go in a dated folder, and docs are edited in place:
- **Reconciled documentation.**
- **`DRIFT_REPORT.md`:** every item, its type, its resolution, and its evidence, plus totals, highest-impact first.
- **`SSOT_MAP.md`:** the topic-to-authoritative-doc map, and how duplicates were resolved.
- **`OPEN_QUESTIONS.md`:** items awaiting a decision, covering stale against aspirational, ambiguous reality, and structural proposals.

Note any likely *code* bugs for the audit and remediation prompts.

## Done when

- Every doc claim is verified, and unambiguous drift is fixed and committed.
- The stale-against-aspirational calls and the structural calls were brought to the developer and resolved or queued.
- The SSOT is clean, with one authority per topic, links that resolve, and an index that exists.
- The deliverables are consistent, and no code changed.
- A final self-audit found no unverified claims and no missed links.
- `DRIFT_REPORT.md` is presented first, with the highest-impact reconciliations and open questions at the top.
