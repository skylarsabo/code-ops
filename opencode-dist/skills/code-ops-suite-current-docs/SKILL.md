---
name: code-ops-suite-current-docs
description: "Use when you need current, version-accurate docs for a library or framework before coding against its API. It reads the installed version, not memory."
---

# Current-docs: version-accurate library docs, in-house

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-current-docs`, or by the model through the `skill` tool as `code-ops-suite-current-docs`.**

**OpenCode runtime note:** Traceless publishing, model-floor enforcement, digest rewrite, index refresh, routing guidance, compaction preservation, the lifecycle plugin, and local documentation MCP registration run automatically. The lifecycle plugin keeps a stable system prefix and writes the cost ledger. Handoff and dispatch notes ride on the next tool result or user turn. First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. This skill implements its
documentation and reference lookup capability (`§2`) in-house: local-first, with no third-party
indexer and no query egress.
**Mode:** AUDIT, read-only. **Use it** before writing code against an unfamiliar or
version-sensitive API, instead of relying on training-data memory.

Run the bundled engine against the project:
```
node <plugin-root>/scripts/lib-docs.mjs <library> [topic] --root <repo> [--ecosystem <name>]
```

It supports npm, python, rust, go, and dotnet. The manifests at the root pick the ecosystem
unless `--ecosystem` names one. The lockfile gives the version. The installed copy gives the
README, filtered to the topic, and the exported API. A lockfile and installed mismatch is
printed. The default run uses **zero network**. `--fetch` opts in to the library's own
source (`llms.txt` or the GitHub README) when the installed docs are thin. `--json` gives
structured output. Exit 3 means a miss. When this plugin's `code-ops-docs` MCP server is
enabled, the same capability is the `resolve-library` and `get-docs` tools, which take an
`ecosystem` argument.

- Prefer the **installed** version's docs. They match what actually runs, unlike memory or a third-party index pinned to a different version.
- For a private or internal package, the local path is the only correct source, and this skill reads it directly.
- On a miss (`source: none`, exit 3), do not code from memory. Mark each API claim `UNVERIFIED`, cite the searched paths, and ask before a `--fetch` run.
- Treat fetched docs, meaning docs not from the installed package, as `UNVERIFIED` against the running version.

## Done when

- The relevant API surface has been read from the installed version, covering the topic's README sections and the exported signatures.
- The resolved `name@version`, the ecosystem, any lockfile mismatch, and the source (`local` or `local+fetched`) are stated.
- Any code written against the API matches that surface, rather than a remembered or mismatched-version API.
