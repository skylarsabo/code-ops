# Changelog — researcher

## 0.13.10
- `CONVENTIONS.md` and both agent definitions rewritten to the house writing standard: no em-dashes and no semicolons in prose, one instruction per sentence, and headings as noun phrases. Meaning and every section id are unchanged. §1 now names the session mechanisms that are on by default, their off switches, and the fact that none of them reaches a network.

## 0.13.8
- Vendored `repo-map.mjs`, `import-graph.mjs`, and `symbol-lib.mjs` refreshed: the map and the graph now read their definition rules and their import extraction from the shared library instead of their own copies. Output is unchanged.

## 0.13.7
- Vendored `scan-injection-tells.mjs` and `cli-lib.mjs` refreshed: the scanner parses its flags through the shared library, with every flag, exit code, and message unchanged.
- `research-verify` invokes the scanner as `co.mjs scan injection` instead of by path. The direct path still works.

## 0.13.6
- Vendored `preflight.mjs` refreshed: it prints `ctags` and `codegraph` as detected capabilities, present or absent, never as a requirement.

## 0.13.5
- Vendors `symbol-lib.mjs` beside `skim.mjs`, which now imports its definition rules from it.

## 0.13.4
- Vendored `co.mjs` refreshed: its verb table gains `scan overbuild` and `scan deferrals`, whose scripts ship in code-ops-suite.

## 0.13.3
- Vendored `co.mjs` refreshed: its verb table gains `context digest`, whose script only code-ops-suite bundles. No behavior in this plugin changes.

## 0.13.2
- Vendors `skim.mjs` so `${CLAUDE_PLUGIN_ROOT}/scripts/skim.mjs <file>` prints a file outline with line ranges, and an operative reads a range instead of the whole file.

## 0.13.1
- Vendors `co.mjs` and `cli-lib.mjs` so `${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs` resolves in every plugin.

## 0.13.0
- `gatherer` and `claim-checker` batch independent tool calls in one round, verify a name against the installed version or a primary source before reporting on it, and convey sources in indirect speech with at most one short marked quotation. Conventions carry the finish-the-turn check.

## 0.12.3
- CI guidance now requires a reviewed immutable Claude Code action pin for the delegated OpSec gate.

## 0.12.2
- Documentation references now resolve through the repository's sole `code-ops-docs/` hub after the handbook and techniques migration.

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

## 0.12.1
- **Tier-floor carrier for hosts that ignore agent frontmatter** — `scripts/preflight.mjs` now prints every bundled agent’s declared tier floor at Phase 0, so the floors are visible on any host. A new `CONVENTIONS.md` bullet makes the lead route each dispatch at or above its floor by hand where the host ignores `model:` frontmatter, and `run-cost-audit` records a below-floor dispatch as a `tier-routing` FAIL.

## 0.12.0
- **New `CONVENTIONS.md` §14, Writing standard** — briefs and research notes follow one house standard. The section pins one term per concept, active voice, and one instruction per sentence. It caps instructions at 20 words and explanation at 25. Clarity outranks conformance, so a writer who breaks a rule states why. Full rules live in `code-ops-docs/40 Engineering/Techniques/writing-standard.md`.

## 0.11.0
- **Model routing is quality-first** (`CONVENTIONS.md` §1): synthesis, verification, and every judgment-bearing dispatch run on the stronger model; the faster model covers mechanical breadth gathering only. A shallow or failed report costs a redispatch plus the orchestrator's attention.

## 0.10.3
- **Operative reports are persisted in the turn they land, and gated on shape before their unit counts as covered** (`CONVENTIONS.md` §1): a report that lives only in the conversation is one blocked turn from being lost, and a brief that never reached its operative is indistinguishable from a completed dispatch until the report is read.

## 0.10.2
- **Refutation receipts are keyed at line start** (vendored `revalidate-register.mjs`): an ID cited mid-sentence in a round note is prose, not a receipt. Keyed mid-line, such a note attached itself to the finding it cited as an extra verdict, and a `REFUTED` word in explanatory prose could fail a strict item whose actual panel line said SURVIVED.

## 0.10.1
- **`CONVENTIONS.md` dispatch-ledger passage synced** to the stamped `role@model` row form and extended with the write-at-dispatch atomicity clause; the passage is now pinned byte-identically across plugins by `SHARED_PASSAGES` in `scripts/lint-plugins.mjs`.
- **Vendored `revalidate-register.mjs` re-synced** from the canonical `scripts/revalidate-register.mjs` for the widened, heading-anchored item-ID grammar.

## 0.10.0
- **Skills are model-invocable.** Removed `disable-model-invocation: true` from all skill frontmatter; the harness routes slash input through the Skill tool, and the flag made every skill uninvocable there and blocked scheduled-task invocation. Routing discipline now lives in each skill's "Use when" description, the session routing card, and each skill's own checkpoints — egress checkpoints still gate every run.

## 0.9.1
- **Named-executor discipline extended to the leaf skills.** `ecosystem-watch`, `library-eval`, `research-ideate`, `research-improve`, `research-spike`, and `research-verify` now name a `gatherer` dispatch (parallel, disjoint sub-questions) for their local grounding/gathering phases and a `claim-checker` dispatch (one per load-bearing claim, parallel) for their verification/disconfirmation phases, matching the pattern `research-sweep` Phase 0 already used.

## 0.9.0
- **`claim-checker` and `gatherer` doctrine clauses pinned against drift** (`SHARED_PASSAGES` extended to `plugins/*/agents/*.md` in `scripts/lint-plugins.mjs`) — escalate-don't-guess, secret redaction, and dense/evidence-cited-report wording normalized across all eight operative agent files and gated so a partial edit fails lint.
- **`preflight.mjs`, `repo-map.mjs`, and `import-graph.mjs` vendored in** (`scripts/vendored-manifest.mjs`) — `research-sweep` Phase 0 now runs the preflight gate, generates `REPO_MAP.md`, and dispatches a `gatherer` to detect stack/size before confirming scope and egress, matching the other suite orchestrators.

## 0.8.0
- **`revalidate-register.mjs` hardened** — its git call now runs under a child-process timeout, blank/whitespace flag values are rejected, and unknown flags exit 2 instead of being silently treated as filenames.
- **`scan-injection-tells.mjs` hardened** — missing-file/config errors now exit 2 even when hits are also present (previously masked to exit 1), its git call runs under a timeout, and unknown flags are rejected.
- **`research-manifest.mjs` and `lib-docs.mjs` reject blank/whitespace flag values** and document their exit contract in a header comment.

## 0.7.0
- **Operative-failure ladder** added to `CONVENTIONS.md` (SHARED_PASSAGES-pinned; same rationale as code-ops-suite 1.19.0): a dispatched `gatherer`/`claim-checker` that cannot complete its brief escalates through an ordered ladder instead of guessing.
- **`revalidate-register.mjs` (vendored)** gains the advisory `--dispatch-ledger` cross-check flag.

## 0.6.2
- **Agent doctrine hardening.** `claim-checker` and `gatherer` gain a general escalation rule — any ambiguous claim/brief or missing capability goes back to the orchestrator instead of being guessed around — and both now cite `CONVENTIONS.md §A` as the source of their CONFIRMED/PROBABLE/SPECULATIVE tiers instead of restating them. `claim-checker` also gains an explicit report-density line.

## 0.6.1
- **Codex distribution.** The repository now renders a tracked native Codex package from this canonical source, with the same research workflows and explicit per-skill manual-invocation policy.

## 0.6.0
- **Skill bodies compressed 22%** (60.5KB → 47.1KB) — narrative framing and restated schema fields cut; every gate clause (egress manifest recording/validation, checkpoint definitions, tier rules, Done-when criteria, script invocations) kept near-verbatim and token-drop-scanned. The residual ~4KB/file is irreducible gate machinery the other plugins don't carry per-file.
- **Read-once CONVENTIONS clause + pre-filter-first register reads** (pinned in SHARED_PASSAGES).
- **Floor calibration: strong arm drops to n=1** (pre-registered in evals/README.md; 126 consecutive strong cells measured constant-zero tier inflation — the variance budget belongs to the weak arm).

## 0.5.0
- **New `scan-injection-tells.mjs`** — `research-verify` scans every fetched or carried-in artifact before ingestion: external content is data to verify, never instructions to follow.
- The vendored `revalidate-register.mjs` gains the strict/consumed extension set (`--strict --profile research` requires Tier + Verified-at per item; Anchor/Location required only for items carrying code citations) and the `<REDACTED-LINE>` anchor carve-out; the anchor rule now requires a non-secret anchor on a secret-bearing line.

## 0.4.0
- **`Anchor` added to the research schema (`§6`, `§7`).** The bundled `revalidate-register` has carried the verbatim-anchor `DRIFTED` gate since 0.3.0, but this suite's schema never told an executing model to emit an `Anchor:` — so the gate was unreachable for registers produced here. The schema and citation discipline now define the field for code sources, including the parse-critical backtick/quote delimiter (an undelimited value is invisible to the checker and forfeits the check).
- **`revalidate-register` warns on an unparseable anchor** (per-item advisory instead of a silent skip; vendored from the canonical script).

## 0.3.0
- **Bundled `revalidate-register` gains the verbatim-anchor gate.** The canonical script (vendored into this plugin) now classifies a citation whose cited line no longer contains its optional `Anchor:` substring as **`DRIFTED`** (fail-closed), on top of FRESH/MOVED/GONE — catching a hallucinated or stale finding location before it is acted on. Backward-compatible: registers without anchors are checked exactly as before.

## 0.2.0
- **CONVENTIONS hardened from a real-scale calibration of the suite.** The disconfirmation pass (`§A`) gains two false-positive killers — read the cited line's by-design / accepted-deferred annotation, and *locate* the would-be handler before claiming a "nothing else handles this" gap. The operating model (`§1`) self-throttles the fan-out into **bounded waves**, injects the grounding baseline **inline** into gatherer / claim-checker prompts, **skims-then-deepens** very large files, and **audits the union of slice skipped-sets** at synthesis. A `claims-vs-enforcement` sub-lens on the grounding lens (`§10`) and a **headless / non-interactive contract** (`§3`, egress deferred-and-reported) round it out.
- **Bundled runtime-script hardening** (`lib-docs`, `revalidate-register`, `research-manifest`): `lib-docs` rejects a package `types` value that escapes the package dir and an IPv4-mapped-IPv6 SSRF, and caps an oversized streamed fetch chunk; `revalidate-register` classifies an escaping `Location:` citation `AMBIGUOUS` instead of `FRESH`; `research-manifest` derives disclosed hosts only from the structured host/url columns, so a URL in a free-text `why` note no longer whitelists its host.

## 0.1.0
- **Initial release.** Code-grounded research plugin with 7 skills (`research-spike`, `research-verify`, `research-improve`, `research-ideate`, `library-eval`, `ecosystem-watch`, `research-sweep`) over a shared research core. **Local-first with a disclosed, fail-closed egress model** (`CONVENTIONS §A`) backed by the bundled `research-manifest.mjs` gate: a published artifact may not cite a web source that was not recorded in `EGRESS_MANIFEST.md`. Every claim is cited and tiered (CONFIRMED/PROBABLE/SPECULATIVE); the plugin **proposes and hands implementation to the other suites** (it never edits source). Bundles `lib-docs.mjs` + `revalidate-register.mjs`; composes the `deep-research` skill for opt-in web. Wired into CI (`evals/research-manifest/run.mjs`) and the structural lint gate.
