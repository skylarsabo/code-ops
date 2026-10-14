# Bench exit contract

`bench.mjs plan` binds this file's digest, and `bench.mjs run` appends one section's text verbatim
to every prompt in both arms. The text between a heading and the next heading is the section, with
leading and trailing blank lines removed. Edit it only before a snapshot is planned.

## detection

When you finish, write a file named BENCH_FINDINGS.json at the repository root. It holds one JSON
object with a "findings" array. Each finding is an object with these keys:

- "file": the path from the repository root, such as "src/read.js".
- "line": the 1-based line number of the defect.
- "anchor": a verbatim substring of that line.
- "tier": "CONFIRMED" when you executed a reproduction or test that shows the defect, "PROBABLE"
  when at least two independent lines of static evidence support it, else "SPECULATIVE".
- "proof": for CONFIRMED, the test file path, the test name, or the receipt id that shows it.
  Otherwise a short evidence note.
- "summary": one sentence on what is wrong.

For a review of a commit, the object also holds "verdict": "block" when the commit should not merge
as it stands, else "approve".

Give each line number as it is in the latest commit you were given, even if you edit files. Report
only what you believe is a real defect. An empty "findings" array is a valid answer. No person will answer questions during this run, so make each decision
yourself. The run ends when BENCH_FINDINGS.json is written.

## change

When you finish, commit your change to the current branch of this repository. There is no remote,
so the run ends at a local commit. Do not push and do not open a pull request. Then write a file
named BENCH_SUMMARY.json at the repository root with one JSON object holding these keys:

- "file": the path of the main file you changed, from the repository root.
- "line": the 1-based line of the root cause or of the main change.
- "summary": one or two sentences on what you changed and why.

Keep the existing tests passing. No person will answer questions during this run, so make each
decision yourself. The run ends when the commit exists and BENCH_SUMMARY.json is written.
