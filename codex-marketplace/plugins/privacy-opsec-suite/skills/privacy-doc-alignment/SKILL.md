---
name: privacy-doc-alignment
description: "Use when privacy promises, the threat model, or opsec runbooks have drifted from code and you want them reconciled into the single source of truth."
---

# Privacy documentation alignment: promises that match reality

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:privacy-doc-alignment`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** DOCUMENT.
- **Produces:** reconciled documentation, `DRIFT_REPORT.md`, `SSOT_MAP.md`, and
  `OPEN_QUESTIONS.md`.
- **Limit:** it edits documentation only. Log any code issue as a finding and change no
  code.

## Phase 0. Inventory and map  *(checkpoint)*

Inventory the privacy and opsec documentation, meaning the privacy policy, the threat model,
the opsec runbooks, and the contributor rules, and state each one's purpose. Dispatch the
explorer subagent to map code reality against them. Map the intended single source of truth,
naming which document is authoritative per topic, and flag every topic with no owner and
every topic with duplicate authorities.

> **CHECKPOINT:** present the inventory, the map from topic to authority, and the biggest
> gaps. Confirm which documents are authoritative and which are aspirational.

## Phase 1. Verify, reconcile, and establish the single source of truth

Verify every privacy claim against the code. Classify the drift as stale, wrong,
contradictory, orphaned, missing, or a duplicate authority.

The top priority is any privacy promise the code does not actually keep. An unkept promise
is worse than no promise. Flag it loudly as a finding, and never quietly soften the
document.

Auto-fix the unambiguous factual drift. Bring the stale-versus-aspirational judgments and
the structural changes to the developer. Establish one authoritative threat model, one
privacy policy, and one opsec runbook, plus an index and a clear document of the rules
contributors must not break, covering what not to log, what not to collect, where not to
route, and how the defaults must stay.

## Deliverables

Reconciled documentation. `DRIFT_REPORT.md` listing each item, its type, its resolution, and
its evidence. `SSOT_MAP.md`. `OPEN_QUESTIONS.md`. Surface any unkept promise at the top.

## Done when

The documentation matches the code, and unkept promises are surfaced rather than hidden. The
single source of truth is clean, with one authority per topic, links that resolve, and an
index. The contributor rules are documented, and no code changed.
