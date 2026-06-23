# drifted-docs — answer key

A tiny repo (`repo/`) whose `README.md` documents `src/server.js`, with **3 real drifts** and **2 decoys** (doc statements that look like drift but are accurate or intentionally aspirational). It measures `code-ops-suite:doc-alignment` on the two axes that matter: did it find the real drift (**recall**), and did it stay quiet on the decoys (**precision**)?

Keep this file out of any context you give the skill — it's the grader, not an input.

## Planted drift (should be found)
| ID | Location | Category | What's wrong |
|----|----------|----------|--------------|
| DRIFT-1 | `README.md:7` | stale-value | "default port is 3000" but `src/server.js` sets `DEFAULT_PORT = 8080`. |
| DRIFT-2 | `README.md:13` | wrong-contract | "`start(options)` returns a Promise" but the code returns the port number synchronously. |
| DRIFT-3 | `README.md:17` | phantom-api | Documents `connect(url)`, but no such function is exported. |

## Decoys (should NOT be flagged)
| ID | Location | Why it's fine |
|----|----------|---------------|
| DEC-1 | `README.md:21` | "not yet implemented" is an explicitly aspirational Roadmap item, not drift. |
| DEC-2 | `README.md:25` | "`DEFAULT_PORT` is exported" is accurate — the code does export it. |

A run that flags either decoy has a precision problem — exactly what doc-alignment's stale-vs-aspirational distinction is meant to avoid.
