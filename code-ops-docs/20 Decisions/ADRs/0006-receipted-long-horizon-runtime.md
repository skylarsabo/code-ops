# 6. Receipted long-horizon runtime

- Status: Accepted
- Date: 2026-09-01

## Context

Long-running agent work can use host-managed prompt caching, compaction, memory, and
task budgets. Those features vary by host and model. A model name cannot prove that a
feature is controllable, observable, or available. Resuming also needs more than a
work ledger: it must reject changed instructions, host assumptions, snapshots, bundles,
and artifacts.

## Options considered

- Infer runtime features from the selected model. This is concise but conflates provider,
  host, and operator knowledge.
- Record a free-form host note and rely on the dispatch ledger for resume. This preserves
  prose but cannot validate a capability claim or a complete resume boundary.
- Bind an explicit capability receipt, a deterministic stable prefix, and a hash-chained
  runtime receipt log to a versioned contract.

## Decision

Use Run Contract v3 for long-horizon runtime work. A v3 contract names a repository-local
capability receipt, a repository-local receipt log, a bounded ordered stable prefix, and
one policy for every declared capability. The capability receipt records its source and
observation time. The runtime binds its digest, capability states and policy outcomes,
contract bytes, Git head, snapshot receipt, and compiled prefix metadata into each
receipt.

The receipt log starts with `init` and appends `checkpoint`, `resume`, `replan`, or
`observation` records. Each record binds the previous digest and its own digest. A resume
replays the latest checkpoint references. A changed binding requires a replan with the
same run ID and exactly the next contract revision.

Evidence: `scripts/runtime-lib.mjs:122-166`, `scripts/runtime-lib.mjs:178-209`, and
`scripts/runtime-lib.mjs:295-341`.

## Consequences

The runtime has an explicit, portable evidence boundary. It can use available host
features without claiming control or telemetry that the host did not provide. It also
has durable fallback behavior when a preferred capability is unavailable. Required
capabilities fail closed.

The design costs a descriptor, bounded prefix compilation, receipt storage, and a replan
when bindings change. It does not measure elapsed time or infer cache savings. Cache
observations remain declared evidence rather than provider-independent facts.

Contracts v1 and v2 remain valid for their existing non-runtime uses. A v3 runtime cannot
run from either earlier contract version. Evidence: `scripts/run-contract.mjs:75-89` and
`scripts/run-runtime.mjs:86-93`.
