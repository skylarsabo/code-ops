# Atlas

The atlas is a per-repo cache of what a run had to work out about a codebase, checked into
that repo, with the "is it still true?" question answered mechanically. Read it if you run
the suite against the same repo more than once, or if you write a section. This page is
the source of truth for the artifact's shape, its checker, and its trust doctrine.

Every run on a repo pays the same entry cost: work out how the thing is shaped, which
parts are load-bearing, and which code looks wrong and is deliberate. The run ends, the
understanding evaporates, and the next run pays again. A README does not fix that, because
a README carries no way to say whether it is still true. So a careful reader re-derives it
anyway, and an incautious one trusts prose written against a tree that has since moved.

The atlas banks that understanding as a durable artifact. It is the first concrete piece
of the movement graph, the per-repo context manifest named in
[calibration-graph.md](calibration-graph.md). The workflow that writes it is
`/code-ops-suite:atlas`.

## Layout

```
code-ops-docs/98 System/Atlas/MANIFEST.json      machine index: the ONLY place stamps and scopes live
code-ops-docs/98 System/Atlas/INBOX.md           append-only dated observations, consolidated periodically
code-ops-docs/98 System/Atlas/sections/<slug>.md judgment prose, one file per section
```

Fallback: `<repo-root>/atlas/` when the repo has no `docs/` directory. The atlas lives in
the repo it describes and is checked in with it. A cache outside the tree it is stamped
against cannot be invalidated by that tree's commits.

## Manifest schema

```json
{
  "version": 1,
  "sections": [
    { "slug": "<kebab>", "file": "sections/<slug>.md", "scope": ["<glob>"],
      "verifiedAt": "<7-40 char lowercase git sha, or \"unverified\">",
      "verifiedDigest": "<sha256, optional>",
      "claims": [ { "file": "<repo-relative>", "line": 42,
                    "anchor": "<verbatim substring, optional>" } ] }
  ]
}
```

- `slug`: unique, kebab-case.
- `file`: must exist, relative to the atlas directory.
- `scope`: non-empty git-pathspec-style globs, relative to the repo root rather than the
  atlas directory. Scope is what the section claims to be about, and therefore what can
  invalidate it.
- `verifiedAt`: an immutable object name, lowercase hex, 7 to 40 characters. The single
  exception is the placeholder `"unverified"`, which `add` writes for a section nobody has
  stamped yet. Anything else is a schema violation and fails the manifest closed: `HEAD`,
  `@`, a branch name, or a tag. A moving ref re-resolves on every run, so a section pinned
  to one is diffed against the present and can never be reported stale. Shape alone is not
  enough. A branch or tag named like a sha (`deadbeef`) passes the shape test, and
  `git rev-parse` prefers refs over abbreviated object names, so that pin would move too.
  Every value claimed to be a pin is therefore checked again at resolution time. The full
  sha it resolves to must extend the value given, and a hex-named ref fails closed the same
  way `HEAD` does, in `check` and in `stamp --at` alike. A well-formed legacy sha that does
  not resolve stays STALE, never an error that hides the section. A digest-backed section
  can remain FRESH when its diagnostic commit no longer resolves.
- `verifiedDigest`: optional SHA-256 for a default stamp. It hashes the versioned, exact
  scope declarations plus separately framed raw staged-index and raw index-to-worktree
  tracked state. The atlas tree and untracked files are excluded. The digest preserves a
  trustworthy freshness result when a squash or branch deletion makes `verifiedAt`
  unreachable.
- `claims`: optional and machine-written. One entry per `path:line` citation in the
  section's prose, in document order, with an `anchor` copied verbatim from the cited line
  at stamp time: trimmed, backtick-free, at most 80 characters. A credential-shaped line
  records the `<REDACTED-LINE>` sentinel instead of its own text. A line that yields no
  usable substring records no anchor and is checked for existence only. A malformed entry
  fails the manifest closed, like every other schema rule here.

The manifest is the only place a stamp or a scope lives. Sections carry no metadata of
their own, so there is no second copy to drift.

## Checker modes

`scripts/atlas-check.mjs` is vendored into `plugins/code-ops-suite/scripts/`, because it
runs inside target repos through `${CLAUDE_PLUGIN_ROOT}`, and it uses `node:` builtins
only. Reach the `check` mode as `co atlas check`, which inserts the `check` subcommand when
the caller supplies none. The exit contract across all six modes is `0` clean, `1`
violation or gated, and `2` usage.

| Mode | Behavior and exit contract |
| --- | --- |
| `init --atlas <dir>` | scaffolds an empty `MANIFEST.json`, `INBOX.md`, and `sections/`. **Refuses to overwrite** an existing manifest |
| `add --atlas <dir> --section <slug> --scope <pathspec> [--scope ...]` | registers a new section: appends a manifest entry pinned to `"unverified"` and writes a `sections/<slug>.md` stub with its title and a charter placeholder. `--scope` is repeatable. Refuses a duplicate slug, a non-kebab slug, a scope using pathspec magic, or an existing prose file. The section is **STALE until stamped**, which is the point: `add` registers the intent, `stamp` asserts the verification |
| `check --atlas <dir> [--root <repo>] [--gate] [--claims-gate] [--stats]` | A matching `verifiedDigest` is FRESH, even when a squash or branch deletion makes `verifiedAt` unreachable. A mismatched or unavailable digest is always STALE. The checker uses `verifiedAt` only for changed-path diagnostics. Legacy sections without a digest retain commit-diff freshness. A dead scope is STALE. The atlas tree stays outside the diff and sweep. Each section's claim report prints beneath its verdict. Exit 0 is report-only. `--gate` exits 1 on STALE. `--claims-gate` exits 1 on any claim the classifier did not call FRESH. `--stats` adds the git subprocess count, for measuring the check's own cost. Malformed manifest data always exits 1 |
| `stamp --atlas <dir> --section <slug> [--root <dir>] [--at <sha>]` | The default writes `verifiedAt` and `verifiedDigest`. It requires no scoped unstaged changes. It rejects unmerged, assume-unchanged, skip-worktree, and submodule checkout ambiguity. Scoped diffs override `diff.ignoreSubmodules`. `--at` is historical mode. It writes `verifiedAt` and clears `verifiedDigest`. Both modes rewrite `claims` from the section's current prose. The tool is the only stamp writer |
| `scope <slug> --atlas <dir> --suggest [--root <dir>]` | prints the tracked files that import the section's current scope at depth 1, read from `context-query.mjs blast --json`, as a pathspec list for `add --scope`. It writes nothing. Suggesting is its only mode. A missing symbol index exits 1 naming the refresh command |
| `inbox --atlas <dir> --note <text> [--root <dir>]` | appends `- <YYYY-MM-DD> <short-sha>: <text>` to `INBOX.md`, one line, and refuses an empty note |

`check` also runs a coverage sweep. Every tracked top-level path matched by no section's
scope prints as an `unmapped` advisory, where a top-level path is the first path segment
of `git ls-files`. The atlas's own tree is excluded from both sides, since it neither needs
coverage nor grants it. The advisory stays advisory even under `--gate`. An unmapped
directory is a scoping todo, not a false claim of freshness, and gating on it would train
people to write junk scopes that match everything.

The manifest is machine-written on purpose. Between them, `add` and `stamp` cover every
edit it needs: registering a section, and asserting a verification. So there is no
remaining reason to open it by hand. Hand-editing a stamp is the one edit that turns the
artifact from a cache into a liability. The section then reads as verified against a
commit nobody verified it against, and no check downstream can tell.

## Trust doctrine

- A **FRESH** section is consumed as truth, without re-verification. That is the entire
  token win. If a reader re-checks a FRESH section, the atlas has cost more than it saved.
- A **STALE** section is a lead, not a fact. An operative may read one for orientation, but
  every claim it takes from one is re-verified against current code before use.
- The FRESH and STALE listing travels with the brief, alongside the repo-map pointer, so
  the operative knows which half it is holding. A section handed over without its freshness
  state is unusable at either extreme: trusted when it should not be, or re-derived when it
  need not be.
- Freshness is fail-safe in one direction only. For a digest-backed section, a mismatch or
  an unavailable digest resolves to STALE. Legacy sections with no digest use the commit
  diff. Every other ambiguous case resolves to STALE too: an unresolvable legacy sha, the
  `unverified` placeholder, or a scope that cannot be evaluated. The cost of a wrong STALE
  is one re-derivation. The cost of a wrong FRESH is a decision made on a false premise.
- A default stamp hashes only the exact scoped tracked state. It frames staged-index and
  index-to-worktree state separately. It excludes the atlas and untracked files. Stage
  scoped work before stamping. The tool rejects ambiguous Git index flags instead of
  guessing.

### Claims

The digest answers a whole-section question: did anything in scope move. A section scoped
at a whole tree therefore goes STALE on any commit to it, and a reader re-verifies every
sentence to recover the few that changed. A claim answers the finer question. Is this one
sentence still true?

A claim is a `path:line` citation in a section's own prose. `stamp` records one per
citation with an anchor copied from the cited line, and `check` classifies them through
`revalidate-register.mjs`, the classifier findings registers already use. The statuses are
that classifier's: FRESH, MOVED, DRIFTED, and GONE. Reusing it is the point. Two freshness
mechanisms become one, and the atlas cannot disagree with a register about what a drifted
citation is.

The two verdicts are independent, and both directions carry information:

- A FRESH digest with a drifted claim is a lead, not a proof. Nothing in scope moved that
  the digest could see, and a cited line still moved out from under the prose. The cause is
  an edit staged and reverted, a file the scope does not cover, or a citation that was
  wrong when it was written. Re-read that line before using the sentence that cites it.
- A STALE digest with every claim FRESH is the case the mechanism exists for. The section
  is out of date as a whole and its cited sentences still hold, so a reader takes those and
  re-derives only the rest.

`--claims-gate` turns any non-FRESH claim into exit 1. It is opt-in and separate from
`--gate`, because the two gates answer different questions and a run may want either, both,
or neither. A claim the classifier could not reach is not FRESH and gates like any other,
fail-safe, in the same direction as every other ambiguous case here.

A section that cites nothing reports `claims: none`. That is a fact about the section, not
a failure. Judgment prose is not required to carry citations, and a section is not made
better by inventing them. Citations earn their place where a sentence rests on one exact
line.

## Update in the hot session

A section is refreshed by the change that invalidated it, in the session that made the
change. That is why `/code-ops-suite:ship` runs `check` in its closing phase. The rationale
behind a diff is available for about as long as the session that produced it. A week later
the same author is reconstructing it from the diff like anyone else. Deferring the atlas
update to a docs pass converts free knowledge into expensive knowledge.

When a full section rewrite is genuinely out of scope, append an `inbox` note and leave the
section STALE. Stage scoped work before a default stamp. Use `--at` only when recording
history. Historical mode clears the digest. Stamping to clear a report is the failure mode
this design prevents.

## Judgment, not facts

A section holds what a run had to work out: architecture rationale, cross-file flows,
invariants, gotchas, and code that looks wrong and is load-bearing. It holds no file
inventories, export lists, or signatures. Those are re-derivable in seconds by search and
rot on the next rename, and a section with three stale signatures in it stops being
believed as a whole.

**Conforming** (a `payments` section):

> Refunds run through the same state machine as charges, one step further along. The
> duplicate-looking `settle()` in the refund path exists because refunds settle against
> the original processor account, which the charge path resolves earlier and caches.
> Anything that unifies the two paths has to keep that resolution order.

**Non-conforming**, the same section with facts instead of judgment:

> `src/payments/` holds `charge.ts`, `refund.ts`, `settle.ts`, and `types.ts`.
> `charge.ts` exports `createCharge(amount: Money, account: AccountId): Promise<Charge>`
> and `voidCharge(id: ChargeId): Promise<void>`.

The second is re-derivable in one search, wrong the first time a file is renamed, and
tells a reader nothing they would not have learned faster from the code.

## Append, then consolidate

Mid-run observations go to `INBOX.md` through the `inbox` subcommand. Appending is cheap
and conflict-free, and it never requires deciding which section owns something at the
moment you are busy with something else. Consolidation is a separate, deliberate pass:

1. Fold each entry into the section that owns it.
2. Rewrite so the section reads as one considered account rather than an accreted log.
3. Clear the folded entries.
4. Stamp what was touched.

An observation that fits no section is the signal to add one.

*Verified-at: b0ffede*
