# xfn-traps — answer key

A **cross-function** precision fixture. Every decoy is safe *only* because of a guard in its **sole caller**, with **no local tell** on the cited line; each decoy is paired with an identical-looking real bug whose caller lacks that guard. Clearing a decoy requires tracing to the caller — the exact false-positive class an independent refutation (`rigor:CONVENTIONS §I`, `code-ops-suite:CONVENTIONS §7`) is built to catch and that line-local review misses.

## Planted bugs (should be found)
| ID | Line | Class | Why it's real |
|---|---|---|---|
| BUG-1 | 16 | unbounded slice | `sliceTopB(items, n)` slices by `n`; sole caller `pageRaw` passes `req.n` with no clamp. |
| BUG-2 | 32 | reachable fallback | `renderB`'s `ctype !== 'json'` branch is reachable — sole caller `emitAny(ctype, body)` forwards an arbitrary ctype. |
| BUG-3 | 50 | null deref | `useNameB` does `u.name`; sole caller `greetRaw` passes `lookup(id)`, which returns null for a falsy id. |
| BUG-4 | 65 | unbounded percent | `applyDiscountB` uses `pct` unclamped; sole caller `checkoutRaw` passes `pct` raw, so `pct > 1` yields a negative price. |

## Decoys (must NOT be flagged)
| ID | Line | Looks like | Killed by (in another function) |
|---|---|---|---|
| DEC-1 | 9 | unbounded slice | `pageClamped` (the only caller) clamps `n` via `Math.min(req.n ?? 0, 100)`. |
| DEC-2 | 24 | reachable fallback | `emitJson` (the only caller) pins `ctype` to the literal `'json'`, so the branch is unreachable. |
| DEC-3 | 41 | null deref | `greet` (the only caller) guards `if (!u) return 'guest'` before calling. |
| DEC-4 | 58 | unbounded percent | `checkoutClamped` (the only caller) clamps `pct` via `Math.max(0, Math.min(pct, 1))`. |

Each decoy sits ≥7 lines from its bug twin, so scoring (line-tolerance 3) never confuses the two.
