# Fixture register: reviewer-round-lettered IDs must parse; IDs cited in prose must not.

## BUG-A12
- Tier: CONFIRMED
- Severity: high
- Location: src/auth.js:12
- Evidence: same root cause as BUG-003, which the team tracked as INC-2024 at the time.

## BUG-A13
- Tier: PROBABLE
- Severity: medium
- Location: src/session.js:44
- Evidence: duplicate of BUG-003; see also INC-2025 in the historical incident log.
