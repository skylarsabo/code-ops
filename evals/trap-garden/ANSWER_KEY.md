# trap-garden — answer key

A tiny repo (`repo/`) with **5 real bugs** and **6 tempting decoys** (code engineered to look buggy but be correct). Built to test precision under temptation — whether a finding skill rejects the plausible-but-fine constructs a naive reviewer would flag.

Keep this file out of any context you give the skill — it is the grader, not an input.

## Planted bugs (should be found)
| ID | Location | Class |
|----|----------|-------|
| BUG-1 | `src/checkout.js:11` | `parseInt` without a radix. |
| BUG-2 | `src/checkout.js:21` | money computed in floats with no rounding. |
| BUG-3 | `src/checkout.js:33` | off-by-one (`<=` reads past the end). |
| BUG-4 | `src/checkout.js:46` | `==` coercion (`'' == 0` reads as paid). |
| BUG-5 | `src/checkout.js:58` | shared accumulator read-before / written-after an `await` (race/TOCTOU). |

## Decoys (should NOT be flagged)
| ID | Location | Why it's fine |
|----|----------|---------------|
| DEC-1 | `src/checkout.js:6` | md5 for a non-security cache key. |
| DEC-2 | `src/checkout.js:16` | `parseInt` *with* a radix. |
| DEC-3 | `src/checkout.js:26` | deliberate `== null` idiom. |
| DEC-4 | `src/checkout.js:40` | intentional inclusive loop bound. |
| DEC-5 | `src/checkout.js:51` | intentional `void` fire-and-forget. |
| DEC-6 | `src/checkout.js:64` | bounded regex over length-capped input. |

A run that flags any decoy has a precision problem under temptation — what the verification-first methodology is meant to avoid.
