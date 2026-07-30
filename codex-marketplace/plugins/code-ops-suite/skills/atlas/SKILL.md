---
name: atlas
description: "Use when a repo's atlas — its durable, per-repo cache of judgment about the codebase — needs to be created, refreshed after the code moved, or consolidated from inbox observations. Freshness is decided mechanically by atlas-check.mjs; see docs/techniques/atlas.md."
---

# ATLAS — The Repo's Durable Cache of Judgment

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:atlas`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin — the operating model (`§1`), the evidence standard (`§9`), and the single-source-of-truth conventions (`§12`) that this skill extends from one run's artifacts to a durable artifact the repo keeps — and `docs/techniques/atlas.md` for the manifest schema, the checker's modes, and the trust doctrine.
**Mode:** DOCUMENT · **Consumes:** the target repo and its existing atlas, if any · **Produces:** `docs/atlas/` (fallback `atlas/` when the repo has no docs directory) — `MANIFEST.json`, `INBOX.md`, and one `sections/` file per section.

An atlas is what the previous run should have remembered and did not. Every future run pays to re-derive the same understanding of a repo; the atlas is where that understanding is banked so it can be read instead of rebuilt. It only pays off if a reader can trust it without re-deriving it, so each section carries a `verifiedAt` commit and the checker decides freshness against the diff since that commit — trust is mechanical here, never a reader's guess.

**The tool owns the manifest.** `<plugin-root>/scripts/atlas-check.mjs` writes every part of it — `add` registers a section, `stamp` is the only sanctioned writer of `verifiedAt`. `MANIFEST.json` is never hand-edited; that is how a section that has gone stale keeps claiming to be current.

## The content rule — judgment, not facts
A section holds what costs a run real time to work out: why the architecture is shaped this way, how a flow crosses files, the invariants a change must not break, the gotchas, the code that looks wrong and is load-bearing. It holds **no** file inventories, export lists, or signatures — a reader re-derives those in seconds with a search, and they rot on the next rename, dragging the section's credibility down with them. Each section opens with a `#` title and a one-line charter naming what it covers and what it deliberately leaves out.

## Phase 0 — Locate and check *(checkpoint on INIT only)*
Find the atlas directory; if none exists, this run is an INIT. Otherwise run `node <plugin-root>/scripts/atlas-check.mjs check --atlas <atlas dir>` and read its report: per-section FRESH or STALE with the paths that triggered it, plus any unmapped top-level paths. A malformed manifest exits non-zero and stops the run — repair the manifest before anything else, since every trust decision below rests on it. Pick the phase the state calls for: INIT, REFRESH, or CONSOLIDATE. All three are idempotent; re-running one changes nothing that is already correct.

## Phase 1 — INIT (first run in a repo)
Run the checker's `init` subcommand to scaffold the manifest, inbox, and sections directory; it refuses to overwrite an existing manifest, so an accidental INIT over a live atlas cannot destroy it.

Then design the sectioning yourself — this is the judgment call the whole artifact rests on. Aim for **4-10 sections**, each a coherent area a reader would want explained rather than a directory transcribed, with scope globs that between them cover every top-level path in the repo. The coverage sweep in `check` is the verifier: an unmapped top-level path means the sectioning missed something.

Register each designed section with `add --atlas <dir> --section <slug> --scope <pathspec>` (repeat `--scope` for each glob); it writes the manifest entry and a stub file pinned `unverified`, so every new section reports STALE until it has been written and stamped. Then dispatch explorer operatives across disjoint areas to gather the raw understanding (`§1`), write each section's prose over its stub under the content rule above, and only then `stamp` each one at HEAD — the stamp asserts *this prose was checked against that commit*, so it is the last step, never the first.

## Phase 2 — REFRESH (the default)
For each **STALE** section, and only those: read the triggering diff paths first — the change that invalidated the section is usually itself the update — then rewrite the section and `stamp` it. **FRESH sections are not reopened**; re-reading them is exactly the cost the atlas exists to avoid, and a rewrite with no new input is a chance to lose accumulated judgment. A section whose triggering diff turns out not to affect its claims still gets stamped: it was verified against that commit, which is what the stamp asserts.

If a section's rewrite is genuinely out of scope for this run, append the observation to the inbox with the `inbox` subcommand and leave the section STALE. A STALE section is honest; a stamped section that nobody re-verified is a lie the checker can no longer catch.

## Phase 3 — CONSOLIDATE (when the inbox has entries)
Fold each observation into the section that owns it, rewriting the prose so the section reads as one considered account rather than an accreted log. Remove the folded entries from the inbox and stamp every section touched. Anything that fits no section is the signal to add one — or evidence the sectioning needs revisiting.

## Done when
`check` reports every section FRESH with no unmapped advisories — or the remaining unmapped paths are listed in the report with the reason they have no section yet; the inbox holds no unfolded entry older than this run; and the report names each section touched and why it was touched.
