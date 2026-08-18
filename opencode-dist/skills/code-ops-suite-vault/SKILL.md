---
name: code-ops-suite-vault
description: "Use when a repo needs its Obsidian docs vault created, an existing docs tree migrated into the standard layout, or an existing vault checked for conformance."
---

# VAULT — The Repo's Obsidian Notebook, to One Standard

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-vault`, or by the model through the `skill` tool as `code-ops-suite-vault`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin — the interaction protocol (`§3`), the safety rails (`§4`), the single-source-of-truth conventions (`§12`) that decide where a run's artifacts land, and the doc standard (`§13`) — and `docs/techniques/vault-standard.md`, which is the source of truth for the layout, the profiles, and the promotion rule.
**Mode:** DOCUMENT · **Consumes:** the target repo and its existing docs tree or vault, if any · **Produces:** `<repo>-docs/` — the numbered folders, `Standard.md`, `00 Home.md`, `README.md`, and the templates.

A vault is where a repo's design-time judgment lives: designs, decisions, run notes, operator notes. One standard layout across every repo is the whole point — an agent that has never opened this vault can still predict where a note goes and what its frontmatter says. So the layout is not a per-repo preference, and this skill never invents a variant of it.

**The checker decides conformance, not a reading.** `node <plugin-root>/scripts/check-vault-standard.mjs <vault dir>` is fail-closed: it exits 1 on a missing machinery folder, a domain folder numbered into the reserved 80-99 band, a `Standard.md` with no `standard-version`, or a note missing `type` / `status` / `updated`. Run it before declaring any mode done.

## The boundary rule — what does NOT move into the vault
Code is canonical for behavior. Tracked repo docs are canonical for shipped behavior and machine-checked judgment: reference trees, published ADRs, runbooks for shipped systems, and `docs/atlas/` (its freshness check needs repo-root scopes and git history, so it never moves). The vault is canonical for design-time judgment only. When vault content ships or becomes a public claim, promote it to the owning repo doc in the same change and leave a link behind. Never maintain two synchronized copies — that is the failure the boundary exists to prevent.

## Phase 0 — Detect the mode *(checkpoint)*
Look for `<repo>-docs/` at the repo root. **SCAFFOLD** if absent. **MIGRATE** if the repo has a docs tree holding design-time notes under some other layout. **CHECK** if a conformant-looking vault already exists. State the mode and the profile you intend to apply, and confirm both with the developer before writing anything.

## Phase 1 — SCAFFOLD
Create `<repo>-docs/` with the machinery folders `00 Inbox/`, `80 Runs/`, `90 Templates/`, `95 Attachments/`, `98 System/`, `99 Archive/`, plus the domain folders the profile calls for in the 10-79 band. Write `Standard.md` as a self-contained conformance copy of the standard — an agent in this repo has no code-ops checkout to read the source page from — stamped with `standard-version` and closing with a profile section that states every waiver and its reason. Write `00 Home.md` as the map of content, `README.md` as the git host's entry point, and the new-note templates. Decide with the developer whether `80 Runs/` is gitignored, and record that decision in the profile section.

## Phase 2 — MIGRATE
Read the existing tree first and classify every file into one of three destinations: stays in the code repo (reference docs, published ADRs, the atlas), moves into a numbered vault folder, or is superseded and belongs in `99 Archive/` with a `superseded-by` pointer. Move rather than copy, so no file ends up in two trees. Then rename folders to the numbered scheme, add the frontmatter each note lacks, and rewrite intra-vault references as `[[Note name]]` wikilinks while leaving links that point at repo docs as ordinary markdown paths — git hosts do not render wikilinks. Verify links with Obsidian's broken-link check before finishing. A migration that silently drops a note is worse than one that leaves it in `00 Inbox/`.

## Phase 3 — CHECK
Run the checker and repair the vault, never the checker. A warning about an absent `80 Runs/` is expected in a repo that gitignores it and is a real gap anywhere else. Then read the two things no checker can judge: whether `00 Home.md` still links every current design, decision, and run index, and whether any vault note has become a public claim that should have been promoted into a tracked repo doc.

## Host parity
The repo's `AGENTS.md` and `AGENTS.md` carry a documentation section routing agents to the vault's `Standard.md`. Two conformance modes are accepted: a byte-identical pair, or a pointer pair where one file is the contract and the other names it as required reading. opencode reads `AGENTS.md`, Codex and opencode read `AGENTS.md`, and Grok reads both, so a drifted pair makes vault behavior differ by host. `/code-ops-suite-adopt-standards` owns that contract; hand it the vault path rather than editing the contract from here.

## Done when
`check-vault-standard.mjs` exits 0 against the vault; `Standard.md` is self-contained, versioned, and states every profile waiver with its reason; `00 Home.md` links every current design, decision, and run index; no file exists in both the vault and a tracked repo doc; and the report names the mode run, the profile applied, and every file moved or left behind.
