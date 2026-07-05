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

## BUG-005 — anchored, code still on the cited line (must be FRESH)
Tier: CONFIRMED · Location: src/auth.js:5 · Anchor: `given == expected` · Verified-at: HEAD
Evidence: naive == token comparison; the verbatim anchor still sits on the cited line, so the citation is real.

## BUG-006 — anchored, citation drifted off its code (must be DRIFTED)
Tier: PROBABLE · Location: src/auth.js:5 · Anchor: `crypto.timingSafeEqual`
Evidence: the register claims a timing-safe compare on this line, but line 5 says `given == expected` — a stale/hallucinated citation the anchor check catches even though the file and line still exist.

## BUG-007 — anchor labeled but not delimited (must be FRESH plus an unparseable-anchor advisory)
Tier: PROBABLE · Location: src/auth.js:5 · Anchor: given == expected
Evidence: the anchor value carries no backtick or quote delimiter, so the checker cannot parse it; the report must say so instead of silently skipping the item's anchor comparison.
