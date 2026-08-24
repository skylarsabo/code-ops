# Evals and calibration

Charter: deterministic regression evals, judgment fixtures, and the calibration graph. Excludes the workflow configuration that schedules them.

Deterministic Node evals are merge evidence. Judgment fixtures measure model behavior and remain separate from merge gates because model output varies. Answer keys stay outside the context handed to an evaluated skill. The calibration graph preserves only sanitized, machine-parseable lessons from private runs.

The new orchestration substrate has direct regression coverage. `run-contract` exercises versioned contracts, scope conflict rejection, dependency cycles and ordering, journal replay, retry limits, and acceptance. `context-snapshot` covers exact-state identity, cache reuse, untracked policy, and drift. `context-bundle` covers scope selection, import neighbors, Atlas freshness, empty- and broad-context markers, and byte-budget markers.

Documentation regressions now test generic hub discovery, structural-error rejection during planning, interior glob matching such as `plugins/*/skills/**`, installed sibling-script resolution, and manifest-routed citation scanning. A citation gate still rejects absent targets, out-of-range lines, and inverted ranges while skipping fenced examples; bracket syntax and interior directory spaces are deliberate parse cases.

The cost estimator counts only final-result records at the stable result schema version, rather than assuming a contract-version match makes historical cost data comparable. The calibration graph is append-only source with a rendered table. Graph validation and table drift checks run against the real store. Do not hand-edit the table or treat an isolated fixture score as evidence of production quality.
