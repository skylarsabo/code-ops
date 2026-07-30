# Calibration note (fixture, allowlisted mentions only)

Findings are tracked in `FINDINGS_REGISTER.md` and dispatches in `DISPATCH_LEDGER.md`.
The skill under test was `code-ops-suite:codebase-audit`. No regressions versus the
prior snapshot.

## Machine block

run-date: 2026-07-28
suite: code-ops-suite@1.26.0
target-class: ts-monorepo-telephony; control: yes
track: implement
findings: 16; confirmed: 9
paneled: 3 of 4 eligible; survived: 2; repro-exempt: 1
severity: unknown
tokens: 1100000 operative; dispatches: 9
orchestration: dangling 1; failed 0; redispatched 0
standardization: enforcements 0; traceless dirty
coverage: unknown
lesson: recur L-013
lesson: new protocol — ledger rows must be written atomically with the dispatch call.
