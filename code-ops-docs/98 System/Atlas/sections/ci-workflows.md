# CI workflows

Charter: workflow scheduling, credential boundaries, and merge-gate behavior. Excludes gate implementation details and fixture design.

`validate.yml` is the deterministic merge gate. It runs on pull requests, pushes to `main`, and manual dispatch, with per-ref cancellation. Its Ubuntu and Windows legs check package structure, generated output, dependency policy, documentation manifest, vault conformance, citation integrity, the live Atlas, and platform-sensitive regressions.

Both deterministic legs run Node 24 from the repository `.node-version` file. Third-party actions resolve through exact commits recorded with review metadata in `.github/actions-lock.json`; the same checker covers shipped workflow examples and reachable local actions. Weekly Dependabot updates create review work for GitHub Actions but never merge it. Minor and patch updates are grouped, while majors remain individually reviewable and every accepted update must refresh the lock and regression evidence.

The validation matrix now includes run-contract, context snapshot, context bundle, and documentation-manifest regressions. The Linux leg also executes the complete answer-key drift loop and real calibration-store validation. The Windows leg remains a deliberate portability subset, not a duplicate of every Linux check. Its 20-minute ceiling accommodates the expanded record-regression workload and bounded hosted-runner variation without reducing coverage.

Both validation legs run the durable record-collection regression and invoke `records check` for every collection declared by the live manifest. Their checkout requests full history and disables partial filtering. A `legacyPaths` exemption cannot exist without a collection-backed CI verifier. That configuration keeps missing checkout history distinct from genuine evidence loss and makes platform-specific path behavior visible before merge.

Model-driven deep review and OpSec review run locally before a pull request. The local gate
binds base and HEAD SHAs, binary diff, changed paths, distinct strong-or-frontier reviewers,
and a receipt hash chain. After the branch push, publication verifies the live base and feature
refs and binds the destination repository to that Git remote. Strict required statuses prevent
later base movement from reusing the merge candidate. Weekly trend and floor calibration also
run through local Codex automation with explicit execution policy. They measure judgment
quality and do not define GitHub merge correctness.

GitHub `validate.yml` remains deterministic. It runs lint, rendering, checks, and regression
tests, including local-gate and judgment-planner fixtures, on the pull-request merge ref,
pushed `main` ref, or manual dispatch. The former deep-review, OpSec, scheduled judgment, and
floor workflows are absent. Consumer GitHub review examples remain opt-in integrations whose
credentials, events, and status policy belong to the adopter.

Both legs run the context-audit regression, which exercises the transcript parser and the `SessionEnd` receipt hook against a synthetic fixture, so path and stdin handling for the hook are proven on Windows before merge.
