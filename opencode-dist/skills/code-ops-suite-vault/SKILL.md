---
name: code-ops-suite-vault
description: "Use when a repo needs its Obsidian docs vault created, an existing docs tree migrated into the standard layout, or an existing vault checked for conformance."
---

# Vault: the repo's Obsidian notebook, to one standard

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-vault`, or by the model through the `skill` tool as `code-ops-suite-vault`.** First read the `<plugin-root>/CONVENTIONS.md`
bundled with this plugin: the interaction protocol (`§3`), the safety rails (`§4`), the
single-source-of-truth conventions (`§12`) that decide where a run's artifacts land, and the doc
standard (`§13`). Then read `code-ops-docs/40 Engineering/Techniques/vault-standard.md`, which is
the source of truth for the layout, the profiles, and the promotion rule.
**Mode:** DOCUMENT · **Consumes:** the target repo and its existing docs tree or vault, when it
has one · **Produces:** `<repo>-docs/`, holding the numbered folders, `Standard.md`,
`00 Home.md`, `README.md`, and the templates.

The vault is the repository's complete authored documentation hub. It holds working judgment,
current references, decisions, operations guidance, and generated record indexes. One standard
layout lets an unfamiliar agent predict where every authored topic belongs.

**The checker decides conformance, not a reading.**
`node <plugin-root>/scripts/check-vault-standard.mjs <vault dir>` is fail-closed and
enforces ten rules. It exits 1 on any of these:
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

`90 Templates/`, the vault-root `README.md`, and the canonical suite artifacts (`HANDOFF.md`,
`FINDINGS_REGISTER.md`, and the rest of the artifact table) are exempt from the note rules. Run
the checker before declaring any mode done.

## Authority and immutable records

Code remains canonical for executable behavior. The hub is the only authored documentation
authority. A manifest-v2 record collection may govern immutable evidence at its permanent
historical path without making that tree an authored authority.

Each admission is irreversible, and the collection remains open. Never move, edit, delete, or
rename an admitted record. When its guidance becomes obsolete, append curation metadata and
publish the replacement in the hub. Generated indexes link the preserved bytes to the current
authority.

The authority-batch chain proves immutable membership and provenance. Native authority must bind
a reachable source tree where every admitted path is absent. The curation ledger records status
and supersession. Never merge the chains. An adopted `_archive` path freezes in place and never
moves for archival.

Standard v3 with manifest v1 remains conformant. Standard v4 with manifest v1 remains conformant
without records. Record collections require standard v4 and manifest v2.

## Phase 0: the mode  *(checkpoint)*

Look for `<repo>-docs/` at the repo root. Pick **SCAFFOLD** when it is absent. Pick **MIGRATE**
when the repo has a docs tree holding design-time notes under some other layout. Pick **CHECK**
when a conformant-looking vault already exists. State the mode and the profile you intend to
apply, and confirm both with the developer before writing anything.

## Phase 1: SCAFFOLD

Create `<repo>-docs/` with the machinery folders `00 Inbox/`, `80 Runs/`, `90 Templates/`,
`95 Attachments/`, `98 System/`, and `99 Archive/`, plus the domain folders the profile calls for
in the 10-79 band.

Write `Standard.md` as a self-contained conformance copy of the standard, because an agent in
this repo has no code-ops checkout to read the source page from. Stamp it with
`standard-version`, and close it with a profile section stating every waiver and its reason.

Write `00 Home.md` as the map of content, `README.md` as the git host's entry point, and the
new-note templates. Decide with the developer whether `80 Runs/` is gitignored, and record that
decision in the profile section.

## Phase 2: MIGRATE

Inventory the existing tree before moving anything. Separate ordinary authored documents from
candidate immutable records. Classify every tracked collection file with exactly one manifest
scope. Remove forbidden files before adoption.

Assign the permanent collection UUID, and require complete Git history. Run
`records plan-adoption --out <repo-relative-ignored-path>`. Review every `review-required`
candidate, then record `freeze-current` and a concrete rationale. Run
`records adopt --review <repo-relative-ignored-path>`. Genesis adoption must finish before
authored files move.

Migrate ordinary authored documents in slices, using moves rather than copies. Never move
governed evidence into an archive. Classify an existing `_archive` subtree, and freeze the
admitted paths in place. Add only mechanically eligible generated pointers, or explicitly adopted
tombstones. A classification error requires curation and a new hub document, never byte
rewriting.

Treat protected repository review as the trust root for the receipt. `receiptDigest` is an
unkeyed canonical checksum, not a reviewer signature. Rewrite tolerance assumes that the
resulting tree preserves the receipt authority bytes. Total-history replacement requires an
external signature or a transparency log.

## Phase 3: CHECK

Run the vault and manifest checkers, and repair the repository rather than the gate. When
manifest v2 declares collections, run `records check`. Existing authority failures take
precedence over `pending-admission`. Treat incomplete history separately from evidence loss.

For a committed immutable path in an inventory v2 or v3 collection, run
`records plan-adoption --incremental --out <repo-relative-ignored-path>`. Review the plan, record
the required dispositions, then pass it to `records adopt --review`. An empty delta is a
write-free success. Use `--require-delta` only with `--incremental`, when automation must prove
that it found work. Inventory v1 remains readable but cannot use incremental admission.

For a staged native record with no reachable path history, use `records append`. The first
non-empty v2 authority mutation performs a receipted v3 migration. Never regenerate genesis as a
superset.

All authority writers share one clone-wide collection lock beneath Git's common directory.
Scheduled recovery uses a unique branch in an isolated per-run worktree. Never switch the shared
checkout. Use branch assertion and guaranteed restoration only when worktrees are unavailable. Do
not use `commit-tree` as the default.

Confirm that every immutable object has exactly one authority batch. Confirm that generated
indexes resolve full IDs and current authority links. Keep the authority-batch chain separate
from curation.

## Host parity

The repo's standards-contract pair carries a documentation section routing agents to the vault's
`Standard.md`. Two conformance modes are accepted: a byte-identical pair, or a pointer pair where
one file is the contract and the other names it as required reading. Each host reads the filename
it expects, so a drifted pair makes vault behavior differ by host.
`/code-ops-suite-adopt-standards` owns that contract, so hand it the vault path rather than
editing the contract from here.

## Done when

- `check-vault-standard.mjs`, `docs-manifest.mjs check`, and the applicable `records check` commands pass.
- `Standard.md` is self-contained and versioned.
- Every authored topic has one hub authority.
- Every admitted record retains its indexed bytes, its permanent ID, and its exact authority-batch membership.
- The report names the mode, the profile, the moves, the admitted collections, the reviewed dispositions, the rationales, the generated pointers, and the explicit tombstones.
