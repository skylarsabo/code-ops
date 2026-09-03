# overbuild-garden

A decoy garden for `scripts/scan-overbuild.mjs`. `repo/base/` is a small project and
`repo/change/` overlays one change onto it. The change plants eleven over-builds, one of every
tell and three of the new-file tell, and nine decoys a naive scanner would flag: a sized
extraction with two callers, an interface with two implementors, a test file sized like its
neighbors, a dependency with a decision record in the same diff, a config key the server reads,
two wrappers that add a guard or change an argument, and prose comment blocks.

`run.mjs` builds a throwaway git repository from the two trees, runs the scanner on
`HEAD~1..HEAD`, scores the `--json` hits with `evals/score.mjs` against `ANSWER_KEY.json`, and
asserts no hit outside the key, exactly one blocking tell, the exit codes, and a mutation
control that removes the new-file bound and must fail the score.

```
node evals/overbuild-garden/run.mjs
node evals/score.mjs evals/overbuild-garden/ANSWER_KEY.json --check
```

The key's `repo` is `repo/change`, so `--check` resolves every anchor in the overlaid tree.
Edit the fixture through the trees, then re-run `--check` before trusting a score.
