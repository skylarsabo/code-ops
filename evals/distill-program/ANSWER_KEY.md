# distill-program — answer key

A tiny repo (`repo/`) holding one messy program ledger, `programs/ledger-demo/PROGRAM.md`, with its `BACKLOG.md`, its untouched `PROGRAM.archive.md`, and the run's `TASKS.md`. It has **6 planted ledger defects** and **3 decoys**. It measures `code-ops-suite:distill` in program mode on two axes: did it find each defect that blocks a finish line (**recall**), and did it leave well-formed lines alone (**precision**)?

Keep this file out of any context you give the skill. It is the grader, not an input.

The key sets `lineTolerance` to 0, because the planted lines sit next to each other. Cite the exact line.

## Planted defects (should be found)
| ID | Location | Category | What is wrong |
|----|----------|----------|---------------|
| DIST-1 | `PROGRAM.md:24` | over-cap | Open items lists 14 bullets. The cap is 12. |
| DIST-2 | `PROGRAM.md:29` | closed-listed-open | OI-4 is checked off in `TASKS.md` but still listed open. |
| DIST-3 | `PROGRAM.md:34` | no-blocks | OI-9 carries no `Blocks: F<n>`, so it moves to the backlog. |
| DIST-4 | `PROGRAM.md:45` | no-disposition | DEC-3 has no `Disposition:`. |
| DIST-5 | `PROGRAM.md:46` | no-dec-id | The 64 MB cap decision has no DEC id. The next free id is DEC-7, because the archive holds DEC-4. |
| DIST-6 | `PROGRAM.md:47` | superseded-restated | DEC-5 restates DEC-2 in full. It needs `Supersedes: DEC-2`, and DEC-2 moves to the archive. |

## Decoys (should NOT be flagged)
| ID | Location | Why it is fine |
|----|----------|----------------|
| DECOY-1 | `PROGRAM.md:31` | OI-6 is complete: an owner, a done-when check, and a real `Blocks: F3`. |
| DECOY-2 | `PROGRAM.md:48` | DEC-6 links to DEC-1 with `Supersedes:` and does not restate it. |
| DECOY-3 | `BACKLOG.md:3` | A backlog item needs no `Blocks:` field. |

A correct distill closes OI-4 and moves OI-9 to the backlog, which leaves exactly 12 active items, each with a `Blocks:` field. The archive keeps every line it held, and every moved line appears there verbatim.
