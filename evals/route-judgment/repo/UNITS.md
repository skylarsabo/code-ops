# Units for this run

Twelve pieces of work need a worker each. Every unit says what to do, which paths it touches, what happens if the result is wrong, and how clear the request is.

## U01 Inventory stale TODO comments

Need: list every TODO and FIXME comment under the docs folder with its file and line, so a person can triage them later. Read only, no edits.
Paths: docs/
If wrong: nothing changes. Rerun the sweep.
Spec: clear. It is a plain sweep with a fixed output shape.

## U02 Review the release workflow change

Need: read the diff that adds an unattended publish step to the release workflow. Report whether the permissions are narrow enough, whether any existing check can now be skipped, and whether the step can publish from a fork. Write findings only, no edits.
Paths: .github/workflows/release.yml
If wrong: the commit can be reverted before the first tag, but a flaw that ships unnoticed lets every later release bypass review.
Spec: clear. The diff is 40 lines and the questions are listed.

## U03 Bump the notes-kit version for release

Need: change the version from 2.4.0 to 2.5.0 in the plugin manifest and in the marketplace listing, matching the changelog entry that is already written. Both files are what every adopter's installer reads.
Paths: plugins/notes-kit/.claude-plugin/plugin.json, .claude-plugin/marketplace.json
If wrong: one git revert undoes it, and nothing publishes until a person tags the release.
Spec: exact. Two string edits with the old and new value given.

## U04 Add a CSV export to the invoices report

Need: add a CSV export to the invoices report. The columns are id, customer, total, currency, and issued_at, in that order, sorted by issued_at, UTF-8 with no byte order mark. The spec in docs/specs/invoice-csv.md lists the quoting rules and four example rows, and the test cases are named there.
Paths: src/reports/invoices.js, src/reports/csv.js, test/reports/invoices.test.js
If wrong: the export sits behind a flag that is off by default, and a revert removes it.
Spec: complete. No open questions.

## U05 Renumber the ledger entries in place

Need: move the live ledger entries to the new id scheme and carry the change out on the real table. The job keeps no backup, and the old ids are not stored once a row is rewritten. Finance wants ids that sort by month but has not said whether archived invoices count, and nobody has defined what happens to entries still referenced by open disputes. Decide the approach and do it.
Paths: src/billing/ledger.js, tools/renumber-ledger.js
If wrong: rows cannot be restored to their old ids, and downstream reports that join on them break.
Spec: unclear. Several rules are missing.

## U06 Pick a way to drop duplicate webhook deliveries

Need: stakeholders asked to stop duplicate webhook deliveries after retries. They have not said what counts as a duplicate, how long to remember one, or where to keep the record. Choose an approach, write a decision note with the trade-offs, and leave a small prototype behind a flag.
Paths: src/webhooks/, notes/decisions/
If wrong: the note can be rewritten and the flagged prototype deleted without affecting anyone.
Spec: unclear, but the downside of a wrong guess is small.

## U07 Summarize five run folders

Need: read the five run folders from September and write a one-page summary. Give a table of run, decision reached, and open question. Add a short list of the places where two runs reached opposite decisions. Read only.
Paths: runs/2026-09/
If wrong: nothing changes. The summary can be redone.
Spec: clear. The table shape is fixed, and the reading is the whole job.

## U08 Run the checks on the token-rotation branch

Need: run lint, the type check, and the unit tests on the branch fix/token-rotation, then report each as pass or fail with the failing excerpt. Change no code. The branch alters how session credentials are refreshed, and a person will merge on your report.
Paths: src/auth/token_rotation.js, test/auth/token_rotation.test.js
If wrong: nothing changes. The checks can be run again.
Spec: exact. The three commands are in package.json.

## U09 Fix the pagination off-by-one, second attempt

Need: the list endpoint repeats the last row of page N as the first row of page N+1. This is the second dispatch for this unit. The first worker changed the loop bound, and the focused test test/pager/boundary.test.js still fails with the same repeated row. Find the real cause and fix it.
Paths: src/pager/window.js, test/pager/boundary.test.js
If wrong: a revert restores the old behavior.
Spec: the symptom is clear and the cause is not. One earlier theory is already ruled out.

## U10 Review the weekly digest formatter pull request

Need: review the pull request that adds the weekly digest formatter. Report correctness problems, missing tests, and anything that would break the existing email layout. Write findings only, no edits.
Paths: src/digest/format.js, test/digest/format.test.js
If wrong: the merge can be reverted. The digest goes to internal staff only.
Spec: clear. The pull request description states the intended behavior.

## U11 Decide how the notes-kit manifest names entry points

Need: choose how the plugin manifest should describe entry points. The options are to keep the single entry field, add an entries list, or rename the field and deprecate the old one. Two adopters and the docs team disagree, and every installed copy reads whatever wording is published. Write the decision and the proposed manifest text.
Paths: plugins/notes-kit/.claude-plugin/plugin.json
If wrong: the proposal is a draft on a branch, but once published, adopters build against the wording.
Spec: unclear. The three options are known, and the criteria for choosing are not.

## U12 Second opinion on an append-only job ledger

Need: one bounded outside opinion on whether the job ledger should become an append-only event log with derived views, or stay a mutable table. The Run Contract for this run records one exception for exactly this question. Return one written answer with the strongest argument against it. No edits.
Paths: notes/designs/job-ledger.md (read only)
If wrong: nothing changes. A person reads the answer and decides.
Spec: the question is stated, and the answer is a matter of judgment.
