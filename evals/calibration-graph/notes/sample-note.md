# Calibration note — fixture (sanitized)

Fixture note for the calibration-graph regression eval. It exists to exercise
`calibration-graph.mjs ingest`, so only its `## Machine block` and `## Lessons`
sections are load-bearing. No target repo is named or described here.

## Machine block

run-date: 2026-07-30
suite: code-ops-suite@1.26.0, rigor@1.9.0
target-class: go-event-pipeline; control: no
track: assess-only
findings: 31; confirmed: 20
paneled: 4 of 7 eligible; survived: 3; repro-exempt: 1
severity: c/h/m/l/n as 1/6/12/9/3
tokens: 1400000 operative; dispatches: 11
orchestration: dangling 0; failed 1; redispatched 1
standardization: enforcements 2; traceless clean
coverage: covered-negatives 2; slices swept 6 of 8
lesson: recur L-001
lesson: recur L-014
lesson: new instrument — Refutation receipts written as prose bullets are invisible to the verdict parser; require one keyed line per finding

## Lessons

Two prior lessons recurred and one new instrument gap surfaced in the refutation log.
