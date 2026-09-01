# 7. Local judgment before hosted CI

- Status: Accepted
- Date: 2026-09-01

## Context

Deep review and OpSec review need model judgment. Hosted CI can reproduce deterministic
validation, but it cannot supply a portable model-review environment or prove a reviewer
identity from a free-form model label. A pre-PR review must also bind its reports to the
exact feature-branch diff that it judged.

## Options considered

- Run model review inside hosted CI. This centralizes execution but couples judgment to a
  provider and hosted credentials.
- Run local model judgment without a deterministic receipt boundary. This is flexible but
  cannot reject changed diffs, reports, or incomplete gate coverage.
- Run judgment locally before PR creation, bind it to the exact diff and ignored receipts,
  then retain hosted CI for deterministic validation.

## Decision

Use local pre-PR judgment for `local-deep-review` and `local-opsec-gate`. A clean,
non-default feature branch produces a SHA-bound review plan with its base, head, binary
diff digest, and sorted changed paths. Each gate records one ignored report receipt with a
verdict, finding counts, reviewer and model labels, tier, effort, report digest, and a
predecessor digest. A local check requires exact, passing coverage for both gates.
The two receipts must name distinct reviewer identities. All ignored authority files must
also be distinct physical files without symbolic-link components.

Keep deterministic validation in the hosted `validate` workflow. Provider-specific action
examples remain compatibility paths for hosts that use them; they do not replace the local
judgment boundary.

Evidence: `scripts/local-review-gate.mjs:83-185`,
`scripts/local-review-gate.mjs:194-269`, `scripts/local-review-gate.mjs:357-436`,
`scripts/local-review-gate.mjs:441-468`, and
`.github/workflows/validate.yml:23-159`.

## Consequences

Review plans, reports, and receipts are local ignored evidence. Any worktree, branch,
base, head, diff, report, or receipt-chain drift fails review and needs a new plan or
receipt. The receipt chain proves data integrity and the exact review boundary. Reviewer
and model fields are attestations, not hardware-backed identity.

Optional GitHub commit statuses publish only after the live remote base still equals the
planned base and the live feature branch still equals the reviewed HEAD. The publisher derives
the repository from that same Git remote and rejects a conflicting override. Strict required
statuses make later base movement invalidate the merge candidate. Publishing requires GitHub
write authority; a missing credential does not change the local receipt result.

The local judgment eval planner and deterministic scorer are provider-neutral. They bind the
matrix, fixtures, answer keys, skill documents, models, execution availability, candidates,
and scores to a plan and receipt. Worker units omit answer-key paths. The full plan remains a
lead-only scoring authority, and floor runs require distinct strong and weak model IDs.
