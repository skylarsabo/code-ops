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

`code-ops-docs/` holds design-time judgment about the marketplace: working designs, decisions, and run notes. [[Standard]] defines the layout, the frontmatter, and the routing table. [[D-001 adopt vault standard]] records why this repo adopted it.

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

## Canonical trees in the repo

These trees stay canonical. The vault links to them and never copies them. When a vault note matures into doctrine, promote it into the owning tree and leave a link behind.

| Tree | Canonical for |
| --- | --- |
| [../docs/handbook/README.md](../docs/handbook/README.md) | Doctrine and the command reference. |
| [../docs/techniques/](../docs/techniques/) | How-tos, including [vault-standard.md](../docs/techniques/vault-standard.md) and [writing-standard.md](../docs/techniques/writing-standard.md). |
| [../docs/adr/](../docs/adr/) | Published ADRs. |
| [../docs/atlas/](../docs/atlas/) | Machine-checked judgment cache. Read a FRESH section as truth. Never copy one here. |
| [../evals/README.md](../evals/README.md) | Regression evals and the calibration channel. |

`docs/techniques/vault-standard.md` is the source of truth for the vault layout. [[Standard]] is a conformance copy of it.

## Current notes

Add a link here when you write a current design, an accepted decision, or a run index.

- [[D-001 adopt vault standard]]
- [[D-002 vault adoption stays voluntary]]
