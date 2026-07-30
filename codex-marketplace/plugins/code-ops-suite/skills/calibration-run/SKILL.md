---
name: calibration-run
description: "Use when you want a standardized real-scale calibration run of the suite against a target repo, in an isolated assess-only session, ending in a sanitized trend-table entry. Never quotes the target's internals back into this repo — see docs/techniques/calibration-protocol.md."
---

# CALIBRATION RUN — Standardized Real-Scale Measurement

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:calibration-run`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin — it defines the operating model, safety rails, and evidence standard this skill extends to run measurement — and `docs/techniques/calibration-protocol.md` for the one-way channel rule, the metric table, and the sanitized-note template this skill fills in.
**Mode:** ASSESS · **Consumes:** a target repo (real-scale, not a toy fixture) · **Produces:** a validated sanitized calibration note + an ingested run document under `evals/calibration/` and the re-rendered `evals/CALIBRATION_TABLE.md`; nothing else leaves the isolated session.

A calibration run measures the suite against a real codebase without letting that codebase's internals leak back here. The channel is **one-way**: only the sanitized note (counts, deltas, lessons — no paths/code/URLs) crosses back.

## Phase 0 — Isolation preflight *(checkpoint)*
Confirm: the target repo, that this session's context is **fresh and isolated** (no other repo's state bleeding in), that the run is **assess-only** (no code changes on the target), and the one-way channel rule — only the sanitized note returns, per `docs/techniques/calibration-protocol.md`. Run `node <plugin-root>/scripts/preflight.mjs --artifact-dir <run folder>` — a FAIL stops the run before any fan-out. > **CHECKPOINT:** confirm target, isolation, and the one-way rule before proceeding.

## Phase 1 — Baseline sweep
Dispatch `code-ops-suite:full-sweep` (or `rigor:rigor-sweep` if `rigor` is the mechanism under calibration) in the **`assess-only`** track against the target, letting it run its own phases and checkpoints. This run's artifacts (registers, `DISPATCH_LEDGER.md`, `EXECUTIVE_SUMMARY.md`) stay inside the run folder — they are the raw material Phase 2 extracts from, never quoted here directly.

## Phase 2 — Extract
Run `node <plugin-root>/scripts/calibration-metrics.mjs --artifacts <run folder> [--out <metrics file>]` to pull the quality/token/orchestration/standardization metrics defined in the protocol doc — this call always exits 0; it reports what it found, never gates.

## Phase 3 — Sanitize + validate *(fail-closed)*
Fill the sanitized-note template (`docs/techniques/calibration-protocol.md`) from the extracted metrics: counts and deltas against the prior table row, lessons learned — zero paths, code, or URLs from the target. Fill the note's **`## Machine block`** too, one line per shape in that template (run-date, suite, target-class, track, findings/confirmed, paneled/survived/repro-exempt, severity, tokens/dispatches, orchestration, standardization, coverage, and a `lesson:` line per lesson — `recur L-NNN` for one already in the store, `new <class> — <statement>` otherwise); it is line-based prose, never fenced. Gate the whole note with `node <plugin-root>/scripts/calibration-metrics.mjs --validate-note <note file>` — a structural scrub that fails closed on any path/code-fence/URL/email and on a missing or malformed Machine block; fix the note and re-validate rather than working around a hit.

## Phase 4 — Record *(fail-closed)*
Back in the code-ops repo, from its root: `node scripts/calibration-graph.mjs ingest --note <note file>` (writes `evals/calibration/runs/R-NNN.json` plus any new lessons; refuses to overwrite an existing run), then `node scripts/calibration-graph.mjs render` (regenerates `evals/CALIBRATION_TABLE.md` — a derived view, never hand-edited), then `node scripts/calibration-graph.mjs validate` (fails closed on a broken schema, id, or edge endpoint). See `docs/techniques/calibration-graph.md`.

## Done when
The sanitized note — Machine block included — passes `--validate-note`; the run is ingested into `evals/calibration/`, the table re-rendered from it, and `calibration-graph.mjs validate` passes; and nothing from the target's internals — no path, code, or URL — appears anywhere outside the isolated session. Present the sanitized note and the rendered table row.
