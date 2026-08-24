---
type: decision
status: accepted
updated: 2026-08-18
tags:
  - meta
  - standard
---

# D-001 adopt vault standard

## Decision

This repo adopts vault standard version 2 and keeps its notes in `code-ops-docs/`. [[Standard]] is the conformance copy. The source of truth is `code-ops-docs/40 Engineering/Techniques/vault-standard.md`. When the two disagree, the repo copy wins.

The repo takes the code-ops profile. The profile waives `30 Ops/`, because this repo operates no service. `code-ops-docs/80 Runs/` is gitignored, which matches the ADR 0001 treatment of `docs/code-ops-run/`.

## Context

Three vaults had grown three layouts, and the suite's doc skills wrote dated artifacts to a fourth convention. One standard removes the per-repo relearning cost and makes agent behavior repeatable across repos and hosts.

## Options considered

The standard settles five questions. Each is recorded with the option it rejected.

1. **Numeric folder prefixes.** A two-digit prefix fixes the sidebar order, and wikilinks bind to note names rather than paths, so a folder rename stays cheap. Rejected: flat lowercase folders, because alphabetical order buries `inbox/` in the middle of the list.
2. **Runs live in the vault.** One dated-run convention replaces three earlier ones. Rejected: keeping runs outside the vault, because that splits design-time judgment across two trees.
3. **Vault decisions are the decision log for personal repos.** Rejected: a parallel `code-ops-docs/20 Decisions/ADRs/` tree in every repo, because two decision logs drift apart.
4. **The vault does not absorb tracked reference docs or the atlas.** Machine-checked artifacts need repo paths, the CI citation gate, and git-host rendering. Rejected: the vault as the only docs tree, because that breaks `atlas-check.mjs` and host rendering.
5. **Each `Standard.md` stays self-contained.** Agents in a target repo hold no code-ops checkout. Rejected: a thin pointer file, because it is unreadable offline.

## Consequences

Agents route new work through the table in [[Standard]] instead of inventing a second docs tree. The canonical trees keep their roles: `code-ops-docs/40 Engineering/Handbook/`, `code-ops-docs/40 Engineering/Techniques/`, `code-ops-docs/20 Decisions/ADRs/`, and `code-ops-docs/98 System/Atlas/`. A vault note that matures into doctrine moves into the owning tree and leaves a link behind.

`20 Decisions/` records working decisions that do not warrant a published ADR. When one does warrant an ADR, promote it to `code-ops-docs/20 Decisions/ADRs/` and archive the vault note with `superseded-by`.

Conformance is machine-checked. `scripts/check-vault-standard.mjs` and the `/code-ops-suite:vault` scaffolding skill landed with this decision (PR 58, commit 14b6e94). A `SHARED_PASSAGES`-style byte pin over each vault's `Standard.md` copy is the one follow-up still open.

## Related

- [[Standard]]
- [[00 Home]]
- `code-ops-docs/40 Engineering/Techniques/vault-standard.md`
