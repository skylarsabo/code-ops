# Calibration note — fixture (malformed Machine block)

The `findings` line below uses a comma where the shape grammar requires a semicolon, and
the `track` line carries a value outside the enum. An ingest that guessed at either would
write a wrong run document forever, so both must be refused by name.

## Machine block

run-date: 2026-07-30
suite: code-ops-suite@1.26.0
target-class: go-event-pipeline; control: no
track: assess-and-fix
findings: 31, confirmed: 20
paneled: 4 of 7 eligible; survived: 3; repro-exempt: 1
severity: unknown
tokens: unknown operative; dispatches: 11
orchestration: dangling 0; failed 0; redispatched 0
standardization: enforcements 0; traceless clean
coverage: unknown
