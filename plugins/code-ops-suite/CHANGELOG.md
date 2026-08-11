# Changelog — code-ops-suite

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

## 1.36.0
- **Recording a calibration run is now five steps, not four** — the new final step syncs `evals/calibration-graph/run.mjs`. That eval runs against the real store and hardcodes its answers, so every ingest changes two files. Two consecutive ingests missed the step, which passes every local gate and fails only in CI. Both the protocol doc and the `calibration-run` skill now name the step, and the skill's `Done when` requires the eval to pass.

## 1.35.0
- **New `CONVENTIONS.md` §14, Writing standard** — every skill writes to one house standard. The section pins one term per concept, active voice, and one instruction per sentence. It caps instructions at 20 words and explanation at 25. Clarity outranks conformance, so a writer who breaks a rule states why. Full rules live in `docs/techniques/writing-standard.md`.

## 1.34.0
- **New optional `config:` Machine-block line** — `config: lead <model-class>; operatives <model-class>`, parsed identically by `calibration-metrics.mjs --validate-note` and `calibration-graph.mjs ingest`. It records the orchestration a calibration run was driven under, which is what makes one run's numbers comparable to another's rather than merely sequential. Optional like `atlas:`: a note without it validates and ingests exactly as before, so the runs recorded before the tier experiment stay valid.
- **The run-document schema gains an optional `config` object** (`{lead, operatives}`, both kebab model-class slugs), fail-closed on a malformed shape. A run that did not record its orchestration omits the field entirely rather than defaulting one — a guessed lead class would silently mis-group a comparison. `query trend` prints a config tail only for the runs that carry one; the rendered table is unchanged.
- **`calibration-run` confirms the orchestration configuration at the Phase 0 checkpoint** and pins the operative tier in every dispatch brief, since a run that re-tiers mid-flight is not comparable to any other.
- **A three-run orchestration-configuration experiment is pre-registered** in the calibration protocol as a baseline gap analysis: a quality baseline, a candidate read against it on fixed axes, and a cost-floor reference. Gaps feed the existing `instrument`/`suite`/`protocol` lesson classes and the remediation loop.

## 1.33.0
- **Model routing is quality-first** (`CONVENTIONS.md` §1, `hooks/routing-card.mjs`): every judgment-bearing sub-agent dispatch runs on the stronger model whatever tier the orchestrator itself is on; only mechanical breadth sweeps and transcription-style work drop a tier. A shallow or failed report costs a redispatch plus the orchestrator's attention, which outweighs the stronger model's price premium.
- **`run-cost-audit` prices under-tiering as a cost, not a saving**: a judgment-bearing dispatch routed below the strong tier is now a finding, reported with the redispatches and discarded reports it caused.

## 1.32.0
- **Tier discipline is enforced at the operative boundary** (`CONVENTIONS.md` §7, `agents/reviewer.md`): an operative may label a finding CONFIRMED only when an executed repro or trace sits in its own transcript; a statically-argued finding caps at PROBABLE and only the lead promotes it. Calibration run R-004 saw six findings arrive labelled CONFIRMED on static reasoning alone, which made the confirmed ratio measure labelling discipline rather than evidence depth.
- **Operative reports are persisted in the turn they land** (`CONVENTIONS.md` §1): the report goes to the run's artifact folder before any other work, because a report that lives only in the conversation is one blocked turn from being lost.
- **Report shape is gated before a unit counts as covered** (`CONVENTIONS.md` §1): a brief that never reached its operative looks exactly like a completed dispatch in the dispatch record until someone reads the report.
- **Refutation panels are staffed by distinct lenses** (`CONVENTIONS.md` §7): an odd panel of identical skeptics can repeat one reader's misread and confirm the wrong answer by majority; correctness, configuration-reading, and reachability are separate seats.

## 1.31.0
- **Failed rate and redispatch rate are no longer mutually exclusive per unit.** A ledger row carries one status cell, so a unit that failed and was then retried read as `redispatched` alone and the pair understated recovery. `calibration-metrics.mjs` now derives both rates from the ledger's write journal when one sits beside it: a unit counts toward the failed rate if it EVER entered `failed` and toward the redispatch rate if it was EVER redispatched, independently. The row grammar is unchanged.
- **The basis is always stated, and a degraded rate is never silent.** The report carries a `rate basis:` line — `journal-derived`, or `snapshot-only` for a pre-journal artifact folder. A journal that is present but carries an unreadable or malformed line is rejected WHOLE (never partly used), its violations printed as `!! JOURNAL`, with the fallback named on the basis line. The dangling rate and the `by status` breakdown still report final status, by definition.
- `--json` gains `ledger.journal { present, derived, violations }` plus `ledger.everFailed` / `ledger.everRedispatched` — the numbers the two rate lines print.

## 1.30.1
- **Four register/refutation grammar fixes, each pinned by a regression case.** A per-entry length budget now terminates its entry at the next entry head, a covered-negative `NO-FINDINGS:` line, or a non-entry heading, so a trailing block is no longer charged to the entry above it; refutation receipts are keyed by an ID at the START of the line, so prose citing a finding is neither an unparseable receipt nor a second verdict; the themed-sibling-report warning walks the artifact folder recursively (bounded by depth, skipping dot-directories and `node_modules`) so per-slice reports in subdirectories are seen; and `calibration-metrics.mjs` no longer reads its own report back as a sibling register.
- **The sanitized-note template prescribes a severity mix the note gate accepts.** The prose half now reads `severity mix c/h/m/l/n as <N/N/N/N/N>` — a bare `0/6/22/9/10` is five slash-separated segments and the path scrub read it as a unix path, so a note written exactly to template failed closed. The scrub itself is unchanged and no less strict.

## 1.30.0
- **`dispatch-ledger.mjs` now journals its own writes**, so a phantom row is mechanically detectable. `add`, `update`, and `phase` append a JSONL entry to `<ledger>.journal.jsonl` before writing the ledger, and `check` replays that journal against the rows: a row with no journaled `add` is reported as `!! PHANTOM` and fails closed without `--strict` — a row minted by a direct or batch artifact edit (often straight at `reported`) was previously indistinguishable from a real dispatch in a finished artifact. A hand-edited status cell (`!! OUT-OF-BAND`), a journaled row deleted from the ledger (`!! MISSING-ROW`), and an unreadable journal line all fail closed too.
- **Pre-journal ledgers keep working.** A journal is created only by the command that creates the ledger; `update` never mints one. An existing ledger with no journal stays unjournaled and `check` reports it as an advisory (exit 0), promoted to a failure under `--strict`. The journal entry is written before the ledger so a crash between the two surfaces as a missing row, never as a phantom.
- The `check` summary keeps its existing sentence and gains a `journal: verified|absent|N violation(s)` tail.

## 1.29.0
- **A calibration run now measures the target's atlas.** `calibration-run`'s baseline sweep opens with an `atlas-check.mjs check` (or an `init` when the target keeps none), hands each section's FRESH/STALE state into the sweep briefs, and refreshes the stale sections in the session that has the context. Four counts come back: sections held, consumed FRESH, refreshed, and falsified.
- **New optional `atlas:` Machine-block line** — `atlas: sections N; fresh N; refreshed N; falsified N`, parsed identically by `calibration-metrics.mjs --validate-note` and `calibration-graph.mjs ingest`. A note without the line validates and ingests exactly as before, so the runs recorded before the atlas leg stay valid; a present line must carry all four counts.
- **The run-document schema gains an optional `atlas` object**, bounded fail-closed like every sibling count group: no negative count, `fresh + refreshed` may not exceed `sections`, and neither may `falsified`. `query trend` prints an atlas tail only for the runs that carry one; the rendered table is unchanged.
- **A falsified section is a lesson, not a staleness report** — the calibration protocol routes it to the existing `instrument`/`protocol` lesson classes, since it means a run was handed a false premise.

## 1.28.0
- **New `atlas` skill.** Maintains a per-repo knowledge cache of judgment-only sections, each carrying scope globs and a verified-at stamp recorded in a machine-readable manifest rather than in prose.
- **New vendored `atlas-check.mjs`** with `init`, `add`, `check`, `stamp`, and `inbox` modes. `add` registers a section (repeatable `--scope`) with a stub file and an `unverified` pin, so a new section is `STALE` until someone stamps it. Staleness is computed by git pathspec diff since each section's stamp, against the working tree — an uncommitted edit to a scoped tracked file counts. A stamp must be an immutable object name (lowercase hex, 7-40 chars, or the `unverified` placeholder): a moving ref such as `HEAD` or a branch name is a fail-closed schema violation, since it would re-resolve on every run and never go stale. That shape rule is backed by a resolution-time rule, since a branch or tag *named* like a sha would otherwise pass it and still move: a value claimed to be a pin must resolve to a full sha that extends it, in `check` and in `stamp --at` alike. An unresolvable stamp reports fail-safe `STALE`; a malformed manifest is fail-closed; the coverage sweep flags unmapped top-level paths as advisories.
- **`ship`'s closing phase refreshes the sections the change made stale**, while the diff rationale is still in-session.
- **`CONVENTIONS.md` gains the stamp-trust rule** — a FRESH section is consumed without re-verification, a STALE one is treated as a lead.

## 1.27.0
- **Calibration runs are recorded as a knowledge graph.** The calibration store under `evals/calibration/` holds one document per run, lesson nodes carrying stable IDs, and edges linking each lesson to the fixes, enforcements, and verifying runs that answer it — so a lesson's fate is queryable instead of buried in prose.
- **`evals/CALIBRATION_TABLE.md` is now a derived view.** The new root-level `scripts/calibration-graph.mjs` renders the table from the store and drift-checks it (`render --check`) alongside `validate` for store integrity.
- **`calibration-metrics.mjs` gains a `--json` emit mode** and fails closed when a sanitized note is missing or malforms its Machine block. Its `paneled:` shape accepts `of unknown eligible`, matching the ingest side that maps an unmeasured denominator to null.
- **`calibration-run`'s closing phase switches from hand-appending a table row** to validate, ingest, render, and graph-validate.

## 1.26.0
- **Item-ID grammar widened and anchored.** An item ID may now carry an optional uppercase round letter between the hyphen and the serial, and is matched only at entry-heading position — line start, after optional heading markers or a table-row pipe — so IDs mentioned inside prose no longer open spurious entries.
- **Per-entry register budget in `calibration-metrics.mjs`.** A `FINDINGS_REGISTER.md`-shaped artifact is measured per entry (advisory 10 / hard 20 non-blank lines, preamble 15/30) with the flat 60/120 file cap as fallback.
- **Sibling-report warning.** `calibration-metrics.mjs` warns when register-shaped entries sit in a non-artifact sibling file, naming the file.
- **Covered negatives replace the zero-parse warning.** A present artifact whose `NO-FINDINGS` lines account for its content is reported as covered negatives rather than warned about as an unparsed artifact.
- **`dispatch-ledger.mjs phase` subcommand.** Writes `> phase: <title> · lead@<model>` markers so the lead model per phase is reconstructable; `check` is fail-closed on a malformed marker.
- `docs/techniques/calibration-protocol.md` restates the CONFIRMED-ratio rule: an assess-only run caps remediation, not reproduction.
- **`CONVENTIONS.md` dispatch-ledger passage synced** to the stamped `role@model` row form and extended with the write-at-dispatch atomicity clause; the passage is now pinned byte-identically across plugins by `SHARED_PASSAGES` in `scripts/lint-plugins.mjs`.
- **Vendored `revalidate-register.mjs` re-synced** from the canonical `scripts/revalidate-register.mjs` for the widened, heading-anchored item-ID grammar.

## 1.25.0
- **Dispatch-ledger rows are stamped `role@model`.** `dispatch-ledger.mjs add` now requires `--model <resolved-model-id>` and writes it into the role cell, so a run's actual tier mix is reconstructable after the fact and a silent mid-run tier substitution is visible instead of invisible; `check` flags an unstamped row as an advisory (a hard failure under `--strict`). Legacy unstamped rows still parse.
- **Register per-entry length budget.** `scan-narration.mjs` now checks a `FINDINGS_REGISTER.md`-shaped artifact per-entry (advisory 10 / hard 20 non-blank lines, preamble 15/30) instead of against the flat file-level cap — real-scale calibration evidence showed the flat cap wrongly penalized a legitimate many-entry register whose individual entries were tight.
- **`scan-redaction.mjs` gains directory support.**
- **`calibration-metrics.mjs`** warns when a present, non-empty artifact parses to zero items (naming the artifact and pointing at the new `docs/techniques/artifact-grammars.md`), and adds a tier-mix line to the dispatch-ledger summary parsed from the `role@model` stamp (unstamped rows counted separately).
- **New `docs/techniques/artifact-grammars.md`** — the SSOT for the three parse grammars (`DISPATCH_LEDGER.md`, `FINDINGS_REGISTER.md`, `REFUTATION_LOG.md`) consumed by `calibration-metrics.mjs` and `revalidate-register.mjs`; handbook technique count 10 → 11. `calibration-protocol.md` now notes CONFIRMED-ratio comparisons are within-track only and links the grammars doc.
- `CONVENTIONS.md` §12's dispatch-ledger example updated to the stamped row form; a sentence on the register per-entry budget added alongside it.

## 1.24.0
- **Skills are model-invocable.** Removed `disable-model-invocation: true` from all skill frontmatter; the harness routes slash input through the Skill tool, and the flag made every skill uninvocable there and blocked scheduled-task invocation. Routing discipline now lives in each skill's "Use when" description, the session routing card, and each skill's own checkpoints — no auto-merge, ever.

## 1.23.0
- **Three new suite self-audit skills.** `calibration-run` (Mode: ASSESS) standardizes a real-scale calibration run against a target repo — isolated preflight, an `assess-only` baseline sweep dispatched per `full-sweep`/`rigor:rigor-sweep`'s own phases, metric extraction, and a fail-closed sanitized-note validation before a row is appended to the new `evals/CALIBRATION_TABLE.md` — enforcing the one-way channel rule from `evals/README.md` mechanically instead of by convention. `run-cost-audit` (Mode: ASSESS) audits a completed run's dispatch counts, artifact sizes, and tier/effort mix against the bounded-wave (`§1`) and length-discipline (`§12`) doctrine, producing an evidence-cited `COST_AUDIT.md`. `provider-parity-audit` (Mode: ASSESS) inventories provider-coupled prose across every plugin's skills/CONVENTIONS/docs and classifies each hit (reconciled-in-render / needs-rewording / intentionally provider-specific) into `FINDINGS_REGISTER.md` — the prose counterpart to `build-codex-marketplace.mjs --check`'s mechanical render parity. New `docs/techniques/calibration-protocol.md` documents the channel rule, run design, metric table, and sanitized-note template.
- **Phase-0 executor naming extended to the remaining DOCUMENT/AUDIT/IMPLEMENT skills** — `adopt-standards`, `adr`, `api-docs`, `data-model`, `dependency-upgrade`, `doc-alignment`, `feature-discovery`, `feature-implementation`, `normalize`, `onboarding`, `ops-docs`, `performance`, `remediation`, `security-privacy-audit`, and `test-hardening` now name the `explorer` (mapping phases) or an ephemeral implementation operative (fix/build phases) dispatch explicitly, completing the pattern started in 1.22.1 for `architecture` and `codebase-audit`.
- Skill count 25 → 28; handbook, root README, and plugin README counts updated to match.

## 1.22.1
- **`architecture` and `codebase-audit` Phase 0 name an `explorer` dispatch** for stack detection/inventory, handing its summary onward — matching the executor-naming already used in the orchestrators' Phase 0.
- **TODO** — describe the change.

## 1.22.0
- **`CONVENTIONS.md` §1 gains a reasoning-effort routing rule** — effort follows ambiguity the same way tier does (low for mechanical/breadth, medium for execution/scoped implementation and flow tracing, high for review and the lead, xhigh reserved for disputed verdicts and critical CONFIRMED calls), cross-referencing `docs/techniques/subagent-trade-offs.md` for the full table instead of duplicating it.
- **Privacy leak gate made an explicit invocation** in `ship` and `debug` Phase 4 — names `/privacy-opsec-suite:metadata-leak-audit` scoped to the change's/fix's diff and routes its findings into `FINDINGS_REGISTER.md`, replacing the prior prose-only mention.
- **`researcher` wired into `ship`** — Phase 2 routes new-dependency and library-choice decisions through `/researcher:library-eval` and pre-commitment claim verification through `/researcher:research-verify`.
- **`explorer` and `reviewer` doctrine clauses pinned against drift** (`SHARED_PASSAGES` extended to `plugins/*/agents/*.md` in `scripts/lint-plugins.mjs`) — escalate-don't-guess, secret redaction, and dense/evidence-cited-report wording normalized across all eight operative agent files and gated so a partial edit fails lint.
- **Phase-0 explorer dispatch named explicitly** in `ship`, `debug`, and `full-sweep` — the stack/conventions detection step now names the operative that runs it (an explorer, handing its summary plus `REPO_MAP.md` forward) instead of leaving the lead to do it inline.
- **`everything` gains its own Phase-0 preflight/repo-map wiring** — it does not delegate to `full-sweep`, so it now runs `preflight.mjs` and `repo-map.mjs` directly, matching the other orchestrators.
- **`debug` gains a scale-down line** matching `ship`'s, plus permission to fold the Phase-2 root-cause checkpoint into the Phase-3 fix report for a trivially-scoped, one-file, obvious-root-cause fix; anything broader still stops for the checkpoint.
- **`CONVENTIONS.md` §7 gains a triage cap** — a phase surfacing more than 5 critical/high findings eligible for a panel checkpoints with the developer on scope before paneling all of them.
- **`CONVENTIONS.md` §12 generalizes the length discipline** — `EXECUTIVE_SUMMARY.md` and other run summaries cap at roughly one page of top findings, with full detail left to the register.
- **New `import-graph.mjs` vendored in** (`scripts/vendored-manifest.mjs`), alongside `preflight.mjs` and `repo-map.mjs`.
- **New `SessionStart` hook (`hooks/routing-card.mjs`)** — prints a hard-capped, 10-line routing card at session start pointing task types at the right skill/orchestrator and naming the standard-operating-mode docs, so the lead defaults into delegating instead of working inline.

## 1.21.0
- **`revalidate-register.mjs` hardened** — its git call now runs under a child-process timeout, blank/whitespace flag values are rejected, and unknown flags exit 2 instead of being silently treated as filenames.
- **`preflight.mjs` rejects unknown flags** (exit 1) instead of ignoring them.
- **`scan-ai-tells.mjs` and `scan-redaction.mjs` hardened** — missing-file/config errors now exit 2 even when hits are also present (previously masked to exit 1), their git calls run under a timeout, and unknown flags are rejected.
- **`run-proof.mjs` and `check-autofix-scope.mjs` reject blank/whitespace flag values** and document their exit contract in a header comment; `run-proof`'s proof-command execution stays deliberately unbounded.
- **`lib-docs.mjs` documents its exit contract** in a header comment and rejects blank/whitespace flag values.
- **`pr-split` now points to the stacked-PR merge procedure** in `docs/handbook/10-recovery-and-troubleshooting.md` §6.

## 1.20.0
- **New `scripts/repo-map.mjs` generator** — produces a per-repo inventory (`git ls-files -z`) with per-language top-level definition extraction at exact line numbers, announced truncation/binary/unreadable-file handling, and a HEAD-sha freshness stamp; vendored byte-identically into this plugin's `scripts/`.
- **`Map once, search to deepen`** doctrine bullet added to `CONVENTIONS.md` (SHARED_PASSAGES-pinned, id `map-once`) — Phase 0 generates `REPO_MAP.md` once per run and every operative brief gets its path, consulting it before search.
- **`universal-ctags` optional-tool mention** added to `CONVENTIONS.md` §2 — an optional accelerant for symbol-to-location lookups, used if installed, never required.
- **Phase-0 repo-map wiring** — `ship`, `debug`, and `full-sweep` run `repo-map.mjs` after `preflight.mjs` passes and hand the resulting `REPO_MAP.md` path to every operative brief; a failed generation is a noted advisory, not a blocker.
- **`repo-map.mjs` and `preflight.mjs` reject empty or whitespace-only flag values at parse** — previously `--max-file-kb ""` produced an all-skipped map with exit 0, and `--artifact-dir ""` silently skipped the writability probe.
- **`preflight.mjs`'s tool probe falls back to a `where` PATH lookup on Windows** so `.cmd`/`.bat` shims (npm-style tools) resolve without a shell.
- **`REPO_MAP.md` added to the Standard filenames artifact list.**

## 1.19.0
- **Operative-failure ladder** added to `CONVENTIONS.md` (SHARED_PASSAGES-pinned): a dispatched operative that cannot complete its brief escalates through an ordered ladder (retry with a narrower brief, hand back a specific open question, or take the piece over) instead of guessing or silently dropping the task.
- **`DISPATCH_LEDGER.md` convention** — dispatched work is logged so a stalled or dropped operative is visible instead of silently vanishing; `revalidate-register.mjs` gains an advisory `--dispatch-ledger` flag that cross-checks the ledger against the register.
- **Report-ingestion gates** added to `ship`, `debug`, and `full-sweep` — an operative report is validated against its expected shape before being folded into the run, so a malformed or partial report cannot silently pass through as complete.
- **New `scripts/preflight.mjs`** — a Phase-0 gate wired into `ship`, `debug`, and `full-sweep` that checks environment/toolchain preconditions before a skill starts work.

## 1.18.0
- **New skill `adopt-standards`** (Mode: DOCUMENT) — bootstraps or maintains a repo's `CLAUDE.md` standards contract so it stays mechanically kept, not aspirational. **BOOTSTRAP** mode (no `CLAUDE.md`, or one failing a quick audit) audits real build/test/lint/gate commands (run read-only or CI-cited), architecture, gotchas, and doc-lifecycle rules, then writes the contract in house style. **MAINTAIN** mode re-verifies every claim — commands still run, the gate chain still mirrors CI, enforcement claims are truthful, `line N` citations are swept mechanically (not eyeballed), cited paths still exist — fixing drift and reporting what was stale. House style: `## Never (no gate will save you)` first, `## Before declaring any change done` (verified command chain), post-edit chores, `## Invariants the gates will catch`, and a local-only-docs note, with no duplication of the user's global `~/.claude/CLAUDE.md` doctrine.

## 1.17.2
- **Agent doctrine hardening.** `explorer` and `reviewer` now state explicitly that an ambiguous brief, or work outside their scope (edits, execution, a judgment call only the orchestrator can make), goes back to the orchestrator as an open question instead of being guessed at. `explorer`'s evidence-citation rule now points at the plugin's `CONVENTIONS.md` (§9, Evidence standard) for the anchor format; `reviewer`'s report rule states reports return dense and evidence-cited, never raw file dumps.

## 1.17.1
- **Codex distribution.** The repository now renders a tracked native Codex package from this canonical source, with a `.codex-plugin` manifest, marketplace metadata, named skills, explicit manual-invocation policy, bundled MCP server, and the traceless-publishing hook subject to Codex hook trust. `node scripts/build-codex-marketplace.mjs --check` fails on render drift.
- **Traceless scanner recognizes Codex/OpenAI attribution.** The bundled `scan-ai-tells.mjs` now rejects Codex/OpenAI trailers, generation claims, and `Codex CLI` tool markers in the same fail-closed gate used for Claude and other assistants.

## 1.17.0
- **New `PreToolUse` hook `enforce-traceless`.** Blocks a `git commit` / `gh pr create|merge` Bash call at the tool layer when the command text carries an AI/tool tell, running the bundled `scan-ai-tells.mjs` against the full command string before the call proceeds; a hit exits 2 with the scanner's report, otherwise exits 0. Fails open on scanner infra errors (missing/unspawnable scanner) so the hook never blocks a commit for its own reasons; CI (`scan-ai-tells.mjs --git <range>`) remains the fail-closed backstop.

## 1.16.0
- **Token economy (measured, gate-preserving).** Read-once clause for CONVENTIONS (an orchestrator-loaded copy is inherited, not re-read — an `everything` pass instructed ~35 reads of ~15K unique tokens); pre-filter-first register reads (run the checker, then read only non-FRESH entries, wholesale only for synthesis); refutation-panel economy (a SURVIVED verdict whose receipts still pass `--strict --refutation-log` is not re-paneled; panelists get the finding block + cited region inline, never the full register); `everything` no longer preloads sibling skill files (invocation re-injects them). All new doctrine cores pinned in SHARED_PASSAGES.
- **DOCUMENT-mode generators read scoped sections** — `architecture`/`api-docs`/`data-model`/`ops-docs`/`onboarding` read the four sections that bind DOCUMENT mode instead of the full file (the fan-out/fix machinery cannot apply to them). `adr` and `doc-alignment` keep full reads (they log tiered findings).
- **Frontmatter descriptions trimmed** across the marketplace (~26%; every Use-when trigger and sibling disambiguator kept verbatim; all skills are manual-invoke so routing is unaffected).
- **CI: both PR gates cancel superseded runs** (a newer push stops paying for reviews of dead commits) and deep-review skips generated-data-only diffs (in-job check, never paths-ignore — required-check semantics preserved; validate.yml drift-checks those files; opsec-gate still reviews every PR).

## 1.15.1
- **Tier-honesty line moved in-phase** in `doc-alignment` and `normalize` — the post-hardening floor snapshot (evals/FLOOR_TABLE.md) measured that the rule suppresses weak-model tier inflation when embedded at the finding-emitting step (the bug-hunt pattern, 0 inflation) but not as a trailing line (4-9 remained). Placement beats presence; pre-registered iteration, nothing else changed.

## 1.15.0
- **CONVENTIONS restructured for clause visibility.** The dense tier-honesty, independent-refutation, and anchor paragraphs in `§7`/`§9` are now one clause per line (numbered), so an executing model weighs every clause of the conjunctions instead of skimming a 200-word sentence; the refutation protocol carries the identical numbered structure as rigor `§I`. Section headings and every pinned doctrine core are byte-unchanged.
- **New lint check #14: SHARED_PASSAGES drift gate.** The deliberately-duplicated doctrine cores (fan-out throttle, disconfirmation protocols, headless contract, circuit-breaker, non-secret-anchor rule, terminal forms, the always-gated list) are pinned byte-identically across every file that carries them — a partial rollout of a doctrine change now fails CI instead of silently diverging. Caught and fixed one live drift on landing: `everything`'s always-gated copy had drifted from the pinned byte-form (a separate "anything irreversible" clause instead of "destructive/irreversible operations", and no never-auto-merge rider).
- **Tier honesty inlined at point of use** in `doc-alignment` and `normalize` — the baseline model-floor calibration (see `evals/FLOOR_TABLE.md`) measured weak-model tier inflation concentrating in exactly the skills that carried the rule only by CONVENTIONS pointer.
- **`evals/FLOOR_TABLE.md`** — the committed baseline of the pre-registered model-floor calibration: strong tier emitted zero inflated CONFIRMED across 42 read-only cells; the weak tier emitted 62 in control and 27 with skills, splitting on whether the skill inlines tier discipline.

## 1.14.0
- **Weak-model gate batch.** `revalidate-register.mjs` gains an opt-in `--strict --profile <type>` schema gate (mandatory per-item fields; a mangled zero-ID register fails instead of silently vacating the anchor gate), a `--consumed <pre-run>` terminal-state mode (a consumed item never vanishes and closures use `closed-with-proof` / `deferred-with-reason` / `OBSOLETE-AT`), a Panel-exempt severity floor (a sensitive-path finding below high needs an explicit exemption — deflation cannot dodge the refutation panel), refutation receipts (`--refutation-log` validates panel size, tally, and that every REFUTED verdict's guard anchor still greps), and a `<REDACTED-LINE>` anchor carve-out so the anchor rule never forces a secret into a register.
- **New `check-autofix-scope.mjs`** — the auto-apply diff gate: denies always-gated paths (auth/migrations/lockfiles/workflows/schemas), oversize diffs, and export-touching lines before an agent may auto-apply a NOW-SAFE item; fail-closed by default (no flags = deny everything), wired into the §4 auto-safe lane.
- **New `run-proof.mjs`** (execution receipts: a claimed test result with no replayable receipt is narration, not proof) and **`scan-redaction.mjs`** (fail-closed secret shapes over the run's own output artifacts — the §4 radioactive rule gains a mechanical floor; matched secrets are masked in the scanner's own output).
- **Producer/consumer self-checks wired:** `codebase-audit` gates its Done-when on a clean revalidate pass of the finished register; `remediation` and `feature-implementation` gate theirs on `--consumed`; `handoff` scans itself before handover. Guarded by lint check #13 so the wiring cannot silently regress.
- **Evals:** register-staleness extended (strict/consumed/redacted-anchor cases); new `proof-receipts`, `autofix-scope`, and `redaction-scan` regression evals wired into validate.yml.

## 1.13.1
- **Doctrine line untethered from a model name.** CONVENTIONS line 3 now targets "a capable agentic coding agent (e.g. Claude Code)" — the Opus 4.8 example pinned the suite to a model generation; capability is the contract, and the model floor is measured (see the model-floor calibration workflow) rather than named.

## 1.13.0
- **New skill `handoff`** (Mode: DOCUMENT) — session continuity for long runs. **Write** captures the run's true state as a verifiable `HANDOFF.md` before a context limit / session end / operator change: goal and state of play, every register path stamped `Verified-at: <sha>`, decisions with their rejected alternatives, traps & dead ends (the most valuable and least recoverable session state), and in-flight boundaries with anchored `file:line` pointers. The rule is *state, not instructions*. **Resume** treats every claim as context to verify, not fact to trust — `revalidate-register.mjs` on every named register, anchors checked, contradictions surfaced at a checkpoint. Registers carried findings across phases; nothing carried decisions and dead-ends across sessions until now.
- **Lint check #11: frontmatter angle-bracket injection guard.** `lint-plugins.mjs` now fails any SKILL.md whose frontmatter value contains `<` or `>` — frontmatter is injected verbatim into the system prompt at discovery (before the body is read), so angle-bracketed markup there is a prompt-injection surface no body-level guard sees. Complements the supply-chain-trust agent-ingested-content lens with a mechanical floor for this repo's own skills.

## 1.12.0
- **Anchor delimiter promoted from script comment to spec (`§7` schema, `§9`).** `revalidate-register.mjs` can only parse an `Anchor:` value that is backtick- or quote-delimited; that requirement lived solely in a script comment, so an executing model following CONVENTIONS could emit an undelimited anchor and silently lose the `DRIFTED` gate — the item fell open to plain line-existence checking. The schema and `§9` now state the syntax with a micro-example (`` Anchor: `req.query.accountId` ``); `reviewer` carries it inline.
- **`revalidate-register` warns on an unparseable anchor.** An `Anchor:` label whose value has no delimiter now earns a per-item advisory (`unparseable, DRIFTED check skipped`) instead of being silently ignored. Non-gating; anchor-less registers are checked exactly as before.
- **Eval:** `register-staleness` gains an undelimited-anchor case pinning the new advisory (FRESH status + explicit warning, never a silent skip).

## 1.11.0
- **Cascade circuit-breaker (`§11`).** Three or more fixes in a single run failing verification or spawning new confirmed findings now stop the implementation loop — a cascading cluster is evidence of an architectural problem, not a bug collection. The cluster reclassifies as NEEDS-DESIGN with the cascade chain recorded and options presented at a checkpoint (deferred and reported in headless runs). Wired into `remediation` and `debug`; mirrored in rigor `§H`.
- **`pr-review` scales the review to reach, not diff size.** Phase 0 now traces the change's reach — the dependents and call sites of changed exported symbols, shared types/schemas, and API/DB contracts — and scales reviewer fan-out and depth to it; a small diff in a shared contract is a large review.
- **`dependency-upgrade` closes CVEs on evidence.** "Done when" now requires a fresh advisory re-scan against the final lockfile (the ecosystem's live audit tool) showing no remaining high/critical advisories except those explicitly accepted or deferred with rationale — never inferred from the version bumps alone. `DEPENDENCY_REPORT.md` backs its CVEs-closed list with the re-scan output.
- **`adr` gains a three-prong admission gate (both modes).** A decision earns an ADR only when it is hard to reverse, surprising without context, and the result of a real trade-off; a candidate failing any prong is routed to a named destination (a code comment, the repo's existing docs surface, or a CHANGELOG line) instead of being written up — bounding Backfill mode inside the orchestrators' document phases. Handbook and `docs/adr` index updated to match.
- **`remediation` states its cold path.** A missing `FINDINGS_REGISTER.md` stops the run and routes to `codebase-audit` / `rigor:bug-hunt` — never synthesize a register from memory.
- **Evals: pre-registered measurement protocol.** `evals/README.md` now requires every model-in-the-loop measurement to pre-register (before the first scored run) its hypothesis, matched arms, n + stopping rule, metric with a minimum practically-significant delta, and an instrument (saturation) check; reports separate observed-delta-vs-noise from practical significance and end with a validity-threats list. Kills the confounded-arms class of calibration error at design time.

## 1.10.0
- **Independent refutation of load-bearing findings (`§1`, `§7`).** A critical/high-severity or fix-driving finding is no longer reported on the strength of the agent that found it. Before it ships at that severity it is handed to an *independent* sub-agent (a `reviewer`/`tracer` in a new **refutation mode**) that did **not** find it, whose sole job is to kill it by locating a dominating guard/handler in a **different function, file, or boundary** — majority-REFUTED drops the finding or downgrades it to SPECULATIVE with the cited guard. This is the adversarial complement to the (self-run) disconfirmation pass, aimed at the cross-function false-positive class self-review structurally misses; an item already proven by an executed repro skips the panel. Scoped to load-bearing findings, so nits are unaffected.
- **Verbatim-anchor citation gate (`§7` schema, `§9`).** Every finding now carries an `Anchor` — a verbatim substring copied from the cited line — so a citation is mechanically checkable. `revalidate-register.mjs` classifies a citation whose cited line no longer contains its anchor as **`DRIFTED`** (fail-closed), alongside FRESH/MOVED/GONE, turning "never fabricate a location" into a deterministic gate that catches a hallucinated or stale citation before it is acted on. Backward-compatible: anchor-less registers are checked exactly as before.
- **Agents made self-contained.** `reviewer` and `explorer` now carry their load-bearing discipline (verbatim anchor, disconfirmation, locate-the-handler) **inline** rather than by a pointer to `CONVENTIONS.md` a spawned subagent cannot always read; `reviewer` gains an explicit refutation mode. Wired into `pr-review` and `codebase-audit`.
- **Eval:** `register-staleness` extended to cover the anchor gate (a FRESH-with-anchor and a `DRIFTED` case), keeping the new mechanical gate under a deterministic CI guard.

## 1.9.0
- **CONVENTIONS hardened from a real-scale (~140k-LOC) calibration of the suite.** The disconfirmation pass (`§7`) gains two false-positive killers — read the cited line's by-design / accepted-deferred annotation, and *locate* the would-be handler before claiming a "nothing else handles this" gap. The operating model (`§1`) self-throttles the fan-out into **bounded waves**, injects the tool-enforced ruleset **inline** into reviewer prompts, **skims-then-deepens** very large files, and **audits the union of slice skipped-sets** at synthesis. A `claims-vs-enforcement` consistency sub-lens (`§10`) and a **headless / non-interactive contract** (`§3`) round it out.
- **Bundled runtime-script hardening (security + correctness).** `lib-docs` rejects a package `types` value that escapes the package dir and an IPv4-mapped-IPv6 SSRF, and caps an oversized streamed fetch chunk. `revalidate-register` classifies an escaping `Location:` citation `AMBIGUOUS` instead of silently re-rooting it `FRESH`. `lib-docs-mcp` returns `-32600` for a malformed method. `lint-plugins` gains empty-description, orphan-bundled-script, and handbook command-reference parity checks; `check-no-deps` now catches multiline and dynamic `import()` bare imports.
- **New: the suite handbook** under `docs/handbook/` — the 4-plugin mental model, the orchestrators, registers/tiers, a per-command reference for all 55 commands, plus guides and techniques — kept honest by the command-reference parity gate and a fixture-drift CI guard over every eval answer key.

## 1.8.0
- **Runtime-script hardening (security + correctness).** `lib-docs` is now **local-only by default** (`noFetch=true`; opt in to the library-source fallback with `--fetch` / `noFetch:false`), rejects library names that could escape `node_modules` (CLI + MCP), and restricts the fetch fallback to https public hosts (no loopback/private). `revalidate-register` fixes an off-by-one EOF check, stops parsing standards tokens (RFC/CVE/ISO) and version/host strings as references, resolves bare-filename refs (new `AMBIGUOUS` status), and confines reference paths to the repo root. The `code-ops-docs` MCP wrapper validates its required `library` argument.
- **`scan-ai-tells.mjs` now bundled in code-ops-suite** so the `ship` / `pr-split` / `debug` traceless-PR gate has a mechanical floor even when `privacy-opsec-suite` is not installed.
- **Linter (`lint-plugins`) strengthened:** intra-plugin orchestrators validate against their own plugin, qualified `plugin:skill` references must resolve, single-word skill tokens are checked, and it now catches duplicate marketplace entries, unregistered plugin dirs, missing manifest fields, BOM-prefixed frontmatter, and unbundled script references — plus a new `check-no-deps` CI guard for the zero-dependency invariant and SHA-pinned CI actions.
- **Docs reconciled** (install blocks, eval inventory, §-citations).

## 1.7.1
- **Orchestrators refreshed for the 1.4–1.7 additions.** `full-sweep` and `everything` now wire today's capabilities through every phase: they **generate the reference docs** (`architecture` / `data-model` / `api-docs` / `ops-docs` / `adr`) in their document phase; reference the **automation-level ladder** (`§4`), **evidence tiers + disconfirmation** (`§7`), and the **multi-boundary control-coverage** lens (`§10`) in assess/prove; keep carried registers **fresh** (`§12` — re-validate before consuming, mark obsolete); verify library facts via the **in-house docs lookup** (`§2`); and ship results as a **traceless stacked PR** (`pr-split` → `authorship-hygiene`). The fixed `code-normalization` → `normalize` reference is retained. No change to the individual skills.

## 1.7.0
- **New documentation generators: `architecture`, `api-docs`, `data-model`, `adr`, `ops-docs`** (Mode: DOCUMENT) — produce deep, diagram-rich (Mermaid C4 / sequence / ER), code-grounded docs aimed at senior engineers, governed by a new `CONVENTIONS §13` documentation quality standard (layered exec-summary-first structure, diagrams as first-class, every claim cited + verified, freshness-stamped). They **generate** docs; `doc-alignment` maintains them; `onboarding` stays the newcomer path.

## 1.6.0
- **New skill `current-docs` + bundled `lib-docs.mjs` + a `code-ops-docs` MCP server** — an in-house, local-first alternative to Context7. Resolves a library's **installed** version and returns its real README + exported type signatures with zero network (fetch fallback only); no third-party indexer, no query egress. Wired as the default for the `CONVENTIONS §2` documentation-lookup capability across all three plugins, so every skill verifies APIs against the installed version instead of memory. The MCP server (`resolve-library` / `get-docs`) auto-registers when the plugin is enabled.

## 1.5.0
- **New orchestrators `ship` + `debug`** — task-scoped cross-plugin pipelines that compose the conventions end-to-end. `ship` drives one change (feature or one-off) through design-check → safety-net → implement → prove → privacy-gate → traceless PR. `debug` drives a symptom through reproduce → isolate → root-cause (checkpoint) → `fix-verified` → traceless PR. Both require `rigor`; the privacy phase runs when `privacy-opsec-suite` is installed and the change touches a privacy surface.

## 1.4.0
- **New skill `pr-split`** — carves an existing big branch into a clean stack of small, **independently-green** PRs (dependency/concern/atomicity grouping, green-at-every-step), then composes `privacy-opsec-suite:authorship-hygiene` fail-closed before pushing so the commits/PRs carry no AI/tooling trace. Never auto-merges.

## 1.3.0
- **Register freshness (fixes the proven field failure):** CONVENTIONS SSOT (§12) now mandates re-validating a finding against the current tree before it is written, carried across a phase boundary, or consumed; added a `Verified-at: <sha>` field to the Finding/Idea schemas (§7) and bundled `scripts/revalidate-register.mjs` (reports FRESH/MOVED/GONE/NO-REF). `codebase-audit` + `feature-discovery` stamp it; `remediation` runs it at Phase 0.
- **Evidence tiers + disconfirmation** added to the §7 Finding schema (CONFIRMED/PROBABLE/SPECULATIVE + a disconfirmation pass; only CONFIRMED drives an auto-fix) — borrowed from `rigor`.
- **Automation-level ladder** (`gated`/`auto-safe`/`auto-all` + always-gated categories, never auto-merge) promoted into CONVENTIONS §4.
- **Multi-boundary control-coverage** rule added to the Security lens (§10).
- Standardized the audit→discovery handoff on `FEATURE_OPPORTUNITIES.md` (dropped `FEATURE_IDEAS.md`).
- **Descriptions** rewritten to lead with `Use when…` triggers + scope/ownership clauses (orchestrator scope; cross-skill overlap disambiguation, e.g. performance↔improve-measured, pr-review↔deep-review↔opsec-pr-gate, normalize↔consistency-closure).

## 1.2.1
- **Fix:** `full-sweep` Phase 6 referenced a non-existent `code-normalization`
  skill; corrected to `normalize` (the real skill slug / `/code-ops-suite:normalize`).
- **Docs:** the README now lists the `full-sweep` and `everything` orchestrators
  (previously absent from the Skills section); the root README skill count is
  corrected to 14.
- **Packaging:** added an MIT `LICENSE` and a `license` field to the manifest.
- **Tooling:** the marketplace now ships `scripts/lint-plugins.mjs` (structural
  linter) wired into CI, which catches this class of doc/reference drift.

## 1.2.0
- General-engineering suite: `codebase-audit`, `security-privacy-audit`,
  `remediation`, `feature-discovery`, `feature-implementation`, `performance`,
  `test-hardening`, `dependency-upgrade`, `pr-review`, `normalize`,
  `doc-alignment`, `onboarding`, plus the `full-sweep` and `everything`
  orchestrators. `explorer` + `reviewer` subagents; shared `CONVENTIONS.md`.
