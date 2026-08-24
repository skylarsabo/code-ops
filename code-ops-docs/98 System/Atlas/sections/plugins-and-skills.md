# Plugins and skills

Charter: canonical plugin packages and marketplace registration. Excludes generated host projections and repository gates.

The four packages under `plugins/` are the sole authored runtime surface. Each skill reads its plugin `CONVENTIONS.md`; shared doctrine stays there rather than being duplicated into skills. Structural lint makes that boundary mechanical through section references, copied-prose limits, model floors, handbook parity, and plugin version checks.

`code-ops-suite` is the integration package. It owns repository scripts, hooks, the documentation MCP surface, the bounded run-contract/context compiler, and the `repo-docs` orchestrator. The other packages divide review depth, privacy posture, and research discovery. Cross-plugin orchestration is deliberately narrow: `everything` is the cross-suite entry point, while the per-plugin sweeps stay within their own package.

Vendoring is closed in both directions. Every declared runtime copy must match its root source, and every plugin-local `.mjs` copy must be declared. References from skills, agents, READMEs, and plugin metadata must resolve to a bundled canonical helper. That prevents an unused-looking stale helper or a newly referenced missing helper from escaping the normal forward manifest walk.

Context receipts preserve NUL-delimited Git rename and copy destinations, including non-ASCII paths. Root aliases are canonicalized before symlink containment is judged. Atlas freshness output is parsed as a contract for bounded excerpts, and bundle byte counts describe the final serialized payload rather than a pre-update estimate.

Plugin changes have three coupled outputs: the canonical package, host projections, and marketplace metadata. A new runtime script must enter the vendored manifest when skills reference it. A new skill also changes the plugin README, root count, handbook command reference, and router. Do not patch a generated host copy to solve a canonical-package defect.
