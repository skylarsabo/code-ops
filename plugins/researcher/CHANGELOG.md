# Changelog — researcher

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

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
