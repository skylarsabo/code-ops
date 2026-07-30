# Atlas

Every run on a repo pays the same entry cost: work out how the thing is shaped, which
parts are load-bearing, which code looks wrong and is deliberate. The run ends, the
understanding evaporates, the next run pays again. A README does not fix this, because a
README carries no way to say *whether it is still true* — so a careful reader re-derives
it anyway and an incautious one trusts prose written against a tree that has since moved.

The atlas is that understanding banked as a durable per-repo artifact, with the
"still true?" question answered mechanically. It is the first concrete piece of the
movement graph — the per-repo context manifest named in
[calibration-graph.md](calibration-graph.md). This page is the SSOT for its shape; the
workflow that writes it is `/code-ops-suite:atlas`.

## Layout

```
docs/atlas/MANIFEST.json      machine index — the ONLY place stamps and scopes live
docs/atlas/INBOX.md           append-only dated observations, consolidated periodically
docs/atlas/sections/<slug>.md judgment prose, one file per section
```

Fallback: `<repo-root>/atlas/` when the repo has no `docs/` directory. The atlas lives
in the repo it describes and is checked in with it — a cache outside the tree it is
stamped against cannot be invalidated by that tree's commits.

## Manifest schema

```json
{
  "version": 1,
  "sections": [
    { "slug": "<kebab>", "file": "sections/<slug>.md", "scope": ["<glob>"],
      "verifiedAt": "<full or 7+ char git sha>" }
  ]
}
```

- `slug` — unique, kebab-case.
- `file` — must exist, relative to the atlas directory.
- `scope` — non-empty; git-pathspec-style globs relative to the **repo root**, not the
  atlas directory. Scope is what the section claims to be about, and therefore what can
  invalidate it.
- `verifiedAt` — a commit that `rev-parse` resolves in this repo. An unknown or
  unparseable sha makes the section **STALE**, never an error that hides it: a stamp
  nobody can resolve is exactly the case where trusting the section is most dangerous.

The manifest is the only place a stamp or a scope lives. Sections carry no metadata of
their own, so there is no second copy to drift.

## Checker modes

`scripts/atlas-check.mjs` (vendored into `plugins/code-ops-suite/scripts/`, since it runs
inside target repos via `${CLAUDE_PLUGIN_ROOT}`; `node:` builtins only). Exit contract
across all four: `0` clean, `1` violation-or-gated, `2` usage.

| Mode | Behavior and exit contract |
| --- | --- |
| `init --atlas <dir>` | scaffolds an empty `MANIFEST.json`, `INBOX.md`, and `sections/`; **refuses to overwrite** an existing manifest |
| `check --atlas <dir> [--root <repo>] [--gate]` | per section, intersects `git diff --name-only <verifiedAt>..HEAD` with `scope` → FRESH (nothing hit) or STALE (up to 10 triggering paths plus the count); unknown sha → STALE with a reason. Exit 0 report-only; `--gate` exits 1 if any section is STALE. A malformed manifest — bad JSON, schema violation, missing section file — exits 1 **always**, gated or not |
| `stamp --atlas <dir> --section <slug> [--at <sha>]` | sets `verifiedAt` to `--at` or HEAD; refuses an unknown slug or an unparseable sha. The **only** sanctioned writer of stamps |
| `inbox --atlas <dir> --note <text>` | appends `- <YYYY-MM-DD> <short-sha>: <text>` to `INBOX.md`; one line, refuses empty |

`check` also runs a **coverage sweep**: every tracked top-level path (first path segment
of `git ls-files`) matched by no section's scope prints as an `unmapped` advisory. It
stays advisory even under `--gate` — an unmapped directory is a scoping todo, not a
false claim of freshness, and gating on it would train people to write junk scopes that
match everything.

The manifest is machine-written on purpose. Hand-editing a stamp is the one edit that
turns the artifact from a cache into a liability: the section reads as verified against a
commit nobody verified it against, and no check downstream can tell.

## Trust doctrine

- A **FRESH** section is consumed as truth, without re-verification. That is the entire
  token win — if a reader re-checks a FRESH section, the atlas has cost more than it
  saved.
- A **STALE** section is a **lead, not a fact**. An operative may read one for
  orientation, but every claim it takes from one is re-verified against current code
  before use.
- The FRESH/STALE listing travels *with* the brief, alongside the repo-map pointer, so
  the operative knows which half it is holding. A section handed over without its
  freshness state is unusable at either extreme: trusted when it should not be, or
  re-derived when it need not be.
- Freshness is fail-safe in one direction only. Every ambiguous case — unresolvable sha,
  scope that cannot be evaluated — resolves to STALE. The cost of a wrong STALE is one
  re-derivation; the cost of a wrong FRESH is a decision made on a false premise.

## Update in the hot session

A section is refreshed **by the change that invalidated it**, in the session that made
the change — this is why `/code-ops-suite:ship` runs `check` in its closing phase. The
rationale behind a diff is available for about as long as the session that produced it;
a week later the same author is reconstructing it from the diff like anyone else. Deferring
the atlas update to "a docs pass" converts free knowledge into expensive knowledge.

When a full section rewrite is genuinely out of scope, the move is an `inbox` note plus a
section left STALE — not a stamp. Stamping to clear a report is the failure mode this
whole design exists to prevent.

## Judgment, not facts

A section holds what a run had to *work out*: architecture rationale, cross-file flows,
invariants, gotchas, code that looks wrong and is load-bearing. It holds no file
inventories, export lists, or signatures — those are re-derivable in seconds by search
and rot on the next rename, and a section with three stale signatures in it stops being
believed as a whole.

**Conforming** (a `payments` section):

> Refunds run through the same state machine as charges, one step further along; the
> duplicate-looking `settle()` in the refund path exists because refunds settle against
> the original processor account, which the charge path resolves earlier and caches.
> Anything that unifies the two paths has to keep that resolution order.

**Non-conforming** — same section, facts instead of judgment:

> `src/payments/` holds `charge.ts`, `refund.ts`, `settle.ts`, and `types.ts`.
> `charge.ts` exports `createCharge(amount: Money, account: AccountId): Promise<Charge>`
> and `voidCharge(id: ChargeId): Promise<void>`.

The second is re-derivable in one search, wrong the first time a file is renamed, and
tells a reader nothing they would not have learned faster from the code.

## Append, then consolidate

Mid-run observations go to `INBOX.md` through the `inbox` subcommand — appending is cheap
and conflict-free, and it never requires deciding which section owns something at the
moment you are busy with something else. Consolidation is a separate, deliberate pass:
fold each entry into the section that owns it, rewrite so the section reads as one
considered account rather than an accreted log, clear the folded entries, stamp what was
touched. An observation that fits no section is the signal to add one.

*Verified-at: 9145ba9*
