# Findings Register (eval fixture — seeded with mixed-freshness items)

A register that has gone partly stale, exactly like the real field failure: some
items still reproduce, one moved, one was already fixed but the register still lists it.

## BUG-001 — still present (must be FRESH)
Tier: CONFIRMED · Location (file:line): src/auth.js:3 · Verified-at: abc1234
Evidence: token compared with `==` instead of a timing-safe compare.

## BUG-002 — code shifted, cited line now past EOF (must be MOVED)
Tier: PROBABLE · Location: src/util.js:500
Evidence: off-by-one in slice bounds.

## BUG-003 — already fixed, file removed (must be GONE)
Tier: CONFIRMED · Location: src/legacy.js:10
Evidence: SQL built by string concatenation. Represents an item the team fixed; the register went stale and still lists it.

## BUG-004 — no location cited (must be NO-REF)
Tier: PROBABLE
Evidence: a finding that names no checkable file and line, so it must be re-triaged by hand and counts toward the fail-closed exit.
