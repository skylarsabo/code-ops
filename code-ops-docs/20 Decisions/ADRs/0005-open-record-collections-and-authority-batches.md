# 5. Open record collections and authority batches

- Status: Accepted
- Date: 2026-08-28
- Extends: [ADR 0004](0004-versioned-record-classification-and-reviewed-adoption.md)

## Context

Native append keeps an adopted collection open, but it accepts only paths with no reachable history. A committed immutable path therefore has no valid intake after genesis adoption. Rebuilding the genesis baseline would erase its review boundary.

The inventory also needs durable proof that every authority object entered through an accepted operation. The curation ledger cannot carry that proof because it records status and supersession, not authority membership.

## Decision

Keep each collection open while making every admission irreversible. Add inventory v3 with an append-only authority-batch chain. Use these batch types:

- `genesis-adoption` for the initial reviewed candidate set;
- `incremental-adoption` for committed immutable paths admitted later;
- `native-append` for new staged native authority; and
- `v2-migration` for the one-way receipt that preserves existing v2 authority.

Every immutable authority object belongs to exactly one batch. Each batch binds its complete membership, provenance, prior batch digest, and receipt digest. Genesis has no prior generated state. Every later batch binds its immediate predecessor state, including the prior batch head, and complete-history verification re-derives that binding. Missing, duplicate, forged, or broken membership fails.

Enforce provenance through batch type. Genesis and incremental batches cover only `adopted` records and artifacts. Native batches cover only `native` records and artifacts. Each native object's `introducedIndexHead` equals its batch `sourceHead`. The exact path has no history through that source and first appears in the commit that records the batch.

Migration preserves existing v2 record objects and their valid provenance. Only `v2-migration` may cover provenance-less artifacts because v2 artifacts lacked that field. It must preserve those complete objects, follow an observed committed v2 predecessor, and never manufacture provenance.

Preserve singular `adoptionReview` as genesis evidence and for v2 migration compatibility. Incremental batches embed their complete review receipt. Do not create a second growing review chain.

Keep the authority-batch chain separate from the curation ledger. Authority batches prove membership and provenance. Curation events record status, supersession, and corrected metadata state. Both chains use one clone-wide collection mutation lock beneath Git's common directory, keyed by collection UUID.

`plan-adoption --incremental` profiles only immutable paths that lack authority. An empty delta is a write-free success. `--require-delta` makes the same condition fail for strict automation. A non-empty first mutation of inventory v2 writes a `v2-migration` batch before the requested batch.

Writers bind the current inventory, citations, index, manifest, Git state, and authority-batch head. Record operations parse policy from canonical Git-index manifest bytes. Authority mutations re-read that index entry at both transaction boundaries and refuse movement after context load, including when history is shallow. Native writes also require visible worktree manifest changes to match staged authority. Complete-history verification re-derives every batch's manifest binding from its introduction commit. Reachable adoption sources must contain the reviewed candidates, their complete history profiles, and the bound manifest.

Writers recompute bindings under the collection mutation lock before any write. One shared helper atomically replaces generated authority, runs the full semantic check, and restores every prior byte when verification fails. A stale binding or partial authority state fails without lasting generated changes.

Validate existing evidence before reporting new intake work. History loss, immutable drift, broken receipts, and invalid existing authority take precedence over `pending-admission`. A valid collection with unadmitted immutable paths fails with `pending-admission`.

An adopted `_archive` path freezes in place. Use curation and a canonical hub document to supersede its meaning. Never archive a governed record by moving it.

Scheduled recovery uses a unique branch in an isolated per-run worktree. It never switches the shared checkout. `commit-tree` is not the default. A branch assertion and guaranteed restoration are fallback safeguards when worktrees are unavailable.

## Consequences

Existing IDs, entry objects, artifact objects, citation baselines, and receipts remain unchanged. Canonical aggregate files may gain new authority objects and render a new semantic projection.

Inventory v1 and v2 remain readable. The first non-empty v2 authority mutation performs the receipted v3 migration. Empty checks and empty incremental plans do not migrate.

Planning cost follows the delta. Checking validates batch history in bounded work while preserving exact-once coverage across the collection.

Repositories can admit evidence created by scheduled or external workflows after it enters Git history. Protected review remains the trust root, and no automation merges the recovery branch.
