# Findings Register (fixture)

Fixture register: covered negatives sit alongside entries as body lines, never as items.

NO-FINDINGS: auth middleware — full call chain read; every token compare is timing-safe.
NO-FINDINGS: migration scripts — all three reviewed; none drop or rewrite existing rows.

## FIND-001
- Tier: CONFIRMED
- Severity: medium
- Location: src/mod1.js:3
