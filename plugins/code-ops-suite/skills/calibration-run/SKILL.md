---
description: "Use when you want a standardized real-scale calibration run of the suite against a target repo, in an isolated assess-only session, ending in a sanitized trend-table entry. Never quotes the target's internals back into this repo — see docs/techniques/calibration-protocol.md."
disable-model-invocation: true
---

# CALIBRATION RUN — Standardized Real-Scale Measurement

**Invoked as `/code-ops-suite:calibration-run`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin — it defines the operating model, safety rails, and evidence standard this skill extends to run measurement — and `docs/techniques/calibration-protocol.md` for the one-way channel rule, the metric table, and the sanitized-note template this skill fills in.
**Mode:** ASSESS · **Consumes:** a target repo (real-scale, not a toy fixture) · **Produces:** a validated sanitized calibration note + an appended row in `evals/CALIBRATION_TABLE.md`; nothing else leaves the isolated session.

A calibration run measures the suite against a real codebase without letting that codebase's internals leak back here. The channel is **one-way**: only the sanitized note (counts, deltas, lessons — no paths/code/URLs) crosses back.

## Phase 0 — Isolation preflight *(checkpoint)*
Confirm: the target repo, that this session's context is **fresh and isolated** (no other repo's state bleeding in), that the run is **assess-only** (no code changes on the target), and the one-way channel rule — only the sanitized note returns, per `docs/techniques/calibration-protocol.md`. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs --artifact-dir <run folder>` — a FAIL stops the run before any fan-out. > **CHECKPOINT:** confirm target, isolation, and the one-way rule before proceeding.

## Phase 1 — Baseline sweep
Dispatch `/code-ops-suite:full-sweep` (or `/rigor:rigor-sweep` if `rigor` is the mechanism under calibration) in the **`assess-only`** track against the target, letting it run its own phases and checkpoints. This run's artifacts (registers, `DISPATCH_LEDGER.md`, `EXECUTIVE_SUMMARY.md`) stay inside the run folder — they are the raw material Phase 2 extracts from, never quoted here directly.

## Phase 2 — Extract
Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/calibration-metrics.mjs --artifacts <run folder> [--out <metrics file>]` to pull the quality/token/orchestration/standardization metrics defined in the protocol doc — this call always exits 0; it reports what it found, never gates.

## Phase 3 — Sanitize + validate *(fail-closed)*
Fill the sanitized-note template (`docs/techniques/calibration-protocol.md`) from the extracted metrics: counts and deltas against the prior `evals/CALIBRATION_TABLE.md` row, lessons learned — zero paths, code, or URLs from the target. Gate it with `node ${CLAUDE_PLUGIN_ROOT}/scripts/calibration-metrics.mjs --validate-note <note file>` — a structural scrub that fails closed on any path/code-fence/URL/email; fix the note and re-validate rather than working around a hit.

## Phase 4 — Record
Append one row to `evals/CALIBRATION_TABLE.md`, keyed by the calibrated suite's plugin version(s) and today's date, using a generic target label (never the target repo's name).

## Done when
The sanitized note passes `--validate-note`; a row is appended to `evals/CALIBRATION_TABLE.md`; and nothing from the target's internals — no path, code, or URL — appears anywhere outside the isolated session. Present the sanitized note and the new table row.
