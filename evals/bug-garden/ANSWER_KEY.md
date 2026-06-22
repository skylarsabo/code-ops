# bug-garden — answer key

A tiny repo (`repo/`) with **4 real bugs** and **3 decoys** (things that look like bugs but are intentional/correct). It measures `rigor:bug-hunt` / `rigor:quality-scan` / `code-ops-suite:codebase-audit` on the two axes that matter: did it find the real bugs (**recall**), and did it stay quiet on the decoys (**precision** — the suite's whole pitch)?

Keep this file out of any context you give the skill — it's the grader, not an input.

## Planted bugs (should be found)
| ID | Location | Category | What's wrong |
|----|----------|----------|--------------|
| BUG-1 | `src/cart.js:6` | off-by-one | `for (… i <= items.length …)` reads `items[items.length]` (undefined). |
| BUG-2 | `src/cart.js:20` | logic + mutation | `prices.sort()[0]` sorts lexicographically and mutates the input — wrong "cheapest". |
| BUG-3 | `src/auth.js:5` | null deref | `row.profile` when `row` is null (user not found). |
| BUG-4 | `src/auth.js:20` | missing radix | `parseInt(s)` with no radix mis-parses `'0x10'` / legacy leading-zero strings. |

## Decoys (should NOT be flagged)
| ID | Location | Why it's fine |
|----|----------|---------------|
| DEC-1 | `src/cart.js:26` | `found == null` is the deliberate null-or-undefined idiom — a correct `==`. |
| DEC-2 | `src/auth.js:10` | `void sendAudit(...)` is intentional fire-and-forget, not a missing `await`. |
| DEC-3 | `src/auth.js:16` | `now >= token.expiresAt` is the correct exclusive-expiry boundary, not an off-by-one. |

A run that flags any decoy has a precision problem — exactly what the verification-first design is meant to avoid.
