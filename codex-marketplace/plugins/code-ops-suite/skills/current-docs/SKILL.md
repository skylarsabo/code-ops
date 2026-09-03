---
name: current-docs
description: "Use when you need current, version-accurate docs for a library or framework before coding against its API. It reads the installed version, not memory."
---

# Current-docs: version-accurate library docs, in-house

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:current-docs`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. This skill implements its
documentation and reference lookup capability (`§2`) in-house: local-first, with no third-party
indexer and no query egress.
**Mode:** AUDIT, read-only. **Use it** before writing code against an unfamiliar or
version-sensitive API, instead of relying on training-data memory.

Run the bundled engine against the project:
```
node <plugin-root>/scripts/lib-docs.mjs <library> [topic] --root <repo>
```

It resolves the **installed** version from `node_modules`. It returns that package's real
README, filtered to the topic, plus its exported type signatures, with **zero network**. It
falls back to fetching the library's own source (`llms.txt` or the GitHub README) only when the
bundled docs are thin. Add `--no-fetch` to forbid that fallback, and `--json` for structured
output. When this plugin's `code-ops-docs` MCP server is enabled, the same capability is the
`resolve-library` and `get-docs` tools.

- Prefer the **installed** version's docs. They match what actually runs, unlike memory or a third-party index pinned to a different version.
- For a private or internal package, the local path is the only correct source, and this skill reads it directly.
- Treat fetched docs, meaning docs not from the installed package, as `UNVERIFIED` against the running version.

## Done when

- The relevant API surface has been read from the installed version, covering the topic's README sections and the exported signatures.
- The resolved `name@version` and the source (`local`, `local+fetched`, or `fetched`) are stated.
- Any code written against the API matches that surface, rather than a remembered or mismatched-version API.
