# The vault standard

Every product or research repo keeps one Obsidian vault, named `<repo>-docs/`, at the repo root. The vault is the single home for design-time judgment: designs, decisions, run notes, and operator notes. This page is the source of truth for the vault layout. Each vault carries a conformance copy as `Standard.md`, stamped with `standard-version`, and the copy defers to this page.

## Why one standard

Three vaults grew three layouts: ripper-docs and proofreports-docs shared a flat folder scheme, and research-docs used numeric prefixes with a promotion rule. The suite's own doc skills wrote dated artifacts to a fourth convention (`docs/<area>/<date>/`). One standard removes the per-repo relearning cost and makes agent behavior repeatable across repos and hosts.

## The base layout

Structural folders carry a two-digit numeric prefix, which fixes the Obsidian sidebar order. Bands: `00` is capture, `10`–`79` is domain content, `80`–`99` is machinery. `00 Inbox/` is machinery despite its number — it is required in every vault, holds no domain content, and is the only folder the standard defines below `10`. A numbered folder anywhere else below `10` is a violation.

| Folder | Holds |
| --- | --- |
| `00 Inbox/` | Capture. File or delete within a day. |
| `10 Design/` | Architecture, specs, API contracts, PR plans. |
| `20 Decisions/` | One accepted choice per note, named `D-NNN short-slug`. |
| `30 Ops/` | Operator how-tos. |
| `80 Runs/` | Dated run folders, `YYYY-MM-DD short-slug/`. |
| `90 Templates/` | New-note templates. |
| `95 Attachments/` | Images and exports. |
| `98 System/` | Vault bookkeeping: `SSOT_MAP`, `OPEN_QUESTIONS`, `DRIFT_REPORT`. |
| `99 Archive/` | Superseded notes, kept, pointing forward. |

Vault root holds `00 Home.md` (the content map), `Standard.md` (the conformance copy), and `README.md`. Frontmatter on every note: `type`, `status` (`draft | current | accepted | superseded`), `updated`, `tags`, plus optional `supersedes`, `superseded-by`, `related` wikilink lists.

## Profiles

A profile is a short section at the end of a vault's `Standard.md`. It may add domain folders in the `10`–`79` band, add note types with named folders, and add frontmatter fields. It may waive a base domain folder with a stated reason. It never waives a machinery folder, never renumbers the machinery band, and never redefines the four core frontmatter fields.

- **Product profile** (ripper, proofreports): the base layout as-is.
- **Research profile** (research): adds `40 Foundations/`, `45 Projects/`, `50 Topics/`, `60 Literature/`, `70 Lab Notebook/` and the note types `project`, `topic`, `literature`, `lab-entry`. Waives `10 Design/`, `20 Decisions/`, and `30 Ops/`: decisions, protocols, results, and claims are canonical only in the repo-root registers, and the vault is a working notebook that promotes into them. Its home note is `Home`, and `lab-entry` notes use the profile status `recorded`, because a dated record is never a draft and never superseded.

A profile declares a status with a fixed phrase: the words "profile status" immediately followed by the value in backticks, as in "`lab-entry` notes use the profile status `recorded`". The checker reads only the token in that position, so backticked note types elsewhere in the sentence declare nothing. A profile may add a status value for a profile-added type. It never adds a status value to the four base types.
- **Code-ops profile** (this repo): the vault holds working design notes and decisions about the marketplace itself. Waives `30 Ops/` (no operated service). The handbook, techniques, ADRs, and atlas stay canonical where they are. `code-ops-docs/80 Runs/` is gitignored, matching the ADR 0001 treatment of `docs/code-ops-run/`.

## Where suite artifacts land in a vault-bearing repo

| Artifact | Home |
| --- | --- |
| Run registers (`FINDINGS_REGISTER.md`, `LEAK_REGISTER.md`, …), `EXECUTIVE_SUMMARY.md`, `DISPATCH_LEDGER.md`, `REPO_MAP.md`, `REFUTATION_LOG.md`, `RUN_RECEIPTS.md`, `HANDOFF.md`, `EGRESS_MANIFEST.md` | `80 Runs/YYYY-MM-DD slug/`, canonical filenames unchanged |
| Doc-alignment outputs (`SSOT_MAP.md`, `DRIFT_REPORT.md`, `OPEN_QUESTIONS.md`) | `98 System/` |
| Decisions from any skill (`adr` output included) | `20 Decisions/D-NNN`, one decision log per repo |
| Design briefs, feature specs, architecture judgment | `10 Design/` |
| Atlas (`MANIFEST.json`, `INBOX.md`, `sections/`) | `docs/atlas/` in the code repo, never the vault |
| Shipped-behavior references (`ARCHITECTURE.md`, `API.md`, `docs/reference/`, runbooks for shipped systems) | The code repo's tracked docs |

The atlas stays out of the vault because `atlas-check.mjs` resolves scope globs against the repo root and decides freshness from git diffs. The vault's `00 Home` links to it.

## Why these artifacts exist

The vault, the atlas, and the tracked reference docs are caches of judgment. Their purpose is cheaper and better output: an agent reads them first and spends its context on the delta, not on re-deriving what a previous session already verified. The consumption rule follows from that purpose. Trust what is mechanically current — a FRESH atlas section, a `current` or `accepted` vault note, a reference doc whose stamp holds — and treat it as truth without re-verification, because the token win exists only if the reader does not re-check. Treat what is stale as a lead, never as fact. Re-deriving from code what a fresh artifact already states is wasted spend; trusting a stale artifact is a decision on a false premise. Both directions are failures.

## The canonical boundary

Three layers, one rule. Code is canonical for behavior. Tracked repo docs are canonical for shipped behavior and machine-checked judgment. The vault is canonical for design-time judgment. When vault content ships or becomes a public claim, promote it to the owning repo doc in the same change and replace the vault detail with a link. Never maintain synchronized copies.

## Host parity

Each vault-bearing repo carries `CLAUDE.md` and `AGENTS.md` in one of two conformance modes: byte-identical copies (the default, the code-ops pattern), or a pointer pair, where one file is the substantive contract and the other is a short pointer that names it as required reading (the research pattern). In both modes the contract contains a documentation section that routes agents to the vault's `Standard.md` routing table. Claude Code reads `CLAUDE.md`, Codex and opencode read `AGENTS.md`, and Grok reads both, so the pair is what makes vault behavior identical across hosts. Wikilinks stay inside the vault; repo docs use standard markdown links, because git hosts do not render wikilinks.

## Decisions and rejected options

- **Numeric prefixes over flat names.** Deterministic sidebar order, proven in research-docs. Folder renames are cheap because wikilinks bind to note names, not paths. Rejected: flat lowercase folders (alphabetical order buries `inbox/` mid-list).
- **Runs unify in the vault.** One dated-run convention replaces three (`runs/` top-level, `99 System/<spike>/`, `docs/<area>/<date>/`). Rejected: keeping runs outside the vault (splits judgment across two trees).
- **Vault decisions are the decision log for personal repos.** Rejected: a parallel `docs/adr/` tree in each repo (two decision logs drift).
- **The vault does not absorb tracked reference docs or the atlas.** Machine-checked artifacts need repo paths, CI citation gates, and git-host rendering. Rejected: vault-as-only-docs-tree (breaks `atlas-check.mjs` and host rendering).
- **Per-vault `Standard.md` stays self-contained.** Agents in target repos have no code-ops checkout. Rejected: a thin pointer file (unreadable offline).

## Migration and conformance

To adopt the standard in a repo: rename folders to the numbered scheme, add the machinery folders, copy the current `Standard.md` body, append the profile section, and bump `standard-version`. Verify links with Obsidian's broken-link check before committing.

Conformance is machine-checked. `node scripts/check-vault-standard.mjs <vault-dir>` is fail-closed and enforces five rules: a versioned `Standard.md` at the vault root, the machinery folders, the reserved 80-99 band, at least one domain folder in the 10-79 band, and `type` / `status` / `updated` frontmatter on every note. `90 Templates/` and the vault-root `README.md` are exempt. `/code-ops-suite:vault` scaffolds, migrates, and checks a vault against the same rules. One follow-up remains: a `SHARED_PASSAGES`-style byte pin that would hold every vault's `Standard.md` copy to the body on this page.

*Verified-at: 14b6e94 (2026-08-18)*
