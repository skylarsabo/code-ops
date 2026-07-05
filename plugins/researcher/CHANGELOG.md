# Changelog — researcher

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

## 0.3.0
- **Bundled `revalidate-register` gains the verbatim-anchor gate.** The canonical script (vendored into this plugin) now classifies a citation whose cited line no longer contains its optional `Anchor:` substring as **`DRIFTED`** (fail-closed), on top of FRESH/MOVED/GONE — catching a hallucinated or stale finding location before it is acted on. Backward-compatible: registers without anchors are checked exactly as before.

## 0.2.0
- **CONVENTIONS hardened from a real-scale calibration of the suite.** The disconfirmation pass (`§A`) gains two false-positive killers — read the cited line's by-design / accepted-deferred annotation, and *locate* the would-be handler before claiming a "nothing else handles this" gap. The operating model (`§1`) self-throttles the fan-out into **bounded waves**, injects the grounding baseline **inline** into gatherer / claim-checker prompts, **skims-then-deepens** very large files, and **audits the union of slice skipped-sets** at synthesis. A `claims-vs-enforcement` sub-lens on the grounding lens (`§10`) and a **headless / non-interactive contract** (`§3`, egress deferred-and-reported) round it out.
- **Bundled runtime-script hardening** (`lib-docs`, `revalidate-register`, `research-manifest`): `lib-docs` rejects a package `types` value that escapes the package dir and an IPv4-mapped-IPv6 SSRF, and caps an oversized streamed fetch chunk; `revalidate-register` classifies an escaping `Location:` citation `AMBIGUOUS` instead of `FRESH`; `research-manifest` derives disclosed hosts only from the structured host/url columns, so a URL in a free-text `why` note no longer whitelists its host.

## 0.1.0
- **Initial release.** Code-grounded research plugin with 7 skills (`research-spike`, `research-verify`, `research-improve`, `research-ideate`, `library-eval`, `ecosystem-watch`, `research-sweep`) over a shared research core. **Local-first with a disclosed, fail-closed egress model** (`CONVENTIONS §A`) backed by the bundled `research-manifest.mjs` gate: a published artifact may not cite a web source that was not recorded in `EGRESS_MANIFEST.md`. Every claim is cited and tiered (CONFIRMED/PROBABLE/SPECULATIVE); the plugin **proposes and hands implementation to the other suites** (it never edits source). Bundles `lib-docs.mjs` + `revalidate-register.mjs`; composes the `deep-research` skill for opt-in web. Wired into CI (`evals/research-manifest/run.mjs`) and the structural lint gate.
