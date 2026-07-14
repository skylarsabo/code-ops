# Changelog — code-ops-suite

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

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
