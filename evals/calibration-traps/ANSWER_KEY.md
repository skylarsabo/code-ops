# calibration-traps — answer key

A tiny repo (`repo/`) encoding the bug and decoy **classes** distilled from a real-scale (~140k-LOC) calibration run of the suite: **4 real bugs** and **4 decoys** (by-design / correct code that looks buggy). The decoys specifically encode the false-positive classes that calibration surfaced — they are the regression guard for the disconfirmation rules (intent-annotation, locate-the-handler). The suite should find the bugs and stay quiet on the decoys.

Keep this file out of any context you give the skill — it is the grader, not an input.

## Planted bugs (should be found)
| ID | Location | Class |
|----|----------|-------|
| BUG-1 | `src/sample.js:12` | leading-zero numeric coercion (`Number()` drops leading zeros). |
| BUG-2 | `src/sample.js:26` | best-effort clear before a durable `remove()` that can throw. |
| BUG-3 | `src/sample.js:41` | privileged-action audit records the actor but not the grantee. |
| BUG-4 | `src/sample.js:53` | fail-closed preflight leaks an unhandled rejection (unwrapped async). |

## Decoys (should NOT be flagged)
| ID | Location | Why it's fine |
|----|----------|---------------|
| DEC-1 | `src/sample.js:7` | accepted-deferred trade-off documented + tracked at the line (KNOWN / TKT-419). |
| DEC-2 | `src/sample.js:17` | unreachable fallback — the sole caller always passes ctype `'json'`. |
| DEC-3 | `src/sample.js:35` | `n` is clamped by the sole caller; this inner layer trusts the invariant. |
| DEC-4 | `src/sample.js:47` | `statusFor` returns null for `'b'` in every state, so A/B order is neutral. |

A run that flags any decoy missed a documented intent, a reachability invariant, or a handler that exists — exactly the false-positive classes the disconfirmation rules target.
