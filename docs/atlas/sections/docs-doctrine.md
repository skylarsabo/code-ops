# Docs and doctrine

Charter: the tracked `docs/` tree — which doc is SSOT for what, which couplings lint enforces, and which apparent duplicates are deliberate; leaves out the gitignored scratch dirs (local-only by ADR 0001) and the plugin CONVENTIONS files themselves (see plugins-and-skills).

## Role division

The handbook is the human front door and router — it is **not** the doctrine SSOT; runtime doctrine lives in each plugin's CONVENTIONS.md, because single-plugin installs never ship the handbook (ADR 0001). Never move doctrine a skill needs at runtime out of CONVENTIONS into the handbook. `docs/handbook/11-standard-operating-mode.md` is the declared SSOT for default routing and the tier/effort rule, delegating the backing table to `docs/techniques/subagent-trade-offs.md`.

Technique docs are mechanism SSOTs cited by the scripts that implement them — editing doc or parser alone is a real break: `artifact-grammars.md` (the parse grammars for registers/ledgers/narration), `calibration-protocol.md` (one-way channel + Machine-block grammar), `calibration-graph.md` (store shape; demotes CALIBRATION_TABLE.md to a rendered view), `atlas.md` (manifest schema), `subagent-trade-offs.md` (model tiers, hard-coupled to AGENT_MODEL_FLOORS), `skill-composition.md` (the cross-skill invocation map — nothing re-derives it).

Nothing under `docs/` is a derived artifact except `docs/atlas/MANIFEST.json`, which only `atlas-check.mjs` may write.

## What lint gates vs what drifts silently

Gated: per-skill handbook heading + router-table reference (both directions), per-plugin `**N commands**` bullets, root README `(N skills)` counts, skill-composition edge resolution, subagent-trade-offs model annotations, and every `path:line` citation in handbook/techniques/guides/adr (`check-doc-citations.mjs`, wired into CI; fenced blocks skipped deliberately for fictional examples).

Drifting silently (known, accepted): aggregate command totals (`**61 commands**` and the per-plugin restatements in handbook README prose); `§N` citations in docs prose (check 9 covers skills + agents only — a renumbered CONVENTIONS section breaks skills loudly but docs silently); `Verified-at:` stamps in docs (convention, no gate). A doc-alignment sweep should target exactly these classes plus stale `line N` citations — agents miss them; sweep mechanically.

## Deliberate near-duplicates — do not dedupe

- The handbook README's condensed 12-row router vs the full gated router table in `docs/handbook/commands/README.md`: only the latter is parity-checked; the former explicitly defers to it.
- The shared-backbone paragraph is intentionally restated across handbook README, mental-model chapter, commands README, and both guides — deliberate but **ungated** (no docs prose is in SHARED_PASSAGES; every pinned file is under `plugins/`).
- Root README's `(N skills)` counts and commands README's `**N commands**` counts are two independent, separately-gated counters over the same skill dirs.

## Gotchas

- `docs/specs/`, `docs/superpowers/`, `docs/code-ops-run/` are gitignored scratch (ADR 0001) and invisible to `check-doc-citations.mjs` (it enumerates via `git ls-files`) — exclude from alignment/staleness sweeps.
- `docs/atlas/` is tracked but sits outside every docs gate (not in the citation scanner's SCAN_DIRS) — atlas prose gets no mechanical citation check, which is one reason sections should cite files/symbols rather than line numbers.
- The atlas dir is excluded from its own staleness diff, so this `docs`-scoped section is invalidated by edits to the rest of `docs/`, never by atlas edits themselves.
- ADR 0001 is itself stale on one point: it claims `check-doc-citations.mjs` is run-on-demand only, but the script is a CI step in `validate.yml` — a known docs defect at the time this section was written, not a reason to distrust the ADR's placement reasoning.
