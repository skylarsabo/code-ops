# Evals and calibration

Charter: `evals/` — the two eval kinds, the calibration graph store, and the couplings that make an eval or store edit ripple; leaves out the CI wiring itself (see ci-workflows) and the gate scripts under test (see gate-scripts).

## Shape rationale

The layer is bifurcated by *what can be checked deterministically*, not by subject: automated evals (pure-Node, no model) guard mechanical behavior of `scripts/*`; judgment evals (fixtures + ANSWER_KEYs) measure skill quality and deliberately do **not** gate PRs — model-in-the-loop recall varies run to run, so they track trend; only deterministic drift checks gate. Toy fixtures are regression guards, not discriminators: recall is saturated even for the weak tier (FLOOR_TABLE), so do not "improve" a fixture to raise signal. Real discrimination comes from private-repo calibration runs, whose channel is one-way: only a sanitized note with a machine-parsed `## Machine block` crosses back.

The calibration graph store (`evals/calibration/`) exists because a lesson's afterlife was previously unqueryable prose; `validate` fails closed on a lesson whose "fix" nothing mechanical enforces, and `render --check` fails closed on a table cell drifting from its run. `CALIBRATION_TABLE.md` is a pure render — preamble text lives in the script and byte-compares; derived cells (ratios, recurrence) are never stored. Hand-editing the table is always wrong.

## Couplings that make edits ripple

- **`evals/lint-plugins/run.mjs` transcribes SHARED_PASSAGES/AGENT_SHARED_PASSAGES verbatim** as PINNED_TEXTS/ALWAYS_GATED_TEXT — a new or edited pin is a two-file change or a CI-only failure. Its fixtures must also carry the four real plugin names because SHARED_PASSAGES hardcodes CONVENTIONS paths; the filler plugins exist for that reason alone.
- **`evals/calibration-graph/run.mjs` runs against the REAL store and hardcodes its current answers** (per-lesson recurrence counts, per-run trend numbers, superseded-by). Every calibration ingest is therefore a two-file change: store + this eval's expectations. No expectation generator exists; update by hand.
- **Graph edges point at working-tree targets**: an `enforced-by EVAL:`/`GATE:` edge fails `validate` if the eval file disappears or the gate loses its check slug — evals and gates are load-bearing graph nodes; renaming one breaks calibration validation, not just the eval.
- The two hand-written Machine-block grammars (`calibration-metrics.mjs` and `calibration-graph.mjs`) are cross-checked by the calibration-graph eval, so a grammar tweak must land in both.
- Run↔lesson semantics: a run doc's `lessons` array is the only source of surfaced-in/recurred-in; edges carry only fixed-in/enforced-by/verified-in/deferred/supersedes; a `verified-in` run deliberately does not list the lesson. Status precedence: SUPERSEDED > ENFORCED (fixed+enforced) > UNENFORCED (fixed-only) > DEFERRED > OPEN.

## Invariants

- **Answer-key isolation is convention only — no mechanical gate greps for leakage.** The runner scopes the skill to the `repo/` subdir while the key sits in the parent; treat isolation as a human invariant that will not fail CI.
- Answer keys may never drift from fixtures: `score.mjs --check` re-reads each anchor's cited line, and CI loops it over every key (Linux leg only — Windows CI does not cover key drift).
- Ingest is append-only (refuses to overwrite an existing run doc); malformed notes are refused, never guessed; a run doc may only come from a note that passed `--validate-note`; no orphan or undefined lessons.
- `register-staleness` has no ANSWER_KEY and that is correct — it asserts exact classification strings itself, including that BUG-007 stays FRESH *with* an `unparseable` advisory; "fixing" that to a failure is a regression.

## score.mjs semantics that shape fixture edits

Verdict = recall ≥ threshold AND flagged decoys ≤ maxDecoys. Matching is path-suffix + basename within a uniform `lineTolerance: 3`, and ambiguity resolves **toward the decoy** — so moving a planted bug within ~4 lines of a decoy converts recall credit into a false positive from a purely cosmetic edit; keep planted and decoy lines apart. Candidates parsed from Markdown pass through an extension allowlist — a fixture in an unlisted language scores zero recall silently. Per-fixture thresholds encode difficulty on purpose (precision-under-temptation fixtures relax recall and allow one decoy); normalizing them erases the design. Any line shift in `evals/*/repo/**` must be mirrored in the key and verified with `score.mjs <key> --check`. `score.mjs` branches carry defect-ID comments that are live regression pins asserted by *other* evals (e.g. script-guards asserts SCR-019's exit code) — simplifying them breaks a different eval. The weekly eval workflow pins its model and opts out of the tier doctrine deliberately: comparability beats modernity.
