# Calibration note (fixture, clean)

Recall held steady across the run: 4 planted bugs found, 0 decoys flagged. Tier
distribution stayed CONFIRMED-heavy, matching the prior snapshot. No regressions
observed versus the last calibration pass. See FINDINGS_REGISTER.md and
DISPATCH_LEDGER.md for the underlying counts, and `code-ops-suite:codebase-audit`
for the skill under test.

## Machine block

run-date: 2026-07-29
suite: code-ops-suite@1.26.0, rigor@1.9.0
target-class: python-service; control: no
track: assess-only
findings: 28; confirmed: 19
paneled: 6 of 6 eligible; survived: 4; repro-exempt: 0
severity: c/h/m/l/n as 0/6/12/8/2
tokens: 1530000 operative; dispatches: 9
orchestration: dangling 0; failed 0; redispatched 1
standardization: enforcements 3; traceless clean
coverage: covered-negatives 2; slices swept 5 of 6
lesson: recur L-001
