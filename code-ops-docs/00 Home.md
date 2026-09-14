---
type: home
status: current
updated: 2026-09-03
tags:
  - meta
---

# 00 Home

This is the map of the code-ops documentation hub. Start here.

## Start by intent

| I want to | Read |
| --- | --- |
| Install the suite and run a first workflow | [Getting started](40%20Engineering/Handbook/01-getting-started.md) |
| Pick the command for a task | [Command router](40%20Engineering/Handbook/commands/README.md) |
| Understand what the suite does to token cost and code size without configuration | [Context and code economy](40%20Engineering/Handbook/12-context-and-code-economy.md) |
| Know how the lead, operatives, and checkpoints work | [Standard operating mode](40%20Engineering/Handbook/11-standard-operating-mode.md) |
| Write anything for this repository | [Writing standard](40%20Engineering/Techniques/writing-standard.md) |
| Check what a script or hook promises, with evidence | [Contracts](35%20Contracts%20and%20Data/CONTRACTS.md) |
| Turn a mechanism off or see what it writes to disk | [Infrastructure](50%20Platform/INFRASTRUCTURE.md) |
| Read the measured cost of the suite | [Measurements](55%20Operations/MEASUREMENTS.md) |
| Fix a run that stalled or a gate that failed | [Recovery and troubleshooting](40%20Engineering/Handbook/10-recovery-and-troubleshooting.md) |

## This hub

`code-ops-docs/` is the only authored documentation hub for the marketplace. It holds shipped references, working designs, decisions, and run notes. [[Standard]] defines the layout and the routing table for new notes. [[D-001 adopt vault standard]] records why this repository adopted it.

Folders:

- `10 Design/` holds design notes, specifications, and pull-request plans.
- `20 Decisions/` holds one accepted choice per note, numbered from `D-001`.
- `30 Architecture/` through `60 Experience/` hold the manifest-owned references.
- `40 Engineering/Handbook/` holds the doctrine chapters and the command references.
- `40 Engineering/Techniques/` holds the standards and the how-to pages.
- `70 Guides/` holds end-to-end journeys.
- `80 Runs/` holds dated run folders. Git ignores it, so run artifacts stay local.
- `90 Templates/` holds the four new-note templates.
- `98 System/` holds the documentation manifest and the atlas.
- `99 Archive/` holds superseded notes, kept, pointing forward.

The code-ops profile waives `30 Ops/`, because this repository operates no service.

## Canonical domains

`[[98 System/DOCS_MANIFEST]]` is the only registry for these domains and their source evidence. Run `node scripts/docs-manifest.mjs check` before trusting a page it owns.

| Tree | Canonical for |
| --- | --- |
| [Handbook](40%20Engineering/Handbook/README.md) | Doctrine chapters and the command references. |
| [Techniques](40%20Engineering/Handbook/README.md#techniques-focused-how-tos) | Standards and methods. |
| [Decisions](20%20Decisions/ADRs/README.md) | Published decision records. |
| [Guides](40%20Engineering/Handbook/README.md#guides-end-to-end-journeys) | End-to-end journeys. |
| [Atlas](98%20System/Atlas/README.md) | Machine-checked judgment cache, with claim-level freshness. |
| [Evals](../evals/README.md) | Regression evals and the calibration channel. |

`40 Engineering/Techniques/vault-standard.md` is the source of truth for the hub layout. [[Standard]] is its conformance copy.

## Current notes

- [Context and code economy 2026-09](10%20Design/Context%20and%20code%20economy%202026-09.md), the design behind the digest, the index, the ladder, and the measurement loop. Every phase shipped on 2026-09-03.
- [[D-001 adopt vault standard]]
- [[D-002 vault adoption stays voluntary]]
