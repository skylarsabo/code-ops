---
type: decision
status: accepted
updated: 2026-09-28
tags:
  - meta
  - records
---

# D-004 collection roots may relocate

## Decision

Standard version 5 keeps admitted record bytes irreversible and lets a collection root move. This note supersedes the path clause of standard version 4, which made adopted paths irreversible as well as adopted bytes.

Each root move is a `relocate-root` curation event. Every record keeps its bytes and its path relative to the root. A root may move more than once, and each move is one prefix swap. A single record still never moves on its own, and a governed record is never archived by moving it.

## Context

A repository that adopted records under a legacy tree cannot fold that tree into its vault while paths are irreversible. The program design needs the legacy tree moved into the vault and the `docs/` folder retired. See "W1. Standard v5 and manifest v3" in [[Program state handoffs and coordination 2026-09]].

## Options considered

1. **Move whole roots through a `relocate-root` event.** Chosen. Record ids and root-relative paths survive the move, so the collection keeps every record.
2. **Allow one move per record path.** Rejected. This was docs-state revision 1, and it could not express a second move.
3. **Allow a chain of per-record moves.** Rejected. This was docs-state revision 2. Four path rules would drop a moved record from its collection.

## Consequences

Manifest version 3 adds the `relocated` and `removed` legacy-path dispositions. `relocated` names the old root and its target. `removed` names a root that must not exist on disk.

Old citations must keep resolving after a move. The forwarding map and the relocation tooling that write `relocate-root` events arrive with the record work in the same design. Until they ship, no root moves.

## Related

- [[Standard]]
- [[D-001 adopt vault standard]]
- [[Program state handoffs and coordination 2026-09]]
- `code-ops-docs/20 Decisions/ADRs/0005-open-record-collections-and-authority-batches.md`
