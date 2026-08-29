# CI workflows

Charter: workflow scheduling, credential boundaries, and merge-gate behavior. Excludes gate implementation details and fixture design.

`validate.yml` is the deterministic merge gate. It runs on pull requests, pushes to `main`, and manual dispatch, with per-ref cancellation. Its Ubuntu and Windows legs check package structure, generated output, dependency policy, documentation manifest, vault conformance, citation integrity, the live Atlas, and platform-sensitive regressions.

Both deterministic legs run Node 24 from the repository `.node-version` file. Third-party actions resolve through exact commits recorded with review metadata in `.github/actions-lock.json`; the same checker covers shipped workflow examples and reachable local actions. Weekly Dependabot updates create review work for GitHub Actions but never merge it. Minor and patch updates are grouped, while majors remain individually reviewable and every accepted update must refresh the lock and regression evidence.

The validation matrix now includes run-contract, context snapshot, context bundle, and documentation-manifest regressions. The Linux leg also executes the complete answer-key drift loop and real calibration-store validation. The Windows leg remains a deliberate portability subset, not a duplicate of every Linux check. Its 20-minute ceiling accommodates the expanded record-regression workload and bounded hosted-runner variation without reducing coverage.

Both validation legs run the durable record-collection regression and invoke `records check` for every collection declared by the live manifest. Their checkout requests full history and disables partial filtering. A `legacyPaths` exemption cannot exist without a collection-backed CI verifier. That configuration keeps missing checkout history distinct from genuine evidence loss and makes platform-specific path behavior visible before merge.

`deep-review.yml` and `opsec-gate.yml` are credential-dependent PR gates. Their retry guard is load-bearing: two failed review attempts fail the job. A green result can still mean a skipped review, so workflow logs distinguish review from no-credential and generated-output cases.

Same-repository `pull_request` runs resolve workflow files from the merge ref, so they exercise edits to the PR gates. The advisory tells reviewers to confirm that the edited path ran. Fork credential skips need a same-repository run; `pull_request_target` and `schedule` use the default branch; `push` uses the pushed ref. Measurement workflows retain stable model pins for comparability and do not define merge correctness.
