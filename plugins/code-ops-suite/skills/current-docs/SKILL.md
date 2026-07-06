---
description: "Use when you need current, version-accurate docs for a library or framework before coding against its API — read from the installed version, not memory."
disable-model-invocation: true
---

# CURRENT-DOCS — Version-Accurate Library Docs, In-House

**Invoked as `/code-ops-suite:current-docs`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin — this skill implements its "documentation/reference lookup" capability (`§2`) in-house: local-first, no third-party indexer, no query egress.
**Mode:** AUDIT (read-only). **Use it** before writing code against an unfamiliar or version-sensitive API, instead of relying on training-data memory.

Run the bundled engine against the project:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs <library> [topic] --root <repo>
```
It resolves the **installed** version from `node_modules`, returns that package's real README (topic-filtered) + its exported type signatures with **zero network**, and only falls back to fetching the library's own source (`llms.txt` / GitHub README) when the bundled docs are thin — add `--no-fetch` to forbid that, `--json` for structured output. When this plugin's `code-ops-docs` MCP server is enabled, the same capability is the `resolve-library` / `get-docs` tools.

- Prefer the **installed** version's docs — they match what actually runs, unlike memory or a third-party index pinned to a different version.
- For a private/internal package, the local path is the only correct source — this reads it directly.
- Treat fetched (non-installed) docs as `UNVERIFIED` against the running version.

## Done when
The relevant API surface has been read from the installed version (the topic's README section(s) + the exported signatures), the resolved `name@version` and source (`local` / `local+fetched` / `fetched`) are stated, and any code written against it matches that surface — not a remembered or mismatched-version API.
