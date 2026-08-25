# CI workflows

Charter: workflow scheduling, credential boundaries, and merge-gate behavior. Excludes gate implementation details and fixture design.

`validate.yml` is the deterministic merge gate. It runs on pull requests, pushes to `main`, and manual dispatch, with per-ref cancellation. Its Ubuntu and Windows legs check package structure, generated output, dependency policy, documentation manifest, vault conformance, citation integrity, and platform-sensitive regressions.

The validation matrix now includes run-contract, context snapshot, context bundle, and documentation-manifest regressions. The Linux leg also executes the complete answer-key drift loop and real calibration-store validation. The Windows leg remains a deliberate portability subset, not a duplicate of every Linux check.

Both validation legs run the durable record-collection regression and invoke `records check` for every collection declared by the live manifest. Their checkout requests full history and disables partial filtering. A `legacyPaths` exemption cannot exist without a collection-backed CI verifier. That configuration keeps missing checkout history distinct from genuine evidence loss and makes platform-specific path behavior visible before merge.

`deep-review.yml` and `opsec-gate.yml` are credential-dependent PR gates. Their retry guard is load-bearing: two failed review attempts fail the job. A green result can still mean a skipped review, so workflow logs distinguish review from no-credential and generated-output cases.

Workflow edits need special handling. A pull request cannot review its own edit to a PR-only gate because the existing default workflow runs first. The advisory surfaces that risk, but a follow-up pull request is the proof. Measurement workflows retain stable model pins for comparability and do not define merge correctness.
