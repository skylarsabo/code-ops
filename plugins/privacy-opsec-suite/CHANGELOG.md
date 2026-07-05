# Changelog — privacy-opsec-suite

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

## 1.9.0
- **`Anchor` added to the leak schema (`§6`, `§8`).** The bundled `revalidate-register` has carried the verbatim-anchor `DRIFTED` gate since 1.6.0, but this suite's schema never told an executing model to emit an `Anchor:` — so the gate was unreachable for registers produced here. The schema and evidence standard now define the field, including the parse-critical backtick/quote delimiter (an undelimited value is invisible to the checker and forfeits the check). `§11`'s status list now names `DRIFTED` and `AMBIGUOUS`.
- **`revalidate-register` warns on an unparseable anchor** (per-item advisory instead of a silent skip; vendored from the canonical script).

## 1.8.0
- **`opsec-pr-gate` names its real subagent.** Phase 0 said "fan out to the reviewer subagent", but this plugin bundles `explorer` and `privacy-reviewer` — `reviewer` is a code-ops-suite agent, so the tuned `privacy-reviewer` was never invoked by name. The prose now says `privacy-reviewer`. Guarded going forward by two new repo-level lint checks (`scripts/lint-plugins.mjs` #9/#10): every `§<id>` citation in a SKILL.md/agent must resolve to a real CONVENTIONS section, and "the X subagent" prose must name an agent actually bundled in the plugin.

## 1.7.0
- **`supply-chain-trust` gains an agent-ingested-content (prompt-injection) audit axis.** Anything an agent will *read* from a dependency — a vendored skill/plugin, an MCP server's tool descriptions, rules files (`.claude/`, `.cursor/`), READMEs surfaced by doc lookups — is treated as untrusted input, never instructions, and audited for instruction-override/role-hijack phrasing, hidden zero-width/bidi or HTML-comment directives, encoded payloads, exfiltration prompts, and credential-path references inside the payload. A working injection→egress chain files as a critical `egress`/`secret` leak against the compromised-dependency adversary (`§A`) and blocks adoption (`§4`). The `§9` secrets & supply-chain lens is extended to match, operationalizing the prompt-injection vector of the compromised-dependency adversary (`§A`) — prior coverage stopped at phone-home/telemetry, CVEs, lockfile integrity, and postinstall exfiltration.

## 1.6.0
- **Bundled `revalidate-register` gains the verbatim-anchor gate.** The canonical script (vendored into this plugin) now classifies a citation whose cited line no longer contains its optional `Anchor:` substring as **`DRIFTED`** (fail-closed), on top of FRESH/MOVED/GONE — catching a hallucinated or stale finding location before it is acted on. Backward-compatible: registers without anchors are checked exactly as before.

## 1.5.0
- **CONVENTIONS hardened from a real-scale calibration of the suite.** Disconfirmation (`§8`) gains two false-positive killers — read the cited line's by-design / accepted-deferred annotation, and *locate* the would-be handler before claiming a "nothing else handles this" gap. The operating model (`§1`) self-throttles the fan-out into **bounded waves**, injects the tool-enforced ruleset **inline** into reviewer prompts, **skims-then-deepens** very large files, and **audits the union of slice skipped-sets** at synthesis. A `claims-vs-enforcement` documentation sub-lens (`§9`) and a **headless / non-interactive contract** (`§3`) round it out.
- **Bundled runtime-script hardening** (`lib-docs`, `revalidate-register`, `scan-ai-tells`): `lib-docs` rejects a package `types` value that escapes the package dir and an IPv4-mapped-IPv6 SSRF, and caps an oversized streamed fetch chunk; `revalidate-register` classifies an escaping `Location:` citation `AMBIGUOUS` instead of `FRESH`; `scan-ai-tells` rejects option-injecting `--git` range tokens.

## 1.4.0
- **`scan-ai-tells` hardened.** Replaced the shell-string `git log` call with a no-shell `execFileSync` (removes a command-injection sink), made `--emdash-max` fail closed on a malformed value instead of silently disabling the check, widened emoji coverage (regional-indicator flags + the low symbol band) and the tool/vendor list, and dropped an over-broad two-letter token that false-matched `.ai` addresses.
- **`revalidate-register` hardened** (off-by-one EOF, standards-token/version mis-parse, bare-path resolution with a new `AMBIGUOUS` status, reference-path confinement); `lib-docs` is now local-only by default.

## 1.3.0
- **New skill `authorship-hygiene`** + bundled `scripts/scan-ai-tells.mjs` — remove AI/tooling trace from commits/PRs/code across three surfaces: L1 metadata (attribution trailers, identity), L2 prose voice (match the author's style; kill assistant tells), L3 code-idiom blend-in (behavior-preserving; delegates repo-wide style to `normalize`, concept-divergence to `consistency-closure`). New CONVENTIONS §A non-negotiable: no tooling/AI trace in published work, fail-closed before push.

## 1.2.0
- **Register freshness:** CONVENTIONS §11 now mandates re-validating a leak before it is written, carried across a phase boundary, or consumed; added `Verified-at: <sha>` to the §6 leak schema and bundled `scripts/revalidate-register.mjs`; `opsec-hardening` runs it at Phase 0.
- **Evidence tiers + disconfirmation** added to the §6 leak schema (CONFIRMED/PROBABLE/SPECULATIVE).
- **Automation-level ladder** promoted into CONVENTIONS §4 (any anonymity-posture/egress/logging/identifier/default change is always gated; never auto-merge).
- **Multi-boundary control-coverage** rule added to the Egress & routing lens (§9).
- **Descriptions** rewritten to lead with `Use when…` triggers + lane-ownership clauses that disambiguate the overlapping audits (metadata-leak-audit vs fingerprint-resistance vs traffic-analysis-resistance vs anon-session-audit).

## 1.1.1
- **Docs:** the README now lists the `full-sweep` orchestrator (previously
  absent from the Skills section); the root README skill count is corrected to 13.
- **Packaging:** added an MIT `LICENSE` and a `license` field to the manifest.
- **Tooling:** covered by the new marketplace structural linter
  (`scripts/lint-plugins.mjs`) + CI.

## 1.1.0
- Privacy/anonymity & OpSec suite: `anonymity-threat-model`, `anon-session-audit`,
  `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`,
  `traffic-analysis-resistance`, `supply-chain-trust`, `opsec-hardening`,
  `privacy-feature-design`, `leak-incident-response`, `privacy-doc-alignment`,
  `opsec-pr-gate`, plus the `full-sweep` orchestrator. `explorer` +
  `privacy-reviewer` subagents; shared `CONVENTIONS.md` with the §A anonymity model.
