---
description: "Use when privacy promises, the threat model, or opsec runbooks have drifted from code and you want them reconciled (loudly surfacing any unkept promise) into the SSOT."
disable-model-invocation: true
---

# PRIVACY DOC ALIGNMENT — Promises That Match Reality

**Invoked as `/privacy-opsec-suite:privacy-doc-alignment`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** DOCUMENT · **Produces:** reconciled docs, `DRIFT_REPORT.md`, `SSOT_MAP.md`, `OPEN_QUESTIONS.md`. Edits documentation only — log any code issue as a finding, don't change code.

## Phase 0 — Inventory & map  *(checkpoint)*
Inventory the privacy/opsec docs (privacy policy, threat model, opsec runbooks, contributor rules) with each one's purpose; map **code reality**; map intended **SSOT** (which doc is authoritative per topic; flag no-owner and duplicate authorities).
> **CHECKPOINT:** present the inventory, the topic→authority map, and the biggest gaps; confirm which docs are authoritative vs. aspirational.

## Phase 1 — Verify, reconcile, establish SSOT
Verify **every privacy claim against the code**. Classify drift (stale / wrong / contradictory / orphaned / missing / duplicate-SSOT). **Top priority:** any **privacy promise the code does not actually keep** — an unkept promise is worse than none; flag it loudly as a finding, don't quietly soften the doc. Auto-fix unambiguous factual drift; bring stale-vs-aspirational and structural changes to the developer. Establish one authoritative **threat model**, **privacy policy**, and **opsec runbook**, an index, and a clear **"rules contributors must not break"** doc (what not to log/collect/route to, how defaults must stay).

## Deliverables
Reconciled docs; `DRIFT_REPORT.md` (items, type, resolution, evidence); `SSOT_MAP.md`; `OPEN_QUESTIONS.md`. Surface any unkept promise at the top.

## Done when
Docs match code; unkept promises are surfaced (not hidden); the SSOT is clean (one authority per topic, links resolve, index exists); contributor rules are documented; no code changed.
