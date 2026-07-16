# Changelog — rigor

All notable changes to this plugin are documented here. Versions track
the source plugin manifest and matching marketplace entries.

## 2.11.0
- **New `scripts/repo-map.mjs` generator** (vendored from code-ops-suite) — produces a per-repo inventory (`git ls-files -z`) with per-language top-level definition extraction at exact line numbers, announced truncation/binary/unreadable-file handling, and a HEAD-sha freshness stamp.
- **`Map once, search to deepen`** doctrine bullet added to `CONVENTIONS.md` (SHARED_PASSAGES-pinned, id `map-once`) — Phase 0 generates `REPO_MAP.md` once per run and every operative brief gets its path, consulting it before search.
- **`universal-ctags` optional-tool mention** added to `CONVENTIONS.md` §2 — an optional accelerant for symbol-to-location lookups, used if installed, never required.
- **Phase-0 repo-map wiring** — `rigor-sweep` runs `repo-map.mjs` after `preflight.mjs` passes and hands the resulting `REPO_MAP.md` path to every operative brief; a failed generation is a noted advisory, not a blocker.
- **`repo-map.mjs` and `preflight.mjs` reject empty or whitespace-only flag values at parse** — previously `--max-file-kb ""` produced an all-skipped map with exit 0, and `--artifact-dir ""` silently skipped the writability probe.
- **`preflight.mjs`'s tool probe falls back to a `where` PATH lookup on Windows** so `.cmd`/`.bat` shims (npm-style tools) resolve without a shell.
- **`REPO_MAP.md` added to the Standard filenames artifact list.**

## 2.10.0
- **Operative-failure ladder** added to `CONVENTIONS.md` (SHARED_PASSAGES-pinned; same rationale as code-ops-suite 1.19.0): a dispatched `tracer`/`verifier` that cannot complete its brief escalates through an ordered ladder instead of guessing.
- **`DISPATCH_LEDGER.md` convention** — `revalidate-register.mjs` (vendored) gains the advisory `--dispatch-ledger` cross-check.
- **Report-ingestion gates** added to `rigor-sweep`.
- **`scripts/preflight.mjs`** (vendored from code-ops-suite) wired into `rigor-sweep` as a Phase-0 gate.

## 2.9.2
- **Agent doctrine hardening.** `tracer` now tiers its findings CONFIRMED/PROBABLE/SPECULATIVE (`§A`), cites the verbatim-Anchor evidence format (`§E`) alongside its `file:line` rule, and cross-references its refutation mode to the disconfirmation pass (`§B`). Both `tracer` and `verifier` escalate ambiguity or out-of-scope work to the orchestrator instead of guessing; `verifier` reports stay dense and evidence-cited, no raw output dumps beyond the receipt.

## 2.9.1
- **Codex distribution.** The repository now renders a tracked native Codex package from this canonical source, with the same workflow content and an explicit per-skill manual-invocation policy.

## 2.9.0
- **Token economy.** Read-once CONVENTIONS clause; pre-filter-first register reads; refutation-panel economy in `§I` (receipt-verified SURVIVED verdicts are not re-paneled on re-runs; panelist handoff is the finding block + cited region, never the full register). Cores pinned in SHARED_PASSAGES.

## 2.8.0
- **CONVENTIONS restructured for clause visibility.** `§B` (disconfirmation) and `§I` (independent refutation) are now numbered protocols — one kill-question / one rule per line — with the intent-annotation and locate-the-handler bodies byte-identical across the three plugins that carry them (pinned by lint #14). Two worked micro-examples added: a correctly-tiered finding contrast in `§A` and a panel-tally line in `§I`.

## 2.7.0
- **Weak-model gate batch.** The vendored `revalidate-register.mjs` gains `--strict --profile finding-rigor` — schema completeness plus **CONFIRMED requires a resolvable Proof** (cited file exists, backticked command, or a test name that greps in the tree; else "attach a resolvable proof or downgrade to PROBABLE"), the Panel-exempt severity floor, refutation receipts, `--consumed` terminal states, and the `<REDACTED-LINE>` anchor carve-out.
- **New `run-proof.mjs`** — the `verifier` records every repro/mutation/benchmark through it (`RUN_RECEIPTS.md`); `fix-verified` Phase 0 replays receipts and fails a fix whose repro no longer exits the same way. Fabricated tool output stops being cheap.
- **New `check-proof-integrity.mjs`** — `safety-net` pins its characterization tests in `PROOF_MANIFEST.md`; the §H regression guard verifies pins, so the canonical weak-agent cheat (edit the failing proof test until green) is a loud `PROOF-AMENDED` event that demotes the fix to NEEDS-REVIEW, never a silent pass.
- **`check-autofix-scope.mjs`** wired into the §4 auto-safe lane with `--require-test`.
- **Producers self-check:** `bug-hunt`, `quality-scan`, and `consistency-closure` gate their Done-when on a clean revalidate pass of the finished register (lint #13 guards the wiring); `fix-verified` gates its updated register on `--consumed`.

## 2.6.1
- **Doctrine line untethered from a model name** (CONVENTIONS line 3, as in code-ops-suite 1.13.1). The verification bar is enforced by tiers, proofs, and the register gates — not by naming a model generation.

## 2.6.0
- **Anchor delimiter promoted from script comment to spec (`§6` schema, `§E`).** `revalidate-register.mjs` can only parse an `Anchor:` value that is backtick- or quote-delimited; that requirement lived solely in a script comment, so an executing model following CONVENTIONS could emit an undelimited anchor and silently lose the `DRIFTED` gate — the item fell open to plain line-existence checking. The schema and `§E` now state the syntax with a micro-example (`` Anchor: `given == expected` ``); `verifier` carries it inline.
- **`revalidate-register` warns on an unparseable anchor.** An `Anchor:` label whose value has no delimiter now earns a per-item advisory (`unparseable, DRIFTED check skipped`) instead of being silently ignored. Non-gating; anchor-less registers are checked exactly as before.

## 2.5.0
- **Cascade circuit-breaker (`§H`).** Three or more fixes in a single run rejected by the regression guard or themselves spawning new CONFIRMED findings now stop the fix loop — a cascading cluster is evidence of an architectural problem, not a bug collection. The affected items reclassify as NEEDS-DESIGN (`§6`) with the cascade chain recorded in the register/log and options presented at a checkpoint (deferred and reported in headless runs, `§3`). Wired into `fix-verified`; mirrored in code-ops-suite `§11`.
- **Explicit cold paths (generate, not degrade).** `bug-hunt` and `quality-scan` now state the missing-`GROUND_TRUTH.md` path — run `rigor:ground-truth` first (recommended) or harvest the `§C` toolchain baseline for the scoped area yourself; never reason ahead of the toolchain. `fix-verified` stops and routes to `bug-hunt` when `FINDINGS_REGISTER.md` is absent — never synthesize a register from memory.
- **`deep-review` ranks by demonstrated reach.** Changed exported symbols and shared contracts get their dependents traced (tracer) so ranking reflects demonstrated reach (`§D`), not diff size.

## 2.4.0
- **Independent refutation (new `§I`).** The verification-first complement to the (self-run) disconfirmation pass (`§B`): a fix-driving or blocking finding whose confidence rests on static reachability reasoning — rather than an executed repro — is handed to an *independent* adversary (a `tracer`/`reviewer` in **refutation mode**) that did not find it, tasked solely with killing it by locating a dominating guard/handler in a different function/file/boundary; a majority-REFUTED finding drops or downgrades to SPECULATIVE with the cited guard. A CONFIRMED item already backed by an executed repro skips the panel — the repro outranks refutation. Wired into `bug-hunt` (Phase 3), `deep-review` (Phase 1), and `fix-verified` (Phase 0). `tracer` gains a refutation mode; `verifier` records the anchor and notes that an executed repro needs no panel.
- **Verbatim-anchor citation gate (`§6` schema, `§E`).** Findings carry an `Anchor` (a verbatim substring of the cited line); the bundled `revalidate-register.mjs` flags a citation whose line no longer contains its anchor as **`DRIFTED`** (fail-closed), making "no invented locations" a deterministic check rather than a promise. Backward-compatible with anchor-less registers.

## 2.3.0
- **CONVENTIONS hardened from a real-scale calibration of the suite.** The disconfirmation pass (`§B`) gains two false-positive killers — read the cited line's by-design / accepted-deferred annotation, and *locate* the would-be handler before claiming a "nothing else handles this" gap. The operating model (`§1`) self-throttles the fan-out into **bounded waves**, injects the tool-enforced ruleset **inline** into reviewer prompts, **skims-then-deepens** very large files, and **audits the union of slice skipped-sets** at synthesis. A `claims-vs-enforcement` sub-lens on the interface-consistency lens (`§7`) and a **headless / non-interactive contract** (`§3`) round it out.
- **Bundled runtime-script hardening** (`lib-docs`, `revalidate-register`): `lib-docs` rejects a package `types` value that escapes the package dir and an IPv4-mapped-IPv6 SSRF, and caps an oversized streamed fetch chunk; `revalidate-register` classifies an escaping `Location:` citation `AMBIGUOUS` instead of re-rooting it `FRESH`.

## 2.2.0
- **`revalidate-register` hardened:** correct line count (off-by-one EOF), stop parsing standards tokens (RFC/CVE/ISO) and version/host strings as references, resolve bare-filename references (new `AMBIGUOUS` status), confine reference paths to the repo root, and a clear error when `--root` is given no value. `lib-docs` (bundled) is now local-only by default.

## 2.1.0
- **Register freshness:** §10 SSOT now requires re-confirming a finding's proof still fails before it is written, carried across a phase boundary, or consumed; added `Verified-at: <sha>` to the §6 finding schema and bundled `scripts/revalidate-register.mjs` as a fast pre-filter; `fix-verified` runs it at Phase 0.
- **Automation-level ladder** (`gated` / `auto-safe` = CONFIRMED+NOW-SAFE / `auto-all`; always-gated categories; never auto-merge) promoted into CONVENTIONS §4.
- **Descriptions** rewritten to lead with `Use when…` triggers + scope clauses (orchestrator scope; deep-review as the high-rigor counterpart to code-ops-suite:pr-review).
- **Slimmed boilerplate:** the repeated ~50-word §-index recital in all 11 skill intros replaced with a concise methodology pointer (the full index lives in CONVENTIONS); a new lint guards against any skill copying a 40+ word passage verbatim from CONVENTIONS.

## 2.0.1
- **Packaging:** added an MIT `LICENSE` and a `license` field to the manifest.
- **Tooling:** covered by the new marketplace structural linter
  (`scripts/lint-plugins.mjs`) + CI. No skill behavior changes.

## 2.0.0
- Verification-first methodology v2: test-suite validation (flaky + mutation),
  characterization safety nets (`safety-net`), root-cause sibling sweeps,
  regression bisection (`regression-hunt`), and the regression guard. Skills:
  `ground-truth`, `test-suite-audit`, `safety-net`, `bug-hunt`, `regression-hunt`,
  `quality-scan`, `consistency-closure`, `improve-measured`, `fix-verified`,
  `deep-review`, and the `rigor-sweep` orchestrator. `tracer` + `verifier`
  subagents (verifier executes repros/mutations).
