---
type: home
status: current
updated: 2026-08-18
tags:
  - meta
---

# 00 Home

This is the map of the code-ops documentation system. Start here.

## This vault

`code-ops-docs/` is the only authored documentation hub for the marketplace. It holds shipped references, working designs, decisions, and run notes. [[Standard]] defines the layout and routing table. [[D-001 adopt vault standard]] records why this repo adopted it.

Folders:

- `00 Inbox/` takes capture. File it or delete it the same day.
- `10 Design/` holds architecture notes, specs, and PR plans.
- `20 Decisions/` holds one accepted choice per note, numbered from `D-001`.
- `80 Runs/` holds dated run folders. Git ignores it, so run artifacts stay local.
- `90 Templates/` holds the four new-note templates.
- `95 Attachments/` holds images and exports linked from notes.
- `98 System/` holds vault bookkeeping such as `SSOT_MAP` and `DRIFT_REPORT`.
- `99 Archive/` holds superseded notes, kept, pointing forward.

The code-ops profile waives `30 Ops/`, because this repo operates no service.

## Canonical domains

`[[98 System/DOCS_MANIFEST]]` is the only registry for these domains and their source evidence.

| Tree | Canonical for |
| --- | --- |
| [40 Engineering/Handbook/README.md](40%20Engineering/Handbook/README.md) | Doctrine and command reference. |
| [40 Engineering/Techniques/](40%20Engineering/Techniques/) | Engineering methods and standards. |
| [20 Decisions/ADRs/](20%20Decisions/ADRs/) | Published ADRs. |
| [98 System/Atlas/](98%20System/Atlas/) | Machine-checked judgment cache. |
| [../evals/README.md](../evals/README.md) | Regression evals and the calibration channel. |

`code-ops-docs/40 Engineering/Techniques/vault-standard.md` is the source of truth for the vault layout. [[Standard]] is a conformance copy of it.

## Current notes

Add a link here when you write a current design, an accepted decision, or a run index.

- [[D-001 adopt vault standard]]
- [[D-002 vault adoption stays voluntary]]
