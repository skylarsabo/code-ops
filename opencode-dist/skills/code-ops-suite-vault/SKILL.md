---
name: code-ops-suite-vault
description: "Use when a repo needs its Obsidian docs vault created, an existing docs tree migrated into the standard layout, or an existing vault checked for conformance."
---

# VAULT — The Repo's Obsidian Notebook, to One Standard

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-vault`, or by the model through the `skill` tool as `code-ops-suite-vault`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin — the interaction protocol (`§3`), the safety rails (`§4`), the single-source-of-truth conventions (`§12`) that decide where a run's artifacts land, and the doc standard (`§13`) — and `code-ops-docs/40 Engineering/Techniques/vault-standard.md`, which is the source of truth for the layout, the profiles, and the promotion rule.
**Mode:** DOCUMENT · **Consumes:** the target repo and its existing docs tree or vault, if any · **Produces:** `<repo>-docs/` — the numbered folders, `Standard.md`, `00 Home.md`, `README.md`, and the templates.

The vault is the repository's complete authored documentation hub. It holds working judgment, current references, decisions, operations guidance, and generated record indexes. One standard layout lets an unfamiliar agent predict where every authored topic belongs.

**The checker decides conformance, not a reading.** `node <plugin-root>/scripts/check-vault-standard.mjs <vault dir>` is fail-closed and enforces ten rules. It exits 1 on any of these:

- A `Standard.md` missing from the vault root, or one whose `standard-version` is below the accepted floor.
- A missing `00 Home.md` or `README.md` at the vault root.
- A missing machinery folder, except `80 Runs/`, which only warns.
- A top-level folder with no two-digit numeric prefix.
- A domain folder numbered into the reserved 80-99 band.
- A folder numbered below 10 that is not `00 Inbox/`.
- No domain folder at all in the 10-79 band.
- A note missing `type`, `status`, or `updated`.
- A `status` outside the base vocabulary and the vault's declared profile statuses.
- An `updated` value that is not a YYYY-MM-DD date.

`90 Templates/`, the vault-root `README.md`, and the canonical suite artifacts (`HANDOFF.md`, `FINDINGS_REGISTER.md`, and the rest of the artifact table) are exempt from the note rules. Run the checker before declaring any mode done.

## Authority and immutable records

Code remains canonical for executable behavior. The hub is the only authored documentation authority. A manifest-v2 record collection may govern immutable evidence at its permanent historical path without making that tree an authored authority.

Adoption is irreversible; authority is not. Never move, edit, delete, or rename an adopted record. When its guidance becomes obsolete, append curation metadata and publish the replacement in the hub. Generated indexes link the preserved bytes to the current authority.

Standard v3 with manifest v1 remains conformant. Standard v4 with manifest v1 remains conformant without records. Record collections require standard v4 and manifest v2.

## Phase 0 — Detect the mode *(checkpoint)*
Look for `<repo>-docs/` at the repo root. **SCAFFOLD** if absent. **MIGRATE** if the repo has a docs tree holding design-time notes under some other layout. **CHECK** if a conformant-looking vault already exists. State the mode and the profile you intend to apply, and confirm both with the developer before writing anything.

## Phase 1 — SCAFFOLD
Create `<repo>-docs/` with the machinery folders `00 Inbox/`, `80 Runs/`, `90 Templates/`, `95 Attachments/`, `98 System/`, `99 Archive/`, plus the domain folders the profile calls for in the 10-79 band. Write `Standard.md` as a self-contained conformance copy of the standard — an agent in this repo has no code-ops checkout to read the source page from — stamped with `standard-version` and closing with a profile section that states every waiver and its reason. Write `00 Home.md` as the map of content, `README.md` as the git host's entry point, and the new-note templates. Decide with the developer whether `80 Runs/` is gitignored, and record that decision in the profile section.

## Phase 2 — MIGRATE
Inventory the existing tree before moving anything. Separate ordinary authored documents from candidate immutable records. Classify every tracked collection file with exactly one manifest scope. Remove forbidden files before adoption.

Assign the permanent collection UUID, require complete Git history, then run `records adopt`. Adoption must finish before authored files move. Migrate ordinary authored documents in slices, using moves instead of copies. Add only mechanically eligible generated pointers or explicitly adopted tombstones. A record classification error requires curation and a new hub document, never byte rewriting.

## Phase 3 — CHECK
Run the vault and manifest checkers and repair the repository, never the gate. When manifest v2 declares collections, run `records check` and treat incomplete history separately from evidence loss. Confirm generated record indexes resolve full IDs and current authority links.

## Host parity
The repo's standards-contract pair carries a documentation section routing agents to the vault's `Standard.md`. Two conformance modes are accepted: a byte-identical pair, or a pointer pair where one file is the contract and the other names it as required reading. Each host reads the filename it expects, so a drifted pair makes vault behavior differ by host. `/code-ops-suite-adopt-standards` owns that contract; hand it the vault path rather than editing the contract from here.

## Done when
`check-vault-standard.mjs`, `docs-manifest.mjs check`, and applicable `records check` commands pass. `Standard.md` is self-contained and versioned. Every authored topic has one hub authority. Every adopted record retains its indexed bytes and permanent ID. The report names the mode, profile, moves, adopted collections, generated pointers, and explicit tombstones.
