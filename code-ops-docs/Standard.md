---
type: standard
status: current
updated: 2026-08-18
standard-version: 2
tags:
  - meta
  - standard
---

# Notebook standard

`code-ops-docs/` is the Obsidian vault for this repo. It is the home for design, decisions, run notes, and operator notes.

This file is a conformance copy of the shared vault standard. The source of truth is `docs/techniques/vault-standard.md` in the code-ops repo. When the two disagree, the code-ops copy wins. Update this copy in the same change.

## Open the vault

In Obsidian: **Open folder as vault** → `code-ops-docs/` (this folder, not the repo root).

## Folders

Structural folders carry a two-digit numeric prefix. The prefix fixes the sidebar order. Bands: `00` is capture, `10`–`79` is domain content, `80`–`99` is machinery.

| Folder | Holds | Do not put here |
| --- | --- | --- |
| `00 Inbox/` | Unsorted notes. File or delete within a day. | Finished design |
| `10 Design/` | Architecture, specs, API contracts, PR plans | Daily scratch |
| `20 Decisions/` | One accepted choice per note (ADR) | Open debate |
| `30 Ops/` | How to start, pair, package, and operate — waived in this profile | Product design |
| `80 Runs/` | Dated research, ship, review, and spike artifacts | Living specs |
| `90 Templates/` | New-note templates only | Content |
| `95 Attachments/` | Images and exports linked from notes | Source code |
| `98 System/` | Vault bookkeeping: `SSOT_MAP`, `OPEN_QUESTIONS`, `DRIFT_REPORT` | Domain content |
| `99 Archive/` | Superseded notes. Keep the file. Add `superseded-by`. | Current truth |

A profile may add domain folders in the `10`–`79` band and may waive a base domain folder with a stated reason. It never waives a machinery folder and never renumbers the machinery band.

## Note types

Set `type` in YAML on every note.

| `type` | Folder | Name |
| --- | --- | --- |
| `home` | vault root | `00 Home` |
| `standard` | vault root | `Standard` |
| `design` | `10 Design/` | Short title, Title Case |
| `decision` | `20 Decisions/` | `D-NNN short-slug` |
| `ops` | `30 Ops/` — waived in this profile | Verb or surface (`Start Studio`) |
| `run` | `80 Runs/YYYY-MM-DD short-slug/` | One folder per run |
| `inbox` | `00 Inbox/` | Free |
| `system` | `98 System/` | UPPER_SNAKE for tool outputs |
| `archive` | `99 Archive/` | Keep the old name |

Profiles may add types (`topic`, `literature`, `lab-entry`, `project`). Each added type names its folder in the profile section below.

## Frontmatter

Every note:

```yaml
---
type: design
status: draft | current | accepted | superseded
updated: YYYY-MM-DD
tags: []
---
```

Optional: `supersedes`, `superseded-by`, `related` as wikilink lists. Profiles may add fields (`project_id`, `canonical_status`, `notebook_status`) but never redefine the four core fields. Use only the four `status` values above.

## Writing

- One subject per note. Split a file that covers two products or two decisions.
- Link with `[[Note name]]`. Do not use repo-relative `docs/...` paths for vault notes.
- Cite code as `` `packages/.../file.py` `` plus a symbol name. Do not paste secrets.
- Follow the house writing standard: active voice, one term per concept, short sentences.
- Status `current` or `accepted` is the source of truth. A `superseded` note moves to `99 Archive/` and points forward.

## Where new work goes

| Work | Put it |
| --- | --- |
| Architecture or spec | `10 Design/` from [[Design]] |
| A locked choice | `20 Decisions/` from [[Decision]] |
| A spike, ship, or review | `80 Runs/YYYY-MM-DD slug/` from [[Run]] |
| Doc-alignment output (`SSOT_MAP`, `DRIFT_REPORT`, `OPEN_QUESTIONS`) | `98 System/` |
| Unsure | `00 Inbox/`, then file the same day |

Agents follow this table. They do not invent a second docs tree.

## Runs

A run is a dated folder, not a single file. The index note carries the folder's name.

```
80 Runs/2026-08-18 parse and perf/
  2026-08-18 parse and perf.md   # purpose, commits, outcome
  TRACE_PARSE.md
  TRACE_PERF.md
```

Agent-run artifacts keep their canonical code-ops filenames inside the run folder: `FINDINGS_REGISTER.md`, `EXECUTIVE_SUMMARY.md`, `DISPATCH_LEDGER.md`, `REPO_MAP.md`, `REFUTATION_LOG.md`, `RUN_RECEIPTS.md`, `HANDOFF.md`, `EGRESS_MANIFEST.md`. Orchestrated runs in this repo write their dated artifacts here, not to a separate `docs/<area>/<date>/` tree. Link the index note from [[00 Home]].

## Decisions

Number from `D-001`. The note records the choice, the rejected options, and the date. Design notes link to decisions. They do not re-argue them.

## Canonical boundary

Three layers, one rule:

| Layer | Canonical for |
| --- | --- |
| Code | Behavior |
| Tracked repo docs (reference trees, atlas, published ADRs) | Shipped behavior and machine-checked judgment |
| This vault | Design-time judgment: designs, decisions, runs, learning |

When vault content ships or becomes a public claim, promote it to the owning repo doc in the same change. Replace the vault detail with a link to the promoted artifact. Never maintain synchronized copies.

The atlas (`docs/atlas/` in the code repo) never moves into the vault. Its freshness check needs repo-root scopes and git history. [[00 Home]] links to it.

If a vault note and the code disagree, the code wins for behavior. Fix the note in the same change.

## Git

Commit notes, templates, and `.obsidian/app.json` / `core-plugins.json` / `appearance.json`.

Do not commit:

- `.obsidian/workspace.json`
- `.obsidian/workspace-mobile.json`
- `.obsidian/cache`
- `.trash/`

No secrets, tokens, or PEM contents in any note.

## Home

[[00 Home]] is the map of content. When you add a current design, decision, or run, add a link on Home.

## Profile

### Code-ops (code-ops profile)

The vault holds working design notes and decisions about the marketplace itself. Waived: `30 Ops/` (no operated service).

Canonical trees stay canonical: `docs/handbook/` (doctrine), `docs/techniques/` (how-tos), `docs/adr/` (published ADRs), `docs/atlas/` (machine-checked judgment). A vault design note that matures into doctrine is promoted into those trees and replaced with a link. `20 Decisions/` records working decisions that do not warrant a published ADR. When one does, promote it to `docs/adr/` and archive the vault note with `superseded-by`.

`80 Runs/` is gitignored (ADR 0001 treatment, same as `docs/code-ops-run/`): run artifacts stay local.
