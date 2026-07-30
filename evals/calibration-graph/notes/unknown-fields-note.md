# Calibration note — fixture (the `unknown` alternatives)

Every Machine-block line that has an `unknown` alternative uses it here: an operative token
total the harness never reported, an unlabelled severity mix, an unknown paneling
denominator, and a run that swept no slice inventory. These must ingest as explicit `null`
rather than being refused or defaulted to zero — a zero would read as a measured zero.

## Machine block

run-date: 2026-07-31
suite: code-ops-suite@1.26.0
target-class: rust-cli; control: no
track: implement
findings: 4; confirmed: 4
paneled: 2 of unknown eligible; survived: 2; repro-exempt: 0
severity: unknown
tokens: unknown operative; dispatches: 3
orchestration: dangling 0; failed 0; redispatched 0
standardization: enforcements 1; traceless clean
coverage: unknown
lesson: recur L-013

## Lessons

Nothing new surfaced; the ledger-atomicity rule was exercised and held.
