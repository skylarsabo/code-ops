# Changelog — researcher

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

## 0.1.0
- **Initial release.** Code-grounded research plugin with 7 skills (`research-spike`, `research-verify`, `research-improve`, `research-ideate`, `library-eval`, `ecosystem-watch`, `research-sweep`) over a shared research core. **Local-first with a disclosed, fail-closed egress model** (`CONVENTIONS §A`) backed by the bundled `research-manifest.mjs` gate: a published artifact may not cite a web source that was not recorded in `EGRESS_MANIFEST.md`. Every claim is cited and tiered (CONFIRMED/PROBABLE/SPECULATIVE); the plugin **proposes and hands implementation to the other suites** (it never edits source). Bundles `lib-docs.mjs` + `revalidate-register.mjs`; composes the `deep-research` skill for opt-in web. Wired into CI (`evals/research-manifest/run.mjs`) and the structural lint gate.
