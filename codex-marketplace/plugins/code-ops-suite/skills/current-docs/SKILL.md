---
name: current-docs
description: "Use when you need current, version-accurate docs for a library or framework before coding against its API. It reads the installed version, not memory."
---

# Current-docs: version-accurate library docs, in-house

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:current-docs`.** First read §2 and §14 of the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. This skill implements its
documentation and reference lookup capability (`§2`) in-house: local-first, with no third-party
indexer and no query egress. Leave the rest of that file unread.
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
