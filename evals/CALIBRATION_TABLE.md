# Calibration trend table

The trend SSOT for real-scale calibration runs (`/code-ops-suite:calibration-run`),
sibling to `evals/FLOOR_TABLE.md`. Fed **only** by a sanitized calibration note that
has already passed `scripts/calibration-metrics.mjs --validate-note` — never by a
hand-written row, and never with a target repo's name, path, or internals. See
`docs/techniques/calibration-protocol.md` for the one-way channel rule, the run
design, and the note template a row is extracted from.

| date | suite versions | target label | dispatches | CONFIRMED ratio | refutation survival | notes |
| --- | --- | --- | --- | --- | --- | --- |
