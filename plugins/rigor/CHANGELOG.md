# Changelog — rigor

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

## 2.6.0
- **Anchor delimiter promoted from script comment to spec (`§6` schema, `§E`).** `revalidate-register.mjs` can only parse an `Anchor:` value that is backtick- or quote-delimited; that requirement lived solely in a script comment, so an executing model following CONVENTIONS could emit an undelimited anchor and silently lose the `DRIFTED` gate — the item fell open to plain line-existence checking. The schema and `§E` now state the syntax with a micro-example (`` Anchor: `given == expected` ``); `verifier` carries it inline.
- **`revalidate-register` warns on an unparseable anchor.** An `Anchor:` label whose value has no delimiter now earns a per-item advisory (`unparseable, DRIFTED check skipped`) instead of being silently ignored. Non-gating; anchor-less registers are checked exactly as before.

## 2.5.0
- **Cascade circuit-breaker (`§H`).** Three or more fixes in a single run rejected by the regression guard or themselves spawning new CONFIRMED findings now stop the fix loop — a cascading cluster is evidence of an architectural problem, not a bug collection. The affected items reclassify as NEEDS-DESIGN (`§6`) with the cascade chain recorded in the register/log and options presented at a checkpoint (deferred and reported in headless runs, `§3`). Wired into `fix-verified`; mirrored in code-ops-suite `§11`.
- **Explicit cold paths (generate, not degrade).** `bug-hunt` and `quality-scan` now state the missing-`GROUND_TRUTH.md` path — run `/rigor:ground-truth` first (recommended) or harvest the `§C` toolchain baseline for the scoped area yourself; never reason ahead of the toolchain. `fix-verified` stops and routes to `bug-hunt` when `FINDINGS_REGISTER.md` is absent — never synthesize a register from memory.
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
