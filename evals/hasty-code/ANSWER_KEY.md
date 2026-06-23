# hasty-code — answer key

A tiny repo (`repo/`) with **3 real hasty-code issues** and **2 decoys** (constructs that look hasty but are intentional/correct). It measures `code-ops-suite:normalize` (or `rigor:quality-scan`) on the two axes that matter: did it find the real cleanup targets (**recall**), and did it leave the intentional code alone (**precision**)?

Keep this file out of any context you give the skill — it's the grader, not an input.

## Planted issues (should be found)
| ID | Location | Category | What's wrong |
|----|----------|----------|--------------|
| HASTY-1 | `src/util.js:4` | dead-code | `unusedHelper` is never called and never exported. |
| HASTY-2 | `src/util.js:25` | unreachable | a statement after an unconditional `return` — unreachable. |
| HASTY-3 | `src/util.js:12` | generated-comment | a verbose comment restating the code line by line — a generated tell. |

## Decoys (should NOT be flagged)
| ID | Location | Why it's fine |
|----|----------|---------------|
| DEC-1 | `src/util.js:29` | `publicEntry` looks unused in-file but is the package's re-exported entry point. |
| DEC-2 | `src/util.js:35` | `n \|\| 0` is an intentional, correct default-guard idiom. |

A run that removes either decoy has changed behavior or flagged a non-issue — exactly what normalize's behavior-preserving rule forbids.
