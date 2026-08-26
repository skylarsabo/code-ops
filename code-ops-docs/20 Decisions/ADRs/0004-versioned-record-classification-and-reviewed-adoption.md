# 4. Versioned record classification and reviewed adoption

- Status: Accepted
- Date: 2026-08-25
- Extends: [ADR 0003](0003-durable-record-collections.md)

## Context

Scope v1 requires exactly one glob match. It cannot express a broad default with a narrow exception. Real evidence trees also contain files revised before adoption. Structural classification cannot prove that freezing those files matches operator intent.

Adoption is irreversible. A warning or force flag leaves no durable evidence of the decision. Recomputing history independently in each agent also wastes work and permits stale judgments.

## Decision

Keep scope v1 unchanged. Add collection-local `classificationVersion: 2` with stable scope IDs, glob arrays, and exact-path arrays. Exact paths outrank globs. Competing exact owners and competing surviving glob owners fail. Scope order has no authority.

Separate partition validity from adoption readiness. Profile immutable candidates with path-bounded history queries that follow promotions across prior paths. Bind the profile to current bytes, `HEAD`, and manifest bytes with SHA-256 digests.

Require a completed `freeze-current` disposition and rationale for each historically revised or reused immutable path. Recompute every binding during adoption. Store the reviewed entries and receipt digest in inventory v2 before generating any other baseline.

Preserve both path introduction and content baseline commits. Introduction identifies when the exact record path entered history. Baseline identifies the commit containing the reviewed adopted bytes and governs citation resolution.

## Consequences

Heterogeneous evidence trees can use broad defaults without enumerating every ordinary path. Existing v1 collections remain valid and may migrate without changing record IDs or immutable policies.

Operators pay one bounded history profile and an explicit review step before risky adoption. Repository, manifest, content, or history drift invalidates the plan. Failed adoption leaves no generated files.

Post-adoption checks use one content-and-risk rule. An unreachable or forged `sourceHead` cannot select weaker verification. With complete history, checks require:

- exact coverage of the original candidates;
- matching current bytes and classification;
- risk labels that agree with stored counts;
- a reviewed rationale for each currently risky candidate; and
- recomputed counts that do not exceed the stored profile.

Incomplete history prevents proof of candidate history or risk. Ordinary checks warn, while strict verification fails as infrastructure.

`receiptDigest` is an unkeyed canonical checksum. It detects corruption and stale cross-field copies. It does not authenticate a reviewer or unreachable receipt bytes. Protected repository review is the procedural trust root. Rewrite tolerance assumes that the resulting tree preserves the receipt authority bytes. Total-history replacement requires an external signature or transparency log.

Inventory v2 adds durable adoption-review metadata and a baseline commit. Inventory v1 remains readable. Generated projections and documentation must describe both versions until fleet evidence supports deprecation.
