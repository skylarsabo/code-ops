---
description: "Use when docs have drifted from code and you want them reconciled into a clean single source of truth."
disable-model-invocation: true
---

# DOCUMENTATION ALIGNMENT — Reconcile Drift & Establish Single Source of Truth

**Invoked as `/code-ops-suite:doc-alignment`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** DOCUMENT · **Produces:** reconciled docs (edited in place), `DRIFT_REPORT.md`, `SSOT_MAP.md`, `OPEN_QUESTIONS.md`.

Find **all** documentation drift, reconcile docs against **code reality**, and leave a clean **single source of truth** future operators can trust. **Code is ground truth; docs serve the next operator.** Edits documentation only — if a doc reveals a likely *code* bug, log it as a finding, don't touch code.

## Phase 0 — Inventory, map reality & SSOT intent  *(checkpoint)*
Inventory all docs (READMEs, reference docs, ADRs, runbooks, guides, doc-comments, any SSOT folder) with each one's purpose. Map **code reality** (enough to verify claims). Map **intended SSOT** — for each topic, which doc is *supposed* to be authoritative; flag topics with **no owner** and **multiple competing authorities**. If VCS history is available, use it to **date the drift** (where code moved without docs following).
> **CHECKPOINT:** present the inventory, the topic→authoritative-doc map (no-owner and duplicate-authority flagged), and the biggest hot-spots; confirm which folders are authoritative vs. aspirational, and anything off-limits.

## Phase 1 — Detect drift, then reconcile
Verify **every doc claim against code**. Classify each mismatch: **stale · wrong · contradictory · orphaned · missing · duplicate-SSOT · broken-ref · outdated-diagram · dead-procedure · drifted-comment** (with severity; critical = misleads on security/privacy/setup/data). Then:
- **Auto-fix** unambiguous factual drift (stale/wrong facts, broken refs, dead procedures with a verifiable correct version, diagrams that should match the verified map, drifted comments), verified against code.
- **Stale-vs-aspirational → ask.** If a documented feature is absent from code, use history to tell *removed* (→ remove/relocate) from *never-built* (→ likely aspirational). **When unclear, ask** — never silently delete a possible plan or "correct" reality to match a roadmap. *(This is the central judgment call.)*
- **Structural changes → ask.** Merging duplicate SSOTs, deleting/relocating docs, reorganizing — propose with a recommendation; apply after approval.
- **Open questions → flag, don't invent.**

## Phase 2 — Establish SSOT
One authoritative source per topic (non-authoritative mentions defer/link to it); working cross-links; a concise **index** pointing to each authority; and a **future-operator usability** check (could someone new rely on this cold?). Fill verified gaps with short docs; flag the rest.

## Deliverables (run artifacts in a dated folder; docs edited in place)
**Reconciled documentation**; **`DRIFT_REPORT.md`** (every item, type, resolution, evidence; totals; highest-impact first); **`SSOT_MAP.md`** (topic→authoritative doc, how duplicates were resolved); **`OPEN_QUESTIONS.md`** (awaiting decision: stale-vs-aspirational, ambiguous reality, structural proposals). Note any likely *code* bugs for the audit/remediation prompts.

Tier honesty at point of use: a drift you did not execute a check for is PROBABLE at most — never CONFIRMED (`§7`); when unsure between tiers, pick the lower.

## Done when
Every doc claim verified; unambiguous drift fixed and committed; stale-vs-aspirational and structural calls brought to the developer and resolved/queued; SSOT clean (one authority per topic, links resolve, index exists); deliverables consistent; no code changed; a final self-audit for unverified claims and missed links. Present `DRIFT_REPORT.md` first, highest-impact reconciliations and open questions at the top.
