---
description: "Use when the same concept is implemented divergently and you want it closed for good: one canonical form, every site migrated, and a mechanical enforcement so it cannot silently return. For whole-repo style normalization, see code-ops-suite:normalize."
disable-model-invocation: true
---

# CONSISTENCY CLOSURE — Close It So It Stays Closed

**Invoked as `/rigor:consistency-closure`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
**Mode:** IMPLEMENT (closure changes confirmed with you) · **Produces:** `CONSISTENCY_REGISTER.md`, migration diffs, the new enforcement; summary. Follows the closure protocol `§9`.

## Phase 0 — Scope  *(checkpoint)*
Pick the concept space (e.g. error handling, data access, validation, naming of one idea, API response shape).

## Phase 1 — Inventory the variants
Find **divergent implementations of the same concept**: multiple ways of doing one thing, drifted duplication, inconsistent return/error/null conventions, contract drift across call sites, inconsistent naming for a single idea. Group by concept; show each variant with `file:line`.

## Phase 2 — Choose the canonical form  *(checkpoint — a real decision)*
For each group, propose **one canonical form** with rationale (correctness, safety, ergonomics, prevalence).
> **CHECKPOINT:** the developer approves the canonical choice per group before any migration.

## Phase 3 — Close and enforce
Migrate every other site to the canonical form — behavior-preserving, conflict-aware, each migration tested and committed — then **add a mechanical enforcement** (lint rule, codemod/CI check, shared type, or test) so the divergence **cannot recur unnoticed**. Verify nothing else regressed (regression guard `§H`).

## Deliverables
`CONSISTENCY_REGISTER.md` (concept → canonical form → sites migrated → enforcement added), the diffs, and the enforcement config/rule; a summary of what's now canonical and guarded.

## Done when
Each inconsistency group has a canonical form, every site is migrated, a working enforcement is in place, and tests are green. "Closed" means recurrence is mechanically prevented.
