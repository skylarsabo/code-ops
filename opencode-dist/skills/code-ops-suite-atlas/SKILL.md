---
name: code-ops-suite-atlas
description: "Use when a repo's atlas needs to be created, refreshed after the code moved, or consolidated from inbox observations. The atlas is the repo's durable cache of judgment about the codebase. Freshness is decided mechanically by atlas-check.mjs. See code-ops-docs/40 Engineering/Techniques/atlas.md."
---

# ATLAS: The Repo's Durable Cache of Judgment

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-atlas`, or by the model through the `skill` tool as `code-ops-suite-atlas`.** First read the `<plugin-root>/CONVENTIONS.md`
bundled with this plugin: the operating model (`§1`), the evidence standard (`§9`), and the
single-source-of-truth conventions (`§12`) that this skill extends from one run's artifacts to a
durable artifact the repo keeps. Then read
`code-ops-docs/40 Engineering/Techniques/atlas.md` for the manifest schema, the checker's
modes, and the trust doctrine.
**Mode:** DOCUMENT · **Consumes:** the target repo and its existing atlas, when it has one ·
**Produces:** `code-ops-docs/98 System/Atlas/`, falling back to `atlas/` when the repo has no
docs directory, holding `MANIFEST.json`, `INBOX.md`, and one `sections/` file per section.

An atlas is what the previous run should have remembered and did not. Every future run pays to
re-derive the same understanding of a repo. The atlas banks that understanding so a reader can
reuse it. A default stamp records `verifiedAt` and a scope-state `verifiedDigest`. The digest
makes freshness survive a squash or a deleted branch.

**The tool owns the manifest.** `<plugin-root>/scripts/atlas-check.mjs` writes every
part of it. `add` registers a section. `stamp` is the only sanctioned writer of `verifiedAt`,
`verifiedDigest`, and the `claims` it derives from a section's `path:line` citations. Never edit
`MANIFEST.json` by hand.

`check --claims-gate` exits 1 when a citation no longer sits on the code it names, so a section
that is fresh as a whole cannot carry a sentence that quietly stopped being true.
`scope <slug> --suggest` prints the depth-1 importers of a section's scope as a pathspec list
for `add --scope`, so a scope can follow a module boundary instead of a directory name. It
writes nothing.

## The content rule: judgment, not facts

A section holds what costs a run real time to work out: why the architecture is shaped this way,
how a flow crosses files, the invariants a change must not break, the gotchas, and the code that
looks wrong but is load-bearing. It holds **no** file inventories, export lists, signatures, or
copied evidence bodies. Cite registered evidence by record ID, and let its generated index
resolve the preserved bytes. Open each section with a `#` title and a one-line charter naming
what the section covers and what it deliberately leaves out.

## Phase 0: the atlas state  *(checkpoint on INIT only)*

Find the atlas directory. When none exists, this run is an INIT. Otherwise run
`node <plugin-root>/scripts/atlas-check.mjs check --atlas <atlas dir>` and read its
report: per-section FRESH or STALE with the paths that triggered each verdict, plus any unmapped
top-level paths. A malformed manifest exits non-zero and stops the run. Repair the manifest
before anything else, since every trust decision below rests on it. Pick the phase the state
calls for: INIT, REFRESH, or CONSOLIDATE. All three are idempotent, so re-running one changes
nothing that is already correct.

## Phase 1: INIT, the first run in a repo

Run the checker's `init` subcommand to scaffold the manifest, the inbox, and the sections
directory. It refuses to overwrite an existing manifest, so an accidental INIT over a live atlas
cannot destroy it.

Then design the sectioning yourself. That design is the judgment call the whole artifact rests
on. Aim for **4-10 sections**. Make each one a coherent area a reader would want explained,
rather than a directory transcribed, with scope globs that between them cover every top-level
path in the repo. The coverage sweep in `check` is the verifier: an unmapped top-level path
means the sectioning missed something.

Register each designed section with
`add --atlas <dir> --section <slug> --scope <pathspec>`, repeating `--scope` for each glob. It
writes an `unverified` stub, which remains STALE until stamped. Write the section after the
investigation. Stage the scoped changes before the default `stamp`. A default stamp rejects
scoped unstaged changes and Git index ambiguity. Use `--at` only for a historical stamp, which
clears the digest.

## Phase 2: REFRESH, the default

For each **STALE** section, and only those, read the diagnostic paths first. Rewrite the section
and stage its scoped changes. Then run the default `stamp`. **FRESH** sections are not reopened,
because re-reading a FRESH section defeats the token value of the atlas. A stale digest remains
stale even when the diagnostics show no path.

When a section's rewrite is genuinely out of scope for this run, append the observation to the
inbox with the `inbox` subcommand and leave the section STALE. A STALE section is honest. A
stamped section that nobody re-verified is a lie the checker can no longer catch.

## Phase 3: CONSOLIDATE, when the inbox has entries

Fold each observation into the section that owns it, rewriting the prose so the section reads as
one considered account rather than an accreted log. Remove the folded entries from the inbox and
stamp every section touched. Anything that fits no section is the signal to add one, or evidence
that the sectioning needs revisiting.

## Done when

- `check` reports every section FRESH with no unmapped advisories, or the remaining unmapped paths are listed in the report with the reason they have no section yet.
- The inbox holds no unfolded entry older than this run.
- The report names each section touched and why it was touched.
