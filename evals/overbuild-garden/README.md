# overbuild-garden

A decoy garden for `scripts/scan-overbuild.mjs`. `repo/base/` is a small project and
`repo/change/` overlays one change onto it. The change plants fifteen over-builds, one of every
tell, three of the new-file tell, and two of the suppression tell, and thirteen decoys a naive scanner would flag: a sized
extraction with two callers, an interface with two implementors, a test file sized like its
neighbors, a dependency with a decision record in the same diff, a config key the server reads,
two wrappers that add a guard or change an argument, prose comment blocks, two suppressions
with a same-line reason, a placeholder row, and an arrow symbol.

`run.mjs` builds a throwaway git repository from the two trees, runs the scanner on
`HEAD~1..HEAD`, scores the `--json` hits with `evals/score.mjs` against `ANSWER_KEY.json`, and
asserts no hit outside the key, exactly one blocking tell, the exit codes, and a mutation
control that removes the new-file bound and must fail the score.

`delta/` is a second, smaller fixture for the touched-file delta advisory, built the same way. It holds
one net-negative file (drops a pass-through and a duplicate helper), one net-positive file (adds
a pass-through), and one file that edits neither. The run asserts the improved, worse, and
unchanged verdicts, that the advisory adds no hit, and a mutant that cuts the removed-line read.

```
node evals/overbuild-garden/run.mjs
node evals/score.mjs evals/overbuild-garden/ANSWER_KEY.json --check
```

The key's `repo` is `repo/change`, so `--check` resolves every anchor in the overlaid tree.
Edit the fixture through the trees, then re-run `--check` before trusting a score.
