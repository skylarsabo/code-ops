# The fleet standard

A fleet is a named set of repos that one operator standardizes together. Every skill in the suite operates on one repo. A fleet adds the layer above: a manifest that names the members, a consent rule that lets each repo refuse, and one checker that reports every member's conformance in a single table. This page is the source of truth for the manifest shape, the consent rule, and the checker's contract.

## Why a manifest and not a scan

A directory scan finds repos. It cannot tell an operator which repos they meant. A workspace holds vendored checkouts, throwaway clones, and other people's code, and a fleet operation that walks all of them edits repos nobody enrolled. So membership is declared, in a file the operator writes and reviews.

## The manifest

`FLEET.json` sits at a workspace root — the directory holding the member repos. The same schema works at any directory the operator chooses, so a user-scope fleet is the same file placed higher up. Member paths resolve against the manifest's own directory, which makes a relative manifest portable between machines.

```json
{
  "version": 1,
  "members": [
    { "path": "ripper", "profile": "product", "roles": ["shipped", "cli"] },
    { "path": "research", "profile": "research", "roles": ["notebook"] }
  ]
}
```

- `version` — the integer `1`. A manifest with another value is refused rather than guessed at.
- `members` — a non-empty array. Each entry is an object.
- `path` — the member repo, relative to the manifest's directory or absolute.
- `profile` — the vault profile the member claims: `product`, `research`, or a profile a later standard adds. The checker records it and does not rule on it, because the vault's own `Standard.md` is where a profile is defined.
- `roles` — free strings the operator uses to select a subset of the fleet. Nothing mechanical reads them today.

A member entry carrying an unknown key is a manifest-shape error. A silently-ignored key is how a typo in `profile` becomes an unenforced claim.

## Consent

Membership is two-sided. The manifest names a repo, and the repo consents. Consent lives in the repo's own standards contract — the pair of files hosts read, in either parity mode described under "Host parity" in `vault-standard.md`. The contract carries a `## Fleet` section, and inside it the literal phrase `fleet member: yes` on a line of its own, matched case-insensitively.

The phrase must be the whole line, because a contract that discusses the rule must not thereby enroll itself. A list bullet, blockquote marker, or indent before the phrase is still a line of its own and still counts. These do not count, and each is an ordinary way to write a refusal:

- The phrase inside a fenced code block, which is how a contract shows the phrase without asserting it.
- The phrase quoted inline in a sentence, as in an explicit written decline.
- The phrase anywhere outside the `## Fleet` section.

The heading may be written closed-ATX (`## Fleet ##`); the trailing hashes are trimmed before the match.

```markdown
## Fleet

fleet member: yes

This repo is enrolled in the workspace fleet. Doctrine changes arrive through
`/code-ops-suite:conform` in fleet mode, and land as ordinary reviewed commits.
```

Three states follow, and the checker names each:

- **Named and consenting** — the manifest lists the repo and the contract carries the phrase. Fleet operations run against it.
- **Named, not consenting** — the manifest lists the repo and the contract does not carry the phrase. The checker reports the row and never operates on the repo. This state is not a failure. A repo declines by doing nothing.
- **Consenting, not named** — the contract carries the phrase and no manifest lists the repo. The repo is invisible to fleet operations. A consent phrase is an offer, not an enrollment.

### The consent doctrine

Consent is per-repo and revocable. A repo leaves the fleet by editing its own contract, and the change takes effect on the next fleet run with no manifest edit and no operator approval.

Fleet operations never edit a member's consent. A run that could write the phrase it then reads has no consent rule at all — it has a formality. So the consent section is out of scope for every repair a fleet run performs, including a doctrine propagation that rewrites the rest of the contract.

## The checker

```
node scripts/check-fleet.mjs <FLEET.json>
```

The checker validates the manifest, resolves each member, reads consent, and runs the per-repo checks that exist locally. It writes one table row per member per surface, in the `CONFORMANCE_REPORT.md` surface-row grammar of `artifact-grammars.md`, section (d). Calibration ingest therefore reads a fleet report with no parser change.

The surface cell is the member's slug joined to the surface name, as in `ripper-vault`. That grammar counts a repeated surface cell as unparseable, so the member slug is what keeps each row distinct. Two members whose slugs collide are a manifest-shape error.

| Surface | What decides it |
| --- | --- |
| `<slug>-consent` | CONFORMANT when the contract carries the phrase in a `## Fleet` section, ABSENT otherwise |
| `<slug>-contract` | The contract pair exists and matches one parity mode: byte-identical copies, or a short pointer file naming the substantive one as required reading. Two pointers naming each other are DRIFTED, because neither file is the substantive contract and every host reads a stub |
| `<slug>-vault` | `<repo>-docs/` exists and `check-vault-standard.mjs` exits 0 against it |

A member with no vault reports `ABSENT` and does not fail the run. Vault adoption stays voluntary, exactly as it does per-repo.

Exit codes:

- `0` — every consenting member passed every surface it carries. A named, not consenting member leaves a row and does not change this.
- `1` — a manifest-shape error, or a consenting member failing a surface.
- `2` — a usage error.

The checker is fail-closed on everything it cannot read. A member path that does not resolve, a contract it cannot open, or a vault check that fails to run reports `UNKNOWN`, which fails the run for a consenting member. A check that did not execute proves nothing.

## What the checker does not do

It never writes. It reports the fleet's state, and repair is the job of `/code-ops-suite:conform` in fleet mode, member by member, under checkpoint.

It does not deduplicate findings across members, and it does not carry one member's freshness stamp to another. Both need a design pass first. Independent git histories give each repo its own notion of current, and a similarity rule that merges two findings wrongly costs more than reporting the same finding twice.

## Enforcement

Conformance is checkable by machine here, and machine-*enforced* only where CI runs the checker. A fleet spans repos, so no single repo's CI is the natural home for the fleet check. Today it is a command an operator or an agent runs from the workspace root.

*Verified-at: d26c441 (2026-08-18)*
